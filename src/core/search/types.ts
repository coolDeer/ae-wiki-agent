/**
 * 共享 search 类型。
 *
 * ChunkCandidate 是各通道（keyword / vector）返回的统一形态，
 * 经 RRF + dedup 后映射回 page-level 的 SearchHit（向后兼容 mcp / web 消费方）。
 */

export type Detail = "low" | "medium" | "high";

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

  /** 显式指定 detail level（否则按 query intent 自动判定）*/
  detail?: Detail;
  /** 覆盖默认 RRF K（默认 60；越小则越偏向头部） */
  rrfK?: number;
  /** 是否做多 query 扩展（默认读 env WIKI_QUERY_EXPANSION） */
  expansion?: boolean;
  /** dedup 参数覆盖 */
  dedupOpts?: {
    cosineThreshold?: number;
    maxTypeRatio?: number;
    maxPerPage?: number;
  };
}

/** 单通道返回的 chunk 候选。 */
export interface ChunkCandidate {
  pageId: bigint;
  slug: string;
  type: string; // page type
  title: string;
  ticker: string | null;

  chunkId: bigint;
  chunkText: string;
  chunkType: string;

  /** 通道内排序得分（已乘 source_factor） */
  score: number;
}

/** 经 hybrid orchestrator 返回的 page-level 命中。 */
export interface SearchHit {
  pageId: bigint;
  slug: string;
  type: string;
  title: string;
  ticker: string | null;
  /** RRF + cosine re-score + boost 后的最终得分 */
  score: number;
  keywordRank: number | null;
  semanticRank: number | null;
  bestChunk: string | null;
  chunkId: bigint | null;
  chunkType: string | null;
}
