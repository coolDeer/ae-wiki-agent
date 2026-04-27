/**
 * Hybrid search — keyword (tsvector) + vector (pgvector) → RRF 融合 → 重排。
 *
 * 流程：
 *   1. keyword search: pages.tsv @@ plainto_tsquery → top 50
 *   2. semantic search: content_chunks.embedding <=> query_emb → 取每个 page 最相似 chunk
 *   3. RRF fusion: 1/(60+rank_keyword) + 1/(60+rank_semantic)
 *   4. 默认排除 deleted=1 / status='archived'
 *   5. 返回 top N
 *
 * 不依赖外键，纯 SQL 表达。借鉴 gbrain hybrid.ts 的 RRF 实现。
 */

import { sql as drizzleSql } from "drizzle-orm";
import { db } from "~/core/db.ts";
import { embed } from "~/core/embedding.ts";
import { getEnv } from "~/core/env.ts";
import { tokenizeForQuery } from "~/core/tokenize.ts";
import {
  buildHardExcludeClause,
  buildSourceFactorCase,
  resolveExcludePrefixes,
  resolveSourceBoosts,
} from "./source-boost.ts";

const RRF_K = 60;

export interface SearchOpts {
  /** 召回上限（默认 10） */
  limit?: number;
  /** keyword/vector 各自候选池上限（默认 50） */
  poolSize?: number;
  /** 仅限某 type（'company' / 'source' / ...） */
  type?: string;
  /** 时间过滤：page.create_time 不早于 */
  dateFrom?: string;
  /** 仅 keyword 不跑向量（无 OPENAI_API_KEY 时也能用）*/
  keywordOnly?: boolean;
  /** 硬排除的 slug 前缀（与 env WIKI_SEARCH_EXCLUDE 合并）*/
  excludeSlugPrefixes?: string[];
  /** opt-back-in：从 exclude 中拿掉某些前缀 */
  includeSlugPrefixes?: string[];
}

export interface SearchHit {
  pageId: bigint;
  slug: string;
  type: string;
  title: string;
  ticker: string | null;
  /** RRF 综合分（越大越相关） */
  score: number;
  keywordRank: number | null;
  semanticRank: number | null;
  /** 参与排序的 best chunk（如有），便于上层显示片段 */
  bestChunk: string | null;
}

