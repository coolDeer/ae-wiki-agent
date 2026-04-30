/**
 * Stage 5 Tier B: 从 raw_data sidecar 的表格里抽 fact。
 *
 * 两种表格 layout 都覆盖：
 *   - **Explicit**：headers 含 metric / value / period / entity / unit 等明确列
 *   - **Matrix**：headers 行 = entity/metric，列 = period（FY26E / 1Q25A / ...）
 *     一行 metric × N period 列 = N 个 fact
 *
 * 每条 fact 带表格 provenance（table_id / row_index / column_index / cell_ref /
 * header_path / period_header / metric_header），下游 MCP `query_facts(table_only)`
 * 与 `compare_table_facts` 据此回查源表。
 *
 * 单元格解析（unit / value / metric / period 归一）全部封装在本文件，
 * 与 Tier A / C 完全解耦。
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { isTableBundle, type TableArtifact } from "~/core/v2-tables.ts";
import type { YamlFact } from "./stage-5-types.ts";

// =============================================================================
// 入口
// =============================================================================

export async function extractTierBFromTables(
  pageId: bigint,
  content: string
): Promise<YamlFact[]> {
  const pageEntity = inferSingleEntitySlug(content);
  const facts: YamlFact[] = [];
  const tableSources = await loadTableSources(pageId);

  for (const table of tableSources) {
    facts.push(...extractExplicitFacts(table, pageEntity));
    facts.push(...extractMatrixFacts(table, pageEntity));
  }

  return dedupeYamlFacts(facts);
}

// =============================================================================
// raw_data sidecar 加载
// =============================================================================

interface TableLike {
  tableId: string;
  headers: string[];
  rows: string[][];
  raw: string;
  rowRaws: string[];
}

async function loadTableSources(pageId: bigint): Promise<TableLike[]> {
  const [raw] = await db
    .select({ data: schema.rawData.data })
    .from(schema.rawData)
    .where(
      and(
        eq(schema.rawData.pageId, pageId),
        eq(schema.rawData.source, "tables"),
        eq(schema.rawData.deleted, 0)
      )
    )
    .limit(1);

  if (raw && isTableBundle(raw.data)) {
    return raw.data.tables.map(fromArtifactTable);
  }
  return [];
}

function fromArtifactTable(table: TableArtifact): TableLike {
  return {
    tableId: table.table_id,
    headers: table.headers,
    rows: table.rows,
    raw: table.raw_markdown,
    rowRaws: table.row_markdowns,
  };
}

// =============================================================================
// Explicit table（headers 显式标 metric/value/...）
// =============================================================================

// Header 别名（normalize 后的小写 / CJK 形态）。中文 header 是中文 source 表格主流。
const ENTITY_ALIASES = [
  "entity", "company", "target", "subject", "ticker", "slug",
  "公司", "公司名称", "股票", "股票代码", "标的", "名称",
];
const METRIC_ALIASES = [
  "metric", "item", "kpi",
  "指标", "项目", "科目", "内容",
];
const PERIOD_ALIASES = [
  "period", "quarter", "timeframe", "date", "fiscal_period",
  "期间", "季度", "财年", "日期",
];
const VALUE_ALIASES = [
  "value", "data", "figure", "amount", "result", "number",
  "数值", "数据", "金额", "数字",
];
const UNIT_ALIASES = [
  "unit", "currency", "multiple",
  "单位", "货币",
];

function extractExplicitFacts(
  table: TableLike,
  pageEntity: string | null
): YamlFact[] {
  const headers = table.headers.map(normalizeHeader);
  const entityIdx = findHeaderIndex(headers, ENTITY_ALIASES);
  const metricIdx = findHeaderIndex(headers, METRIC_ALIASES);
  const periodIdx = findHeaderIndex(headers, PERIOD_ALIASES);
  const valueIdx = findHeaderIndex(headers, VALUE_ALIASES);
  const unitIdx = findHeaderIndex(headers, UNIT_ALIASES);

  if (metricIdx === -1 || valueIdx === -1) return [];

  const facts: YamlFact[] = [];
  for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
    const row = table.rows[rowIdx] ?? [];
    const rowRaw = table.rowRaws[rowIdx] ?? table.raw;

    const entity = resolveEntitySlug(
      entityIdx === -1 ? "" : row[entityIdx] ?? "",
      pageEntity
    );
    if (!entity) continue;

    const metricMeta = parseMetricCell(row[metricIdx] ?? "");
    if (!metricMeta.metric) continue;

    const parsedValue = parseValueCell(
      row[valueIdx] ?? "",
      unitIdx === -1 ? null : row[unitIdx] ?? null,
      metricMeta.unit
    );
    if (!parsedValue) continue;

    facts.push({
      entity,
      metric: metricMeta.metric,
      period: periodIdx === -1 ? undefined : normalizePeriod(row[periodIdx] ?? ""),
      value: parsedValue.value,
      unit: parsedValue.unit ?? metricMeta.unit ?? undefined,
      source_quote: rowRaw,
      table_id: table.tableId,
      row_index: rowIdx,
      column_index: valueIdx,
      period_header:
        periodIdx === -1 ? undefined : (table.headers[periodIdx] ?? undefined),
      metric_header: table.headers[metricIdx] ?? undefined,
      cell_ref: toCellRef(rowIdx, valueIdx),
      header_path: compactHeaders([
        table.headers[metricIdx] ?? undefined,
        table.headers[valueIdx] ?? undefined,
      ]),
    });
  }

  return facts;
}

// =============================================================================
// Matrix table（列 = period）
// =============================================================================

function extractMatrixFacts(
  table: TableLike,
  pageEntity: string | null
): YamlFact[] {
  const headers = table.headers.map(normalizeHeader);
  const metricIdx = findHeaderIndex(headers, METRIC_ALIASES);
  if (metricIdx === -1) return [];

  const entityIdx = findHeaderIndex(headers, ENTITY_ALIASES);
  const unitIdx = findHeaderIndex(headers, UNIT_ALIASES);
  const explicitValueIdx = findHeaderIndex(headers, VALUE_ALIASES);
  if (explicitValueIdx !== -1) return [];

  const periodColumns = headers
    .map((header, idx) => ({ header, idx, raw: table.headers[idx] ?? "" }))
    .filter(({ idx }) => idx !== metricIdx && idx !== entityIdx && idx !== unitIdx)
    .filter(({ raw }) => looksLikePeriodHeader(raw));

  if (periodColumns.length === 0) return [];

  const facts: YamlFact[] = [];
  for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
    const row = table.rows[rowIdx] ?? [];
    const rowRaw = table.rowRaws[rowIdx] ?? table.raw;
    const entity = resolveEntitySlug(
      entityIdx === -1 ? "" : row[entityIdx] ?? "",
      pageEntity
    );
    if (!entity) continue;

    const metricMeta = parseMetricCell(row[metricIdx] ?? "");
    if (!metricMeta.metric) continue;

    const inheritedUnit =
      metricMeta.unit ?? (unitIdx === -1 ? null : parseUnitText(row[unitIdx] ?? ""));

    for (const column of periodColumns) {
      const parsedValue = parseValueCell(row[column.idx] ?? "", null, inheritedUnit);
      if (!parsedValue) continue;

      facts.push({
        entity,
        metric: metricMeta.metric,
        period: normalizePeriod(column.raw),
        value: parsedValue.value,
        unit: parsedValue.unit ?? inheritedUnit ?? undefined,
        source_quote: rowRaw,
        table_id: table.tableId,
        row_index: rowIdx,
        column_index: column.idx,
        period_header: column.raw,
        metric_header: table.headers[metricIdx] ?? undefined,
        cell_ref: toCellRef(rowIdx, column.idx),
        header_path: compactHeaders([
          table.headers[metricIdx] ?? undefined,
          column.raw,
        ]),
      });
    }
  }

  return facts;
}

// =============================================================================
// dedupe
// =============================================================================

function dedupeYamlFacts(facts: YamlFact[]): YamlFact[] {
  const seen = new Set<string>();
  const result: YamlFact[] = [];
  for (const fact of facts) {
    const key = [
      String(fact.entity).trim(),
      String(fact.metric).trim(),
      String(fact.period ?? "").trim(),
      String(fact.value).trim(),
      String(fact.unit ?? "").trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }
  return result;
}

// =============================================================================
// header / cell 解析（私有 helpers）
// =============================================================================

function findHeaderIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function normalizeHeader(header: string): string {
  // 保留 a-z / 0-9 / CJK 字符（U+3400-9FFF 覆盖中日韩统一表意 + 兼容扩展），
  // 其他全部当分隔符 → "_"。否则 "公司名称" 会被全部 strip 成空串。
  return stripMarkdown(header)
    .toLowerCase()
    .replace(/[%/()]+/g, " ")
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseMetricCell(cell: string): { metric: string | null; unit: string | null } {
  const stripped = stripMarkdown(cell).trim();
  if (stripped.length === 0) return { metric: null, unit: null };

  const unitMatch = stripped.match(/\(([^)]+)\)\s*$/);
  const unit = unitMatch ? parseUnitText(unitMatch[1] ?? "") : null;
  const metricText = stripped.replace(/\(([^)]+)\)\s*$/, "").trim();
  const metric = metricText
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return {
    metric: metric.length > 0 ? metric : null,
    unit,
  };
}

function parseValueCell(
  cell: string,
  unitCell: string | null,
  inheritedUnit: string | null
): { value: number | string; unit: string | null } | null {
  const stripped = stripMarkdown(cell).trim();
  if (stripped.length === 0 || /^(-|n\/a|na|nm|none)$/i.test(stripped)) {
    return null;
  }

  const explicitUnit = parseUnitText(unitCell ?? "") ?? inheritedUnit;
  let working = stripped;
  let detectedUnit = explicitUnit;

  if (working.includes("%")) {
    detectedUnit = "pct";
    working = working.replace(/%/g, "");
  }

  const currencyPrefix =
    working.match(/^\s*(USD|US\$|\$|JPY|¥|CNY|RMB|CN¥|EUR|€|GBP|£)\s*/i)?.[1] ?? null;
  if (currencyPrefix) {
    working = working.replace(/^\s*(USD|US\$|\$|JPY|¥|CNY|RMB|CN¥|EUR|€|GBP|£)\s*/i, "");
  }

  const scaleMatch =
    working.match(/\s*(bn|billion|b|mm|million|m|k|x)\s*$/i)?.[1] ?? null;
  if (scaleMatch) {
    working = working.replace(/\s*(bn|billion|b|mm|million|m|k|x)\s*$/i, "");
  }

  const numericText = working.replace(/,/g, "").trim();
  if (/^[+-]?\d*\.?\d+$/.test(numericText)) {
    const value = Number(numericText);
    if (!Number.isFinite(value)) return null;

    if (!detectedUnit) {
      detectedUnit = inferUnitFromCurrencyAndScale(currencyPrefix, scaleMatch);
    }

    return { value, unit: detectedUnit };
  }

  return { value: stripped, unit: detectedUnit };
}

