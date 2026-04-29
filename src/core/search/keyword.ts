/**
 * Keyword channel — chunk-level 候选池。
 *
 * 流程：
 *   1. 用 pages.tsv（已索引）做 page-level 过滤（cheap），命中的 page 进入 pool
 *   2. 对 pool 内每个 page 用 LATERAL JOIN 取 ts_rank 最高的 chunk 作为代表
 *   3. 整体按 chunk_rank * source_factor 倒排，限制 poolSize
 *
 * 这样 keyword 通道每页贡献 1 个 ChunkCandidate，与 vector 通道（chunk-level，每页多个）
 * 在 RRF 时融合：相同 chunk 出现在两路命中会被合并。
 */

import { sql as drizzleSql } from "drizzle-orm";
import { db } from "~/core/db.ts";
import {
  buildHardExcludeClause,
  buildSourceFactorCase,
  resolveExcludePrefixes,
  resolveSourceBoosts,
} from "./source-boost.ts";
import { getEnv } from "~/core/env.ts";
import type { ChunkCandidate, SearchOpts } from "./types.ts";

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "for", "on", "and", "or",
  "is", "are", "was", "were", "be", "been", "being",
  "find", "search", "show", "give", "tell", "list", "all", "any", "some",
  "what", "who", "which", "when", "where", "why", "how",
  "site", "filetype", "inurl", "intitle", "www", "com", "org", "io",
  "的", "了", "和", "与", "或", "是", "在", "有", "我", "你", "他", "它",
]);

/**
 * 把用户自然语言 query 转成 OR 连接的 tsquery 表达式（前缀通配）。
 * 解决 plainto_tsquery 把 token 全 AND 起来导致召回过严的问题。
 */
export function buildTsQueryExpr(query: string): string {
  if (!query) return "";
  const cleaned = query
    .replace(/\b(?:site|filetype|inurl|intitle|cache|info|related)\s*:\s*\S+/gi, " ")
    .replace(/[^\p{L}\p{N}_\-\s]/gu, " ")
    .toLowerCase()
    .trim();
  if (!cleaned) return "";

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    const isAscii = /^[a-z0-9_-]+$/.test(raw);
    if (isAscii && raw.length < 3) continue;
    if (!isAscii && raw.length < 1) continue;
    if (STOPWORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(`'${raw.replace(/'/g, "''")}':*`);
    if (tokens.length >= 16) break;
  }
  return tokens.join(" | ");
}

export async function searchKeyword(
  query: string,
  opts: SearchOpts = {}
): Promise<ChunkCandidate[]> {
  const tsExpr = buildTsQueryExpr(query);
  if (!tsExpr) return [];

  const env = getEnv();
  const poolSize = opts.poolSize ?? 50;
  const typeFilter = opts.type ?? null;
  const dateFrom = opts.dateFrom ?? null;

  const boosts = resolveSourceBoosts(env.WIKI_SOURCE_BOOST);
  const excludePrefixes = resolveExcludePrefixes(
    env.WIKI_SEARCH_EXCLUDE,
    opts.excludeSlugPrefixes,
    opts.includeSlugPrefixes
  );
  const sourceFactorSql = buildSourceFactorCase(drizzleSql`p.slug`, boosts);
  const excludeClauseSql = buildHardExcludeClause(drizzleSql`p.slug`, excludePrefixes);

  // page_pool: 用 pages.tsv（已索引）做粗筛
  // chunk_lateral: 每个 page LATERAL 取 ts_rank 最高的 chunk
  const rows = await db.execute(drizzleSql`
    WITH page_pool AS (
      SELECT
        p.id,
        p.slug,
        p.type,
        p.title,
        p.ticker,
        ts_rank(p.tsv, to_tsquery('simple', ${tsExpr})) * ${sourceFactorSql} AS page_rank
      FROM pages p
      WHERE p.tsv @@ to_tsquery('simple', ${tsExpr})
        AND p.deleted = 0
        AND p.status != 'archived'
        ${excludeClauseSql ? drizzleSql`AND ${excludeClauseSql}` : drizzleSql``}
        ${typeFilter ? drizzleSql`AND p.type = ${typeFilter}` : drizzleSql``}
        ${dateFrom ? drizzleSql`AND p.create_time >= ${dateFrom}::timestamptz` : drizzleSql``}
      ORDER BY page_rank DESC
      LIMIT ${poolSize * 2}
    )
    SELECT
      pp.id          AS page_id,
      pp.slug        AS slug,
      pp.type        AS type,
      pp.title       AS title,
      pp.ticker      AS ticker,
      pp.page_rank   AS page_rank,
      c.id           AS chunk_id,
      c.chunk_text   AS chunk_text,
      c.chunk_type   AS chunk_type
    FROM page_pool pp
    LEFT JOIN LATERAL (
      SELECT cc.id, cc.chunk_text, cc.chunk_type,
             ts_rank(to_tsvector('simple', cc.chunk_text), to_tsquery('simple', ${tsExpr})) AS chunk_rank
      FROM content_chunks cc
      WHERE cc.page_id = pp.id
        AND cc.deleted = 0
      ORDER BY chunk_rank DESC, cc.chunk_index ASC
      LIMIT 1
    ) c ON TRUE
    ORDER BY pp.page_rank DESC
    LIMIT ${poolSize}
  `);

  return (rows as unknown as Array<Record<string, unknown>>)
    .filter((r) => r.chunk_id != null)
    .map((r) => ({
      pageId: BigInt(r.page_id as string | number | bigint),
      slug: r.slug as string,
      type: r.type as string,
      title: r.title as string,
      ticker: (r.ticker as string | null) ?? null,
      chunkId: BigInt(r.chunk_id as string | number | bigint),
      chunkText: (r.chunk_text as string) ?? "",
      chunkType: (r.chunk_type as string) ?? "text",
      score: parseFloat(String(r.page_rank ?? 0)),
    }));
}
