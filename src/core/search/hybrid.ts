/**
 * Hybrid search orchestrator — keyword + vector → RRF → cosine re-score → dedup → page-level hit。
 *
 * 流程（借鉴 gbrain v0.20+）:
 *   1. autoDetectDetail：从 query 推断 entity/temporal/event/general → detail level
 *   2. 多 query 扩展（opt-in，env WIKI_QUERY_EXPANSION，调 OPENAI_AGENT_MODEL）
 *   3. 并行：searchKeyword + searchVector（每个变体一个 vector 通道）
 *   4. RRF fusion：1/(K + rank) 累加，归一化到 0-1
 *   5. cosine re-score：blend = 0.7*rrf + 0.3*cosine（query 向量 vs chunk 向量）
 *   6. dedup pipeline：jaccard / type-cap / max-per-page（detail-aware）
 *   7. bestChunkPerPage → 返回 page-level SearchHit
 */

import { sql as drizzleSql } from "drizzle-orm";
import { db } from "~/core/db.ts";
import { embed } from "~/core/embedding.ts";
import { getEnv } from "~/core/env.ts";
import { autoDetectDetail, detailToMaxPerPage } from "./intent.ts";
import { expandQuery } from "./expansion.ts";
import { searchKeyword } from "./keyword.ts";
import { searchVector } from "./vector.ts";
import {
  bestChunkPerPage,
  dedupChunks,
  type DedupOpts,
  type RankedChunk,
} from "./dedup.ts";
import type { ChunkCandidate, SearchHit, SearchOpts } from "./types.ts";

const RRF_K = 60;
const COMPILED_TRUTH_BOOST = 2.0;
/**
 * Backlink boost 系数：score *= (1 + COEF * log(1 + count))。
 * 1 反链 ≈ 1.035 / 10 ≈ 1.12 / 100 ≈ 1.23。在 cosine 重打分之后、dedup 之前应用。
 */
const BACKLINK_BOOST_COEF = 0.05;

export type { SearchHit, SearchOpts } from "./types.ts";
export { buildTsQueryExpr } from "./keyword.ts";

export async function hybridSearch(
  query: string,
  opts: SearchOpts = {}
): Promise<SearchHit[]> {
  const env = getEnv();
  const limit = opts.limit ?? 10;
  const debug = env.WIKI_SEARCH_DEBUG;

  const detail = opts.detail ?? autoDetectDetail(query);
  if (debug && detail) {
    console.error(`[search-debug] auto-detail=${detail} for query="${query}"`);
  }

  const innerLimit = Math.max(limit * 4, 30);
  const channelOpts: SearchOpts = { ...opts, poolSize: opts.poolSize ?? innerLimit };

  // Keyword 通道（chunk-level，每页贡献 1 候选）
  const keywordResults = await searchKeyword(query, channelOpts);

  // 向量通道关闭：keyword-only fallback
  const wantVector =
    !opts.keywordOnly && !env.EMBEDDING_DISABLED && Boolean(env.OPENAI_API_KEY);
  if (!wantVector) {
    const ranked = annotateRanks(keywordResults, []);
    const dedupOpts = buildDedupOpts(opts.dedupOpts, detail);
    const deduped = dedupChunks(ranked, dedupOpts);
    return bestChunkPerPage(deduped).slice(0, limit).map(toSearchHit);
  }

  // 多 query 扩展
  let queries = [query];
  const expansionEnabled = opts.expansion ?? env.WIKI_QUERY_EXPANSION;
  if (expansionEnabled) {
    try {
      queries = await expandQuery(query);
      if (queries.length === 0) queries = [query];
    } catch {
      /* non-fatal */
    }
  }

  // 并行 embed 所有 query 变体 + 各跑一次 vector 通道
  let vectorLists: ChunkCandidate[][] = [];
  let queryEmbedding: number[] | null = null;
  try {
    const embeddings = await Promise.all(queries.map((q) => embed(q)));
    queryEmbedding = embeddings[0] ?? null;
    vectorLists = await Promise.all(
      embeddings.map((emb) => searchVector(emb, channelOpts))
    );
  } catch (e) {
    if (debug) console.error(`[search-debug] vector channel failed:`, e);
  }

  if (vectorLists.length === 0) {
    const ranked = annotateRanks(keywordResults, []);
    const dedupOpts = buildDedupOpts(opts.dedupOpts, detail);
    const deduped = dedupChunks(ranked, dedupOpts);
    return bestChunkPerPage(deduped).slice(0, limit).map(toSearchHit);
  }

  // RRF：keyword 一路 + vector 多路。detail=high 时跳过 compiled_truth boost（temporal/event 走自然排序）
  const allLists = [keywordResults, ...vectorLists];
  const rrfK = opts.rrfK ?? RRF_K;
  let fused = rrfFusion(allLists, rrfK, debug, detail !== "high");

  // 把通道 rank 标注回去（取首个 keyword 命中位置 / 首个 vector 命中位置）
  fused = decorateChannelRanks(fused, keywordResults, vectorLists);

  // cosine re-score：query embedding × chunk embedding
  if (queryEmbedding) {
    fused = await cosineReScore(fused, queryEmbedding, debug);
  }

  // backlink boost：cosine 之后、dedup 之前；1 query 拿全集 count，不是 N+1
  if (fused.length > 0) {
    try {
      const slugs = Array.from(new Set(fused.map((r) => r.slug)));
      const counts = await fetchBacklinkCounts(slugs);
      applyBacklinkBoost(fused, counts);
      fused.sort((a, b) => b.score - a.score);
    } catch {
      /* boost 失败不致命，保留 cosine 排序 */
    }
  }

  // dedup
  const dedupOpts = buildDedupOpts(opts.dedupOpts, detail);
  const deduped = dedupChunks(fused, dedupOpts);

  // page-level 收敛 + 切片
  const pageLevel = bestChunkPerPage(deduped).slice(0, limit);

  // detail=low 召回 0 → 自动放宽到 high 重跑（gbrain 借鉴）
  if (pageLevel.length === 0 && opts.detail === "low") {
    return hybridSearch(query, { ...opts, detail: "high" });
  }

  return pageLevel.map(toSearchHit);
}

