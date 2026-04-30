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
import type { ChunkCandidate, SearchDebug, SearchHit, SearchOpts } from "./types.ts";

const RRF_K = 60;
const COMPILED_TRUTH_BOOST = 2.0;

// =============================================================================
// Query embedding cache —— chat agent 多步连续 search 同 query 时省 OpenAI 成本
// 简单 FIFO + TTL，不做严格 LRU；chat 场景下 query 重复率高于多样性，FIFO 够用。
// =============================================================================
const QUERY_EMB_CACHE = new Map<string, { emb: number[]; at: number }>();
const QUERY_EMB_TTL_MS = 60_000;
const QUERY_EMB_MAX = 200;

async function embedCached(query: string): Promise<number[]> {
  const now = Date.now();
  const hit = QUERY_EMB_CACHE.get(query);
  if (hit && now - hit.at < QUERY_EMB_TTL_MS) {
    // refresh recency: delete + re-insert moves to end
    QUERY_EMB_CACHE.delete(query);
    QUERY_EMB_CACHE.set(query, hit);
    return hit.emb;
  }
  const emb = await embed(query);
  QUERY_EMB_CACHE.set(query, { emb, at: now });
  // evict oldest until under cap
  while (QUERY_EMB_CACHE.size > QUERY_EMB_MAX) {
    const oldest = QUERY_EMB_CACHE.keys().next().value;
    if (oldest === undefined) break;
    QUERY_EMB_CACHE.delete(oldest);
  }
  return emb;
}

/** 测试 / 维护用 —— 强制清缓存。 */
export function clearQueryEmbeddingCache(): void {
  QUERY_EMB_CACHE.clear();
}
/**
 * Backlink boost 系数：score *= clamp(1 + COEF * log(1 + count), 1, MAX)。
 * 1 反链 ≈ 1.035 / 10 ≈ 1.12 / 100 ≈ 1.23 / 1000 ≈ 1.35（以下都被 cap 截断）。
 * 在 cosine 重打分之后、dedup 之前应用。
 *
 * MAX cap 防 matthew effect：wiki 长大后高反链页（active thesis 标的、跨研报反复提的 NVDA 等）
 * 不会无限堆 boost 把别的结果挤出榜首。
 */