function inferUnitFromCurrencyAndScale(
  currencyPrefix: string | null,
  scale: string | null
): string | null {
  const currency = currencyPrefix?.toLowerCase() ?? "";
  const normalizedScale = scale?.toLowerCase() ?? "";

  if (normalizedScale === "x") return "x";

  if (currency === "$" || currency === "usd" || currency === "us$") {
    if (normalizedScale === "m" || normalizedScale === "mm" || normalizedScale === "million")
      return "usd_m";
    if (normalizedScale === "bn" || normalizedScale === "b" || normalizedScale === "billion")
      return "usd_bn";
    return "usd";
  }
  if (currency === "¥" || currency === "jpy") {
    if (normalizedScale === "m" || normalizedScale === "mm" || normalizedScale === "million")
      return "jpy_m";
    return "jpy";
  }
  if (currency === "cny" || currency === "rmb" || currency === "cn¥") {
    if (normalizedScale === "bn" || normalizedScale === "b" || normalizedScale === "billion")
      return "cny_bn";
    if (normalizedScale === "m" || normalizedScale === "mm" || normalizedScale === "million")
      return "cny_m";
    return "cny";
  }
  if (currency === "€" || currency === "eur") return "eur";
  if (currency === "£" || currency === "gbp") return "gbp";

  if (normalizedScale === "x") return "x";
  return null;
}

