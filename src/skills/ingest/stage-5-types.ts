/**
 * Stage 5 fact 抽取共享类型。
 *
 * 三层抽取（A: YAML / B: 表格 / C: LLM）共用同一种输入形态 `YamlFact`，
 * 进 orchestrator 时挂上 `extractedBy` 成 `CandidateFact`，
 * 通过 normalize() 落表前转成 `NormalizedFact`（DB schema 列对齐）。
 */

export type ExtractedBy = "tier_a" | "tier_b" | "tier_c";

export interface YamlFact {
  entity: string;
  metric: string;
  period?: string;
  value: number | string;
  unit?: string;
  source_quote?: string;
  confidence?: number;
  /** 表格 provenance（仅 Tier B 写入） */
  table_id?: string;
  row_index?: number;
  column_index?: number;
  period_header?: string;
  metric_header?: string;
  cell_ref?: string;
  header_path?: string[];
}

export interface CandidateFact extends YamlFact {
  extractedBy: ExtractedBy;
}

export interface NormalizedFact {
  entity_page_id: bigint;
  metric: string;
  period: string | null;
  value_numeric: string | null;
  value_text: string | null;
  unit: string | null;
  confidence: string;
  source_quote: string | null;
  extracted_by: ExtractedBy;
  table_id: string | null;
  row_index: number | null;
  column_index: number | null;
  period_header: string | null;
  metric_header: string | null;
  cell_ref: string | null;
  header_path: string[] | null;
}