const BACKLINK_BOOST_COEF = 0.05;
const BACKLINK_BOOST_MAX = 1.5;

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

  // 向量通道开关
  const wantVector =
    !opts.keywordOnly && !env.EMBEDDING_DISABLED && Boolean(env.OPENAI_API_KEY);

  // 多 query 扩展（如果开）
  const expansionEnabled = opts.expansion ?? env.WIKI_QUERY_EXPANSION;

  // Phase 1：keyword + （expand → embed → vector）并发启动
  // keyword 通道不依赖 OpenAI，与 embedding 并行能压掉 RTT
  const tStart = Date.now();
  const keywordPromise = searchKeyword(query, channelOpts);

  let queries = [query];
  let vectorLists: ChunkCandidate[][] = [];
  let queryEmbedding: number[] | null = null;

  const vectorPromise: Promise<{ embeds: number[][]; lists: ChunkCandidate[][] }> =
    wantVector
      ? (async () => {
          // 原 query 立刻开始 embed（不等 expand 出结果）
          const baseEmbedPromise = embedCached(query);

          // 同时启动 expand（如果开了），expand 完成后再 embed N-1 个 alternative
          const altsPromise: Promise<string[]> = expansionEnabled
            ? expandQuery(query).then(
                (qs) => {
                  const merged = qs.length > 0 ? qs : [query];
                  // expandQuery 返回数组首项不一定 === query；
                  // 我们要的是「除了原 query 之外的 alternative」
                  return merged.filter((q) => q !== query).slice(0, 2);
                },
                () => [] // non-fatal
              )
            : Promise.resolve([]);

          const [baseEmbed, alts] = await Promise.all([baseEmbedPromise, altsPromise]);
          // 现在并发 embed 所有 alternative（原 query 已经 embed 好）
          const altEmbeds = await Promise.all(alts.map((q) => embedCached(q)));
          const allQueries = [query, ...alts];
          queries = allQueries;
          const embeds = [baseEmbed, ...altEmbeds];

          // 并发跑所有 vector 通道
          const lists = await Promise.all(
            embeds.map((emb) => searchVector(emb, channelOpts))
          );
          return { embeds, lists };
        })()
      : Promise.resolve({ embeds: [], lists: [] });

  const [keywordResults, vectorBundle] = await Promise.all([
    keywordPromise,
    vectorPromise.catch((e) => {
      if (debug) console.error(`[search-debug] vector channel failed:`, e);
      return { embeds: [], lists: [] };
    }),
  ]);
  vectorLists = vectorBundle.lists;
  queryEmbedding = vectorBundle.embeds[0] ?? null;

  if (debug) {
    console.error(
      `[search-debug] phase1 done in ${Date.now() - tStart}ms ` +
        `kw=${keywordResults.length} vec_lists=${vectorLists.length}`
    );
  }

  if (!wantVector) {
    const ranked = annotateRanks(keywordResults, []);
    const dedupOpts = buildDedupOpts(opts.dedupOpts, detail);
    const deduped = dedupChunks(ranked, dedupOpts);
    return bestChunkPerPage(deduped).slice(0, limit).map(toSearchHit);
  }

  const collectDebug = opts.debug === true;

  if (vectorLists.length === 0) {
    const ranked = annotateRanks(keywordResults, []);
    const dedupOpts = buildDedupOpts(opts.dedupOpts, detail);
    const deduped = dedupChunks(ranked, dedupOpts);
    return bestChunkPerPage(deduped).slice(0, limit).map(toSearchHit);
  }

  // RRF：keyword 一路 + vector 多路。detail=high 时跳过 compiled_truth boost（temporal/event 走自然排序）
  const allLists = [keywordResults, ...vectorLists];
  const rrfK = opts.rrfK ?? RRF_K;
  let fused = rrfFusion(allLists, rrfK, debug, detail !== "high", collectDebug);

  // 把通道 rank 标注回去（取首个 keyword 命中位置 / 首个 vector 命中位置）
  fused = decorateChannelRanks(fused, keywordResults, vectorLists);

  // cosine re-score：query embedding × chunk embedding
  if (queryEmbedding) {
    fused = await cosineReScore(fused, queryEmbedding, debug, collectDebug);
  }

  // backlink boost：cosine 之后、dedup 之前；1 query 拿全集 count，不是 N+1
  if (fused.length > 0) {
    try {
      const slugs = Array.from(new Set(fused.map((r) => r.slug)));
      const counts = await fetchBacklinkCounts(slugs);
      applyBacklinkBoost(fused, counts, collectDebug);
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
  applyCompiledTruthBoost: boolean,
  collectDebug: boolean
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
  const debugByKey = new Map<string, Partial<SearchDebug>>();
  if (maxScore > 0) {
    for (const e of entries) {
      const raw = e.score;
      const norm = raw / maxScore;
      const boost =
        applyCompiledTruthBoost && e.result.chunkType === "compiled_truth"
          ? COMPILED_TRUTH_BOOST
          : 1.0;
      const boosted = norm * boost;
      if (debug) {
        console.error(
          `[search-debug] ${e.result.slug}:${e.result.chunkId} rrf_raw=${raw.toFixed(4)} rrf_norm=${norm.toFixed(4)} boost=${boost} boosted=${boosted.toFixed(4)} type=${e.result.chunkType}`
        );
      }
      if (collectDebug) {
        debugByKey.set(chunkKey(e.result), {
          rrfRaw: raw,
          rrfNorm: norm,
          rrfBoost: boost,
        });
      }
      e.score = boosted;
    }
  }

  return entries
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => {
      const r: RankedChunk = {
        ...result,
        score,
        keywordRank: null,
        semanticRank: null,
      };
      if (collectDebug) r.debug = debugByKey.get(chunkKey(result));
      return r;
    });
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
 *   raw_factor = 1 + COEF * log(1 + count)
 *   final_factor = min(raw_factor, BACKLINK_BOOST_MAX)
 */
export function applyBacklinkBoost(
  results: RankedChunk[],
  counts: Map<string, number>,
  collectDebug = false
): void {
  for (const r of results) {
    const c = counts.get(r.slug) ?? 0;
    let factor = 1;
    if (c > 0) {
      const raw = 1 + BACKLINK_BOOST_COEF * Math.log(1 + c);
      factor = Math.min(raw, BACKLINK_BOOST_MAX);
      r.score *= factor;
    }
    if (collectDebug) {
      r.debug = {
        ...(r.debug ?? {}),
        backlinkCount: c,
        backlinkBoost: factor,
        finalScore: r.score,
      };
    }
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
  debug: boolean,
  collectDebug = false
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
  // 缺 embedding 时给中性 cosine（0.5），保证最终 score 与有 embedding 的 chunk 同刻度
  // 否则 raw RRF（可能 1.0）会跟 blended（0.7 + 0.3·cos ≤ 1）打架，系统性偏向 unembedded chunks
  const NEUTRAL_COS = 0.5;
  return results
    .map((r) => {
      const emb = map.get(r.chunkId.toString());
      const normRrf = maxRrf > 0 ? r.score / maxRrf : 0;
      const cos = emb ? cosineSimilarity(queryEmbedding, emb) : NEUTRAL_COS;
      const blended = 0.7 * normRrf + 0.3 * cos;
      if (debug) {
        const tag = emb ? "" : " [no-emb fallback cos=0.5]";
        console.error(
          `[search-debug] ${r.slug}:${r.chunkId} cosine=${cos.toFixed(4)} norm_rrf=${normRrf.toFixed(4)} blended=${blended.toFixed(4)}${tag}`
        );
      }
      const next: RankedChunk = { ...r, score: blended };
      if (collectDebug) {
        next.debug = {
          ...(r.debug ?? {}),
          cosine: emb ? cos : null,
          blendedScore: blended,
        };
      }
      return next;
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
  const hit: SearchHit = {
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
  if (r.debug) {
    // 把 finalScore 兜底成 r.score（如果 backlink boost 没运行）
    hit.debug = {
      rrfRaw: r.debug.rrfRaw ?? 0,
      rrfNorm: r.debug.rrfNorm ?? 0,
      rrfBoost: r.debug.rrfBoost ?? 1,
      cosine: r.debug.cosine ?? null,
      blendedScore: r.debug.blendedScore ?? r.score,
      backlinkCount: r.debug.backlinkCount ?? 0,
      backlinkBoost: r.debug.backlinkBoost ?? 1,
      finalScore: r.debug.finalScore ?? r.score,
    };
  }
  return hit;
}

// 暴露 RRF / cosine helper 给可能的 eval 模块
export { rrfFusion };
