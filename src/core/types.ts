/**
 * 跨模块共享的"非 schema"类型。
 *
 * Schema 类型直接从 src/core/schema/ 导入（如 `Page`, `Fact` 等）。
 */

/** 实体引用（链接抽取阶段的中间产物）。 */
export interface EntityRef {
  /** Markdown 显示文本，如 "ServiceNow"。 */
  name: string;
  /** Resolved page slug，如 "companies/ServiceNow"。 */
  slug: string;
  /** 顶级目录 ("companies" | "persons" | ...)。 */
  dir: string;
}

/** Fact 抽取阶段产生的临时结构（落表前）。 */
export interface ExtractedFact {
  entitySlug: string;             // resolve 到 entity_page_id 后写表
  metric: string;
  period?: string;
  value_numeric?: number;
  value_text?: string;
  unit?: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

/** Chunk 抽取阶段产生的临时结构。 */
export interface ChunkInput {
  text: string;
  type: "text" | "list" | "table" | "chart" | "compiled_truth";
  pageIdx?: number;
}

/** ingest pipeline 各 stage 的共享上下文。 */
export interface IngestContext {
  rawFileId: bigint;
  pageId: bigint;            // Stage 1 后填上
  rawMarkdown: string;
  contentListJson?: unknown;  // mineru content_list.json，可选
  actor: string;             // 'system:ingest' / 'agent:claude'
}