// ──────────────────────────────────────────────────────────────────────────
// RRF
// ──────────────────────────────────────────────────────────────────────────

function rrfFusion(
  lists: ChunkCandidate[][],
  k: number,
  debug: boolean,
  applyCompiledTruthBoost: boolean
): RankedChunk[] {
  const scores = new Map<string, { result: ChunkCandidate; score: number }>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank]!;
      const key = chunkKey(r);
      const existing = scores.get(key);
      const inc = 1 / (k + rank);
      if (existing) existing.score += inc;
      else scores.set(key, { result: r, score: inc });
    }
  }

  const entries = Array.from(scores.values());
  if (entries.length === 0) return [];

  // 归一化 + compiled_truth 加权（在归一之后、排序之前）
  const maxScore = Math.max(...entries.map((e) => e.score));
  if (maxScore > 0) {
    for (const e of entries) {
      const raw = e.score;
      let norm = raw / maxScore;
      const boost =
        applyCompiledTruthBoost && e.result.chunkType === "compiled_truth"
          ? COMPILED_TRUTH_BOOST
          : 1.0;
      norm *= boost;
      if (debug) {
        console.error(
          `[search-debug] ${e.result.slug}:${e.result.chunkId} rrf_raw=${raw.toFixed(4)} rrf_norm=${(raw / maxScore).toFixed(4)} boost=${boost} boosted=${norm.toFixed(4)} type=${e.result.chunkType}`
        );
      }
      e.score = norm;
    }
  }

  return entries
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({
      ...result,
      score,
      keywordRank: null,
      semanticRank: null,
    }));
}

/**
 * Backlink count fetcher：单查询拉所有候选 page 的入站链接数（去 deleted）。
 */
async function fetchBacklinkCounts(slugs: string[]): Promise<Map<string, number>> {
  if (slugs.length === 0) return new Map();
  const slugLits = slugs.map((s) => drizzleSql`${s}`);
  const rows = await db.execute(drizzleSql`
    SELECT p.slug AS slug, COUNT(l.id) AS cnt
    FROM pages p
    LEFT JOIN links l ON l.to_page_id = p.id AND l.deleted = 0
    WHERE p.slug IN (${drizzleSql.join(slugLits, drizzleSql`, `)})
      AND p.deleted = 0
    GROUP BY p.slug
  `);
  const out = new Map<string, number>();
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    out.set(String(r.slug), Number(r.cnt) || 0);
  }
  return out;
}

/**
 * 把 backlink count 折算成 multiplier 应用到分数上。in-place 修改。
 *   factor = 1 + COEF * log(1 + count)
 */
export function applyBacklinkBoost(
  results: RankedChunk[],
  counts: Map<string, number>
): void {
  for (const r of results) {
    const c = counts.get(r.slug) ?? 0;
    if (c > 0) r.score *= 1 + BACKLINK_BOOST_COEF * Math.log(1 + c);
  }
}

