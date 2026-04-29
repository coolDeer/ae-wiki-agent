/**
 * Vector channel — chunk-level 候选池。
 *
 * 直接对 content_chunks.embedding 做 cosine distance 检索，
 * 同 page 多个相关 chunk 都进入候选（区别于旧实现 group-by-page 只留一个）。
 * dedup 阶段再做"每页最多 N chunks"的收敛。
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

export async function searchVector(
  queryEmbedding: number[],
  opts: SearchOpts = {}
): Promise<ChunkCandidate[]> {
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

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

  const queryEmbLiteral = `[${queryEmbedding.join(",")}]`;

  // 先按距离 LIMIT poolSize*3 取候选 chunk（ANN 候选池），再按 score = (1/(1+dist)) * factor 排序
  const rows = await db.execute(drizzleSql`
    WITH candidate AS (
      SELECT
        c.id          AS chunk_id,
        c.page_id     AS page_id,
        c.chunk_text  AS chunk_text,
        c.chunk_type  AS chunk_type,
        c.section_path AS section_path,
        c.embedding <=> ${queryEmbLiteral}::vector AS dist,
        p.slug   AS slug,
        p.type   AS type,
        p.title  AS title,
        p.ticker AS ticker,
        ${sourceFactorSql} AS source_factor
      FROM content_chunks c
      JOIN pages p ON p.id = c.page_id
      WHERE c.embedding IS NOT NULL
        AND c.deleted = 0
        AND p.deleted = 0
        AND p.status != 'archived'
        ${excludeClauseSql ? drizzleSql`AND ${excludeClauseSql}` : drizzleSql``}
        ${typeFilter ? drizzleSql`AND p.type = ${typeFilter}` : drizzleSql``}
        ${dateFrom ? drizzleSql`AND p.create_time >= ${dateFrom}::timestamptz` : drizzleSql``}
      ORDER BY c.embedding <=> ${queryEmbLiteral}::vector
      LIMIT ${poolSize * 3}
    )
    SELECT
      chunk_id, page_id, chunk_text, chunk_type, section_path, dist,
      slug, type, title, ticker,
      (1.0 / (1.0 + dist)) * source_factor AS score
    FROM candidate
    ORDER BY score DESC
    LIMIT ${poolSize}
  `);

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    pageId: BigInt(r.page_id as string | number | bigint),
    slug: r.slug as string,
    type: r.type as string,
    title: r.title as string,
    ticker: (r.ticker as string | null) ?? null,
    chunkId: BigInt(r.chunk_id as string | number | bigint),
    chunkText: (r.chunk_text as string) ?? "",
    chunkType: (r.chunk_type as string) ?? "text",
    sectionPath: Array.isArray(r.section_path)
      ? (r.section_path as unknown[]).map((s) => String(s))
      : null,
    score: parseFloat(String(r.score ?? 0)),
  }));
}
