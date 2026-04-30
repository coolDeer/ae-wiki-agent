/**
 * Dedup pipeline — 4 层（借鉴 gbrain）:
 *   1. 同一 page 最多保留 top-3 chunk（按 score）
 *   2. Jaccard 文本相似度 dedup（默认 0.85 阈值）
 *   3. 类型多样性：单一 page type 不超过 60%
 *   4. 每 page chunk 上限（默认 2，可由 detail level 控制）
 *
 * 输入是 RRF + cosine re-score 后的 chunk 列表，输出是收敛后的 chunk 列表。
 */

import type { ChunkCandidate, SearchDebug } from "./types.ts";

const COSINE_DEDUP_THRESHOLD = 0.85;
const MAX_TYPE_RATIO = 0.6;
const MAX_PER_PAGE_DEFAULT = 2;

/** RRF 后用的中间结构：保留通道排名供 hit 输出。 */
export interface RankedChunk extends ChunkCandidate {
  /** RRF + cosine-blend 后的最终得分 */
  score: number;
  keywordRank: number | null;
  semanticRank: number | null;
  /** debug=true 时累积的中间值；其它路径 undefined */
  debug?: Partial<SearchDebug>;
}

export interface DedupOpts {
  cosineThreshold?: number;
  maxTypeRatio?: number;
  maxPerPage?: number;
}

function pageKey(r: RankedChunk): string {
  return r.slug;
}

export function dedupChunks(results: RankedChunk[], opts: DedupOpts = {}): RankedChunk[] {
  const threshold = opts.cosineThreshold ?? COSINE_DEDUP_THRESHOLD;
  const maxRatio = opts.maxTypeRatio ?? MAX_TYPE_RATIO;
  const maxPerPage = opts.maxPerPage ?? MAX_PER_PAGE_DEFAULT;

  // 保留 pre-dedup 池给 compiled_truth 兜底用
  const preDedup = results;

  let out = results;
  out = topNPerPage(out, 3);
  out = dedupByTextSimilarity(out, threshold);
  out = enforceTypeDiversity(out, maxRatio);
  out = capPerPage(out, maxPerPage);
  out = guaranteeCompiledTruth(out, preDedup);
  return out;
}

/**
 * 借鉴 gbrain：每个 page 至少保留 1 条 compiled_truth chunk。
 * 没有则从 pre-dedup 池里抢一条最高分的 compiled_truth 顶替本页最低分 chunk。
 *
 * ae-wiki 的 chunkType='compiled_truth' 目前 schema 预留、Stage 2 未写入；
 * 该函数是空跑（identity）直到 ingest 开始标这个类型。
 */
function guaranteeCompiledTruth(
  results: RankedChunk[],
  preDedup: RankedChunk[]
): RankedChunk[] {
  const byPage = new Map<string, RankedChunk[]>();
  for (const r of results) {
    const k = pageKey(r);
    const arr = byPage.get(k) ?? [];
    arr.push(r);
    byPage.set(k, arr);
  }

  const output = [...results];
  for (const [key, pageChunks] of byPage) {
    if (pageChunks.some((c) => c.chunkType === "compiled_truth")) continue;
    const candidate = preDedup
      .filter((r) => pageKey(r) === key && r.chunkType === "compiled_truth")
      .sort((a, b) => b.score - a.score)[0];
    if (!candidate) continue;
    const lowestIdx = output.reduce((minIdx, r, idx) => {
      if (pageKey(r) !== key) return minIdx;
      if (minIdx === -1) return idx;
      return r.score < output[minIdx]!.score ? idx : minIdx;
    }, -1);
    if (lowestIdx !== -1) output[lowestIdx] = candidate;
  }
  return output;
}

function topNPerPage(results: RankedChunk[], n: number): RankedChunk[] {
  const byPage = new Map<string, RankedChunk[]>();
  for (const r of results) {
    const k = pageKey(r);
    const existing = byPage.get(k) || [];
    existing.push(r);
    byPage.set(k, existing);
  }
  const kept: RankedChunk[] = [];
  for (const chunks of byPage.values()) {
    chunks.sort((a, b) => b.score - a.score);
    kept.push(...chunks.slice(0, n));
  }
  return kept.sort((a, b) => b.score - a.score);
}

function dedupByTextSimilarity(results: RankedChunk[], threshold: number): RankedChunk[] {
  const kept: RankedChunk[] = [];
  for (const r of results) {
    const rWords = new Set(r.chunkText.toLowerCase().split(/\s+/).filter(Boolean));
    let tooSimilar = false;
    for (const k of kept) {
      const kWords = new Set(k.chunkText.toLowerCase().split(/\s+/).filter(Boolean));
      const intersection = new Set([...rWords].filter((w) => kWords.has(w)));
      const union = new Set([...rWords, ...kWords]);
      if (union.size === 0) continue;
      const jaccard = intersection.size / union.size;
      if (jaccard > threshold) {
        tooSimilar = true;
        break;
      }
    }
    if (!tooSimilar) kept.push(r);
  }
  return kept;
}

function enforceTypeDiversity(results: RankedChunk[], maxRatio: number): RankedChunk[] {
  const maxPerType = Math.max(1, Math.ceil(results.length * maxRatio));
  const typeCounts = new Map<string, number>();
  const kept: RankedChunk[] = [];
  for (const r of results) {
    const c = typeCounts.get(r.type) || 0;
    if (c < maxPerType) {
      kept.push(r);
      typeCounts.set(r.type, c + 1);
    }
  }
  return kept;
}

function capPerPage(results: RankedChunk[], maxPerPage: number): RankedChunk[] {
  const counts = new Map<string, number>();
  const kept: RankedChunk[] = [];
  for (const r of results) {
    const k = pageKey(r);
    const c = counts.get(k) || 0;
    if (c < maxPerPage) {
      kept.push(r);
      counts.set(k, c + 1);
    }
  }
  return kept;
}

/**
 * 把 chunk-level 列表收敛到 page-level：每个 page 取最高分 chunk 作为代表，
 * page score = 该代表 chunk 的 score。用于最终 SearchHit 输出。
 */
export function bestChunkPerPage(results: RankedChunk[]): RankedChunk[] {
  const seen = new Set<string>();
  const kept: RankedChunk[] = [];
  for (const r of results) {
    const k = pageKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(r);
  }
  return kept;
}
