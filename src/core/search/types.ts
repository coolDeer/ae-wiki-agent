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
  /**
   * Debug 模式：每个 SearchHit 附带 `debug: SearchDebug` 字段，含 RRF / cosine /
   * boost / final score 的中间值。生产路径默认关；UI 通过 `?debug=1` 触发。
   */
  debug?: boolean;
}

export interface SearchDebug {
  /** RRF 原始 score（融合时累加 1/(K+rank)） */
  rrfRaw: number;
  /** RRF 归一化（除以本批 maxRrf） */
  rrfNorm: number;
  /** source-aware boost (compiled_truth = 2.0 / 默认 1.0) */
  rrfBoost: number;
  /** cosine 相似度（缺 embedding 时为 null） */
  cosine: number | null;
  /** 0.7·rrfNorm + 0.3·cosine（缺 embedding 时取中性 0.5） */
  blendedScore: number;
  /** 反向链接数（粗略） */
  backlinkCount: number;
  /** 反链 boost factor（已 cap 在 BACKLINK_BOOST_MAX）*/
  backlinkBoost: number;
  /** 最终 score（dedup / page-level 收敛之前） */
  finalScore: number;
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
  /** V2 chunker 写入；老数据为 null。e.g. ["专家观点","Q3 风险"] */
  sectionPath: string[] | null;

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
  /** 命中 chunk 的 section_path（V2 chunker 写入，markdown chunker 老数据为 null） */
  sectionPath: string[] | null;
  /** Debug 模式（SearchOpts.debug=true）下填；普通查询不存在此字段 */
  debug?: SearchDebug;
}