function parseUnitText(text: string): string | null {
  const normalized = stripMarkdown(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length === 0) return null;
  if (normalized === "%" || normalized.includes("pct") || normalized.includes("percent"))
    return "pct";
  if (normalized === "x" || normalized.includes("turn")) return "x";
  if (/(usd|us\$|\$).*(bn|billion| b)/.test(normalized)) return "usd_bn";
  if (/(usd|us\$|\$).*(mm|million| m)/.test(normalized)) return "usd_m";
  if (/(jpy|¥).*(mm|million| m)/.test(normalized)) return "jpy_m";
  if (/(cny|rmb|cn¥).*(bn|billion| b)/.test(normalized)) return "cny_bn";
  if (/(cny|rmb|cn¥).*(mm|million| m)/.test(normalized)) return "cny_m";
  if (normalized === "usd" || normalized === "$") return "usd";
  if (normalized === "jpy" || normalized === "¥") return "jpy";
  if (normalized === "cny" || normalized === "rmb" || normalized === "cn¥") return "cny";
  return normalized.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || null;
}

function looksLikePeriodHeader(header: string): boolean {
  const value = stripMarkdown(header).trim();
  if (value.length === 0) return false;

  // 英文：current / TTM / LTM / NTM / FY26 / FY26E / 1Q25A / H1 26 / 2026-04-15 / 2026E ...
  if (
    /^(current|ttm|ltm|ntm|fy\d{2,4}[ae]?|[1-4]q\d{2,4}[ae]?|h[12]\d{2,4}[ae]?|\d{4}-\d{2}-\d{2}|\d{4}[ae]?)$/i.test(
      value
    )
  ) {
    return true;
  }

  // 中文：常见研报表头
  //   "25年预期EPS" / "26年" / "27PE" / "25年实际" / "2025E" / "1Q25"
  //   "FY26下半年" / "Q3-FY26" / "上次给出的关键展望" → 不算
  if (/^\d{2,4}年(预期|实际|目标)?(?:[\u4e00-\u9fff]+)?$/.test(value)) return true;
  if (/^\d{2,4}(?:Q[1-4]|H[12]|PE|EV|EPS)?$/i.test(value)) return true;
  if (/^FY?\d{2,4}(?:[ae]|下半年|上半年)?$/i.test(value)) return true;

  return false;
}