function decorateChannelRanks(
  fused: RankedChunk[],
  keywordList: ChunkCandidate[],
  vectorLists: ChunkCandidate[][]
): RankedChunk[] {
  const kIdx = new Map<string, number>();
  keywordList.forEach((r, i) => kIdx.set(chunkKey(r), i + 1));

  const sIdx = new Map<string, number>();
  // 取 query variants 中最早出现的位置
  for (const list of vectorLists) {
    list.forEach((r, i) => {
      const key = chunkKey(r);
      const prev = sIdx.get(key);
      if (prev === undefined || i + 1 < prev) sIdx.set(key, i + 1);
    });
  }

  return fused.map((r) => ({
    ...r,
    keywordRank: kIdx.get(chunkKey(r)) ?? null,
    semanticRank: sIdx.get(chunkKey(r)) ?? null,
  }));
}

function annotateRanks(
  keywordList: ChunkCandidate[],
  vectorLists: ChunkCandidate[][]
): RankedChunk[] {
  // keyword-only 路径：直接转换，归一化到 0-1
  const max = Math.max(1e-9, ...keywordList.map((r) => r.score));
  const ranked = keywordList.map((r, i) => ({
    ...r,
    score: r.score / max,
    keywordRank: i + 1,
    semanticRank: null,
  }));
  // 防 unused 警告
  void vectorLists;
  return ranked;
}

function chunkKey(r: ChunkCandidate): string {
  return `${r.slug}::${r.chunkId.toString()}`;
}

// ──────────────────────────────────────────────────────────────────────────
// cosine re-score
// ──────────────────────────────────────────────────────────────────────────

async function cosineReScore(
  results: RankedChunk[],
  queryEmbedding: number[],
  debug: boolean
): Promise<RankedChunk[]> {
  const chunkIds = results.map((r) => r.chunkId).filter((id): id is bigint => id != null);
  if (chunkIds.length === 0) return results;

  let map: Map<string, number[]>;
  try {
    map = await fetchEmbeddingsByChunkIds(chunkIds);
  } catch {
    return results;
  }
  if (map.size === 0) return results;

  const maxRrf = Math.max(...results.map((r) => r.score));
  return results
    .map((r) => {
      const emb = map.get(r.chunkId.toString());
      if (!emb) return r;
      const cos = cosineSimilarity(queryEmbedding, emb);
      const normRrf = maxRrf > 0 ? r.score / maxRrf : 0;
      const blended = 0.7 * normRrf + 0.3 * cos;
      if (debug) {
        console.error(
          `[search-debug] ${r.slug}:${r.chunkId} cosine=${cos.toFixed(4)} norm_rrf=${normRrf.toFixed(4)} blended=${blended.toFixed(4)}`
        );
      }
      return { ...r, score: blended };
    })
    .sort((a, b) => b.score - a.score);
}

async function fetchEmbeddingsByChunkIds(chunkIds: bigint[]): Promise<Map<string, number[]>> {
  if (chunkIds.length === 0) return new Map();
  const ids = chunkIds.map((id) => drizzleSql`${id}`);
  const rows = await db.execute(drizzleSql`
    SELECT id, embedding
    FROM content_chunks
    WHERE id IN (${drizzleSql.join(ids, drizzleSql`, `)})
      AND embedding IS NOT NULL
  `);
  const out = new Map<string, number[]>();
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    const id = String(r.id);
    const raw = r.embedding;
    if (!raw) continue;
    if (Array.isArray(raw)) {
      out.set(id, raw as number[]);
    } else if (typeof raw === "string") {
      try {
        out.set(id, JSON.parse(raw) as number[]);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ──────────────────────────────────────────────────────────────────────────
// 辅助
// ──────────────────────────────────────────────────────────────────────────

function buildDedupOpts(
  override: SearchOpts["dedupOpts"],
  detail: "low" | "medium" | "high" | undefined
): DedupOpts {
  return {
    cosineThreshold: override?.cosineThreshold,
    maxTypeRatio: override?.maxTypeRatio,
    maxPerPage: override?.maxPerPage ?? detailToMaxPerPage(detail),
  };
}

function toSearchHit(r: RankedChunk): SearchHit {
  return {
    pageId: r.pageId,
    slug: r.slug,
    type: r.type,
    title: r.title,
    ticker: r.ticker,
    score: r.score,
    keywordRank: r.keywordRank,
    semanticRank: r.semanticRank,
    bestChunk: r.chunkText || null,
    chunkId: r.chunkId,
    chunkType: r.chunkType,
    sectionPath: r.sectionPath ?? null,
  };
}

// 暴露 RRF / cosine helper 给可能的 eval 模块
export { rrfFusion };