export async function hybridSearch(
  query: string,
  opts: SearchOpts = {}
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 10;
  const poolSize = opts.poolSize ?? 50;
  const typeFilter = opts.type ?? null;
  const dateFrom = opts.dateFrom ?? null;

  const env = getEnv();

  // 中文分词：把 query 切完空格连接，再喂 plainto_tsquery
  // 英文部分被 jieba 原样穿过；中文部分整词命中
  const tokenizedQuery = tokenizeForQuery(query);

  // source-aware ranking 配置（env + 默认 + 调用方覆盖）
  const boosts = resolveSourceBoosts(env.WIKI_SOURCE_BOOST);
  const excludePrefixes = resolveExcludePrefixes(
    env.WIKI_SEARCH_EXCLUDE,
    opts.excludeSlugPrefixes,
    opts.includeSlugPrefixes
  );
  const sourceFactorSql = buildSourceFactorCase(drizzleSql`p.slug`, boosts);
  const excludeClauseSql = buildHardExcludeClause(
    drizzleSql`p.slug`,
    excludePrefixes
  );

  // 1. 算 query embedding（除非 keywordOnly 或全局 EMBEDDING_DISABLED）
  let queryEmb: number[] | null = null;
  const embeddingDisabled = env.EMBEDDING_DISABLED;
  if (!opts.keywordOnly && !embeddingDisabled) {
    try {
      queryEmb = await embed(query);
    } catch (e) {
      console.warn(
        `[hybridSearch] embed failed, 退化为 keyword-only: ${(e as Error).message}`
      );
    }
  }

  const queryEmbLiteral = queryEmb ? `[${queryEmb.join(",")}]` : null;

  // 2. 一条 SQL 跑完 keyword + semantic + RRF
  const rows = await db.execute(drizzleSql`
    WITH
      keyword AS (
        SELECT
          p.id,
          ROW_NUMBER() OVER (
            ORDER BY ts_rank(p.tsv, plainto_tsquery('simple', ${tokenizedQuery})) * ${sourceFactorSql} DESC
          ) AS rk
        FROM pages p
        WHERE p.tsv @@ plainto_tsquery('simple', ${tokenizedQuery})
          AND p.deleted = 0
          AND p.status != 'archived'
          ${excludeClauseSql ? drizzleSql`AND ${excludeClauseSql}` : drizzleSql``}
          ${typeFilter ? drizzleSql`AND p.type = ${typeFilter}` : drizzleSql``}
          ${dateFrom ? drizzleSql`AND p.create_time >= ${dateFrom}::timestamptz` : drizzleSql``}
        ORDER BY rk
        LIMIT ${poolSize}
      ),
      semantic AS (
        SELECT
          page_id AS id,
          best_dist,
          best_chunk,
          ROW_NUMBER() OVER (
            ORDER BY (1.0 / (1.0 + best_dist)) * source_factor DESC
          ) AS rk
        FROM (
          SELECT
            sub.page_id,
            MIN(sub.dist) AS best_dist,
            (array_agg(sub.chunk_text ORDER BY sub.dist))[1] AS best_chunk,
            -- source_factor 在 page 维度上是常量（同 page 所有 chunk 同 slug），取 max 即可
            MAX(sub.source_factor) AS source_factor
          FROM (
            SELECT
              c.page_id,
              c.chunk_text,
              c.embedding <=> ${queryEmbLiteral}::vector AS dist,
              ${sourceFactorSql} AS source_factor
            FROM content_chunks c
            JOIN pages p ON p.id = c.page_id
            WHERE c.embedding IS NOT NULL
              AND c.deleted = 0
              AND p.deleted = 0
              AND p.status != 'archived'
              ${excludeClauseSql ? drizzleSql`AND ${excludeClauseSql}` : drizzleSql``}
              ${queryEmbLiteral ? drizzleSql`` : drizzleSql`AND FALSE` /* keyword-only */}
            ORDER BY c.embedding <=> ${queryEmbLiteral}::vector
            LIMIT ${poolSize * 3}
          ) sub
          GROUP BY sub.page_id
        ) page_grouped
        ORDER BY rk
        LIMIT ${poolSize}
      ),
      fused AS (
        SELECT
          COALESCE(k.id, s.id) AS id,
          k.rk AS k_rk,
          s.rk AS s_rk,
          s.best_chunk,
          (
            COALESCE(1.0 / (${RRF_K} + k.rk), 0)
            + COALESCE(1.0 / (${RRF_K} + s.rk), 0)
          ) AS score
        FROM keyword k
        FULL OUTER JOIN semantic s ON s.id = k.id
      )
    SELECT
      p.id AS page_id,
      p.slug,
      p.type,
      p.title,
      p.ticker,
      f.score,
      f.k_rk AS keyword_rank,
      f.s_rk AS semantic_rank,
      f.best_chunk
    FROM fused f
    JOIN pages p ON p.id = f.id
    WHERE p.deleted = 0
      AND p.status != 'archived'
      ${typeFilter ? drizzleSql`AND p.type = ${typeFilter}` : drizzleSql``}
    ORDER BY f.score DESC NULLS LAST
    LIMIT ${limit}
  `);

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    pageId: BigInt(r.page_id as string | number | bigint),
    slug: r.slug as string,
    type: r.type as string,
    title: r.title as string,
    ticker: (r.ticker as string | null) ?? null,
    score: parseFloat(String(r.score ?? 0)),
    keywordRank: r.keyword_rank == null ? null : Number(r.keyword_rank),
    semanticRank: r.semantic_rank == null ? null : Number(r.semantic_rank),
    bestChunk: (r.best_chunk as string | null) ?? null,
  }));
}