function normalizePeriod(value: string): string | undefined {
  const stripped = stripMarkdown(value).trim();
  return stripped.length > 0 ? stripped : undefined;
}

function resolveEntitySlug(cell: string, fallback: string | null): string | null {
  const explicit = extractEntitySlugs(cell);
  if (explicit.length === 1) return explicit[0] ?? null;

  const stripped = stripMarkdown(cell).trim();
  if (/^(companies|industries|concepts)\/.+/.test(stripped)) {
    return stripped;
  }

  if (explicit.length === 0) return fallback;
  return null;
}

function inferSingleEntitySlug(content: string): string | null {
  const slugs = extractEntitySlugs(content);
  const unique = Array.from(new Set(slugs));
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

function extractEntitySlugs(text: string): string[] {
  const matches = Array.from(
    text.matchAll(/\[\[((?:companies|industries|concepts)\/[^\]|]+)(?:\|[^\]]+)?\]\]/g)
  );
  return matches.map((match) => match[1] ?? "").filter((slug) => slug.length > 0);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function toCellRef(rowIndex: number, columnIndex: number): string {
  return `r${rowIndex}c${columnIndex}`;
}

function compactHeaders(headers: Array<string | undefined>): string[] {
  return headers.filter(
    (header): header is string => Boolean(header && header.trim().length > 0)
  );
}
