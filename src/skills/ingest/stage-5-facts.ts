/**
 * Stage 5: 三层 Fact 抽取
 *
 * Tier A: <!-- facts ... --> YAML block 直读（agent 在 Stage 3 写入）✓ 实现
 * Tier B: narrative markdown table fallback                              ✓ MVP
 * Tier C: LLM 兜底（默认开启 Haiku）                                      - TODO
 *
 * 流程：
 *   1. 读 page.content
 *   2. Tier A 解析 YAML 块
 *   3. Tier B 从 markdown table 补漏
 *   4. 对每条 YamlFact:
 *      - resolveOrCreatePage(entity slug) → entity_page_id
 *      - 校验 + 单位归一（pct 自动 100→1）
 *      - 同 (entity, metric, period) 已有 fact 标 valid_to=today（覆盖语义）
 *      - INSERT 新 fact
 *
 * ─── TODO: Tier C LLM 兜底（决策：跳过 Tier B，直接 A → C） ─────────
 *
 * 为什么需要：agent 在 Stage 3 写 narrative 时可能漏写 <!-- facts --> 块，
 *   漏掉的 fact 不会进结构化层，影响 query_facts MCP 工具和 thesis 跟踪。
 *
 * 为什么跳过 Tier B：中英混合场景下正则维护成本高、ROI 低；
 *   且 Tier C 带 source_quote 可校验，比正则更准、更鲁棒。
 *   未来若发现 LLM 漏抓的高频 pattern，再针对性补 B。
 *
 * 实现要点：
 *   - 输入：page.content + Tier A 已抽到的 (entity, metric, period) 列表
 *           （传给模型让它只补漏，不重复）
 *   - 模型：env.OPENAI_FACT_EXTRACT_MODEL（默认 gpt-5-mini）
 *   - 输出：JSON schema 约束 YamlFact[]，必须带 source_quote
 *   - 校验：source_quote 必须是 page.content 子串（防幻觉）；
 *           不过校验的标 confidence=0.5 或丢弃
 *   - 开关：config 表的 'fact_extract_llm_enabled'（默认 true）
 *   - 复用：normalize() / resolveOrCreatePage()，extracted_by='tier_c'
 *   - 成本：单 source ~5K input token，Haiku 4.5 ≈ $0.005/份，可忽略
 */

import { eq, and, isNull, sql as drizzleSql } from "drizzle-orm";
import * as YAML from "yaml";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import { resolveOrCreatePage } from "./_helpers.ts";
import type { IngestContext } from "~/core/types.ts";
import {
  isMarkdownTableBundle,
  parseMarkdownTables,
  type MarkdownTableArtifact,
} from "~/core/markdown-tables.ts";

interface YamlFact {
  entity: string;
  metric: string;
  period?: string;
  value: number | string;
  unit?: string;
  source_quote?: string;
  confidence?: number;
  table_id?: string;
  row_index?: number;
  column_index?: number;
  period_header?: string;
  metric_header?: string;
  cell_ref?: string;
  header_path?: string[];
}

interface NormalizedFact {
  entity_page_id: bigint;
  metric: string;
  period: string | null;
  value_numeric: string | null;
  value_text: string | null;
  unit: string | null;
  confidence: string;
  source_quote: string | null;
  extracted_by: "tier_a" | "tier_b" | "tier_c";
  table_id: string | null;
  row_index: number | null;
  column_index: number | null;
  period_header: string | null;
  metric_header: string | null;
  cell_ref: string | null;
  header_path: string[] | null;
}

interface CandidateFact extends YamlFact {
  extractedBy: "tier_a" | "tier_b";
}

export async function stage5Facts(ctx: IngestContext): Promise<void> {
  const [page] = await db
    .select({ content: schema.pages.content })
    .from(schema.pages)
    .where(eq(schema.pages.id, ctx.pageId))
    .limit(1);
  if (!page) return;

  const tierA = extractTierA(page.content).map((fact) => ({
    ...fact,
    extractedBy: "tier_a" as const,
  }));
  const tierB = (await extractTierBFromTables(ctx.pageId, page.content)).map((fact) => ({
    ...fact,
    extractedBy: "tier_b" as const,
  }));
  const candidates = dedupeCandidates([...tierA, ...tierB]);

  console.log(`  [stage5] tier A: ${tierA.length} candidate facts`);
  console.log(`  [stage5] tier B: ${tierB.length} candidate facts`);

  if (candidates.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0;
  let skipped = 0;

  for (const f of candidates) {
    const normalized = await normalize(f, ctx, f.extractedBy);
    if (!normalized) {
      skipped++;
      continue;
    }

    // 同 (entity, metric, period) 旧 fact → valid_to=today
    await db
      .update(schema.facts)
      .set({
        validTo: today,
        updateBy: ctx.actor,
        updateTime: new Date(),
      })
      .where(
        and(
          eq(schema.facts.entityPageId, normalized.entity_page_id),
          eq(schema.facts.metric, normalized.metric),
          drizzleSql`${schema.facts.period} IS NOT DISTINCT FROM ${normalized.period}`,
          isNull(schema.facts.validTo),
          eq(schema.facts.deleted, 0)
        )
      );

    // 插入新 fact
    await db.insert(schema.facts).values(
      withCreateAudit(
        {
          entityPageId: normalized.entity_page_id,
          sourcePageId: ctx.pageId,
          metric: normalized.metric,
          period: normalized.period,
          valueNumeric: normalized.value_numeric,
          valueText: normalized.value_text,
          unit: normalized.unit,
          confidence: normalized.confidence,
          validFrom: today,
          metadata: {
            extracted_by: normalized.extracted_by,
            source_quote: normalized.source_quote,
            ...(normalized.table_id
              ? {
                  table_id: normalized.table_id,
                  row_index: normalized.row_index,
                  column_index: normalized.column_index,
                  period_header: normalized.period_header,
                  metric_header: normalized.metric_header,
                  cell_ref: normalized.cell_ref,
                  header_path: normalized.header_path,
                }
              : {}),
          },
        },
        ctx.actor
      )
    );
    inserted++;
  }

  console.log(`  [stage5] inserted=${inserted} skipped=${skipped}`);
}

function extractTierA(content: string): YamlFact[] {
  const m = content.match(/<!--\s*facts\s*\n([\s\S]+?)\n\s*-->/);
  if (!m || !m[1]) return [];

  try {
    const parsed = YAML.parse(m[1]);
    if (!Array.isArray(parsed)) {
      console.warn("  [stage5:tierA] facts block 不是数组");
      return [];
    }
    return parsed.filter(
      (f: unknown): f is YamlFact =>
        typeof f === "object" &&
        f !== null &&
        "entity" in f &&
        "metric" in f &&
        "value" in f
    );
  } catch (e) {
    console.warn(`  [stage5:tierA] YAML 解析失败:`, (e as Error).message);
    return [];
  }
}

async function extractTierBFromTables(
  pageId: bigint,
  content: string
): Promise<YamlFact[]> {
  const pageEntity = inferSingleEntitySlug(content);
  const facts: YamlFact[] = [];
  const tableSources = await loadTableSources(pageId, content);

  for (const table of tableSources) {
    facts.push(...extractExplicitFacts(table, pageEntity));
    facts.push(...extractMatrixFacts(table, pageEntity));
  }

  return dedupeYamlFacts(facts);
}

async function loadTableSources(
  pageId: bigint,
  content: string
): Promise<TableLike[]> {
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

  if (raw && isMarkdownTableBundle(raw.data)) {
    return raw.data.tables.map(fromArtifactTable);
  }

  return parseMarkdownTables(content).map((table) => ({
    tableId: table.tableId,
    headers: table.headers,
    rows: table.rows,
    raw: table.raw,
    rowRaws: table.rowRaws,
  }));
}

interface TableLike {
  tableId: string;
  headers: string[];
  rows: string[][];
  raw: string;
  rowRaws: string[];
}

function fromArtifactTable(table: MarkdownTableArtifact): TableLike {
  return {
    tableId: table.table_id,
    headers: table.headers,
    rows: table.rows,
    raw: table.raw_markdown,
    rowRaws: table.row_markdowns,
  };
}

function extractExplicitFacts(
  table: TableLike,
  pageEntity: string | null
): YamlFact[] {
  const headers = table.headers.map(normalizeHeader);
  const entityIdx = findHeaderIndex(headers, ["entity", "company", "target", "subject", "ticker", "slug"]);
  const metricIdx = findHeaderIndex(headers, ["metric", "item", "kpi"]);
  const periodIdx = findHeaderIndex(headers, ["period", "quarter", "timeframe", "date", "fiscal_period"]);
  const valueIdx = findHeaderIndex(headers, ["value", "data", "figure", "amount", "result", "number"]);
  const unitIdx = findHeaderIndex(headers, ["unit", "currency", "multiple"]);

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

function extractMatrixFacts(
  table: TableLike,
  pageEntity: string | null
): YamlFact[] {
  const headers = table.headers.map(normalizeHeader);
  const metricIdx = findHeaderIndex(headers, ["metric", "item", "kpi"]);
  if (metricIdx === -1) return [];

  const entityIdx = findHeaderIndex(headers, ["entity", "company", "target", "subject", "ticker", "slug"]);
  const unitIdx = findHeaderIndex(headers, ["unit", "currency", "multiple"]);
  const explicitValueIdx = findHeaderIndex(headers, ["value", "data", "figure", "amount", "result", "number"]);
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
      const parsedValue = parseValueCell(
        row[column.idx] ?? "",
        null,
        inheritedUnit
      );
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

function dedupeCandidates(facts: CandidateFact[]): CandidateFact[] {
  const seen = new Set<string>();
  const result: CandidateFact[] = [];

  for (const fact of facts) {
    const key = candidateKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }

  return result;
}

function dedupeYamlFacts(facts: YamlFact[]): YamlFact[] {
  const seen = new Set<string>();
  const result: YamlFact[] = [];

  for (const fact of facts) {
    const key = [
      fact.entity.trim(),
      fact.metric.trim(),
      (fact.period ?? "").trim(),
      String(fact.value).trim(),
      (fact.unit ?? "").trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(fact);
  }

  return result;
}

function candidateKey(fact: CandidateFact): string {
  return [
    fact.entity.trim(),
    fact.metric.trim(),
    (fact.period ?? "").trim(),
    String(fact.value).trim(),
    (fact.unit ?? "").trim(),
  ].join("|");
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function normalizeHeader(header: string): string {
  return stripMarkdown(header)
    .toLowerCase()
    .replace(/[%/()]+/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
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
  if (
    stripped.length === 0 ||
    /^(-|n\/a|na|nm|none)$/i.test(stripped)
  ) {
    return null;
  }

  const explicitUnit = parseUnitText(unitCell ?? "") ?? inheritedUnit;
  let working = stripped;
  let detectedUnit = explicitUnit;

  if (working.includes("%")) {
    detectedUnit = "pct";
    working = working.replace(/%/g, "");
  }

  const currencyPrefix = working.match(/^\s*(USD|US\$|\$|JPY|¥|CNY|RMB|CN¥|EUR|€|GBP|£)\s*/i)?.[1] ?? null;
  if (currencyPrefix) {
    working = working.replace(/^\s*(USD|US\$|\$|JPY|¥|CNY|RMB|CN¥|EUR|€|GBP|£)\s*/i, "");
  }

  const scaleMatch = working.match(/\s*(bn|billion|b|mm|million|m|k|x)\s*$/i)?.[1] ?? null;
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

    return {
      value,
      unit: detectedUnit,
    };
  }

  return {
    value: stripped,
    unit: detectedUnit,
  };
}

function inferUnitFromCurrencyAndScale(
  currencyPrefix: string | null,
  scale: string | null
): string | null {
  const currency = currencyPrefix?.toLowerCase() ?? "";
  const normalizedScale = scale?.toLowerCase() ?? "";

  if (normalizedScale === "x") return "x";

  if (currency === "$" || currency === "usd" || currency === "us$") {
    if (normalizedScale === "m" || normalizedScale === "mm" || normalizedScale === "million") return "usd_m";
    if (normalizedScale === "bn" || normalizedScale === "b" || normalizedScale === "billion") return "usd_bn";
    return "usd";
  }
  if (currency === "¥" || currency === "jpy") {
    if (normalizedScale === "m" || normalizedScale === "mm" || normalizedScale === "million") return "jpy_m";
    return "jpy";
  }
  if (currency === "cny" || currency === "rmb" || currency === "cn¥") {
    if (normalizedScale === "bn" || normalizedScale === "b" || normalizedScale === "billion") return "cny_bn";
    if (normalizedScale === "m" || normalizedScale === "mm" || normalizedScale === "million") return "cny_m";
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
  if (normalized === "%" || normalized.includes("pct") || normalized.includes("percent")) return "pct";
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

  return /^(current|ttm|ltm|ntm|fy\d{2,4}[ae]?|[1-4]q\d{2,4}[ae]?|h[12]\d{2,4}[ae]?|\d{4}-\d{2}-\d{2}|\d{4}[ae]?)$/i.test(
    value
  );
}

function normalizePeriod(value: string): string | undefined {
  const stripped = stripMarkdown(value).trim();
  return stripped.length > 0 ? stripped : undefined;
}

function resolveEntitySlug(cell: string, fallback: string | null): string | null {
  const explicit = extractEntitySlugs(cell);
  if (explicit.length === 1) return explicit[0] ?? null;

  const stripped = stripMarkdown(cell).trim();
  if (/^(companies|industries|persons|concepts)\/.+/.test(stripped)) {
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
    text.matchAll(/\[\[((?:companies|industries|persons|concepts)\/[^\]|]+)(?:\|[^\]]+)?\]\]/g)
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

async function normalize(
  f: YamlFact,
  ctx: IngestContext,
  extractedBy: "tier_a" | "tier_b" | "tier_c"
): Promise<NormalizedFact | null> {
  if (!f.entity || typeof f.entity !== "string") return null;

  const entityPageId = await resolveOrCreatePage(f.entity, {
    actor: ctx.actor,
    autoCreate: true,
  });
  if (!entityPageId) return null;

  if (!f.metric || typeof f.metric !== "string") return null;

  let valueNumeric: string | null = null;
  let valueText: string | null = null;
  if (typeof f.value === "number" && Number.isFinite(f.value)) {
    let v = f.value;
    // pct 自动归一：metric 以 _margin/_rate/_pct 结尾，或 unit='pct'，且 v>1.5
    if (
      (f.metric.endsWith("_margin") ||
        f.metric.endsWith("_rate") ||
        f.metric.endsWith("_pct") ||
        f.unit === "pct") &&
      v > 1.5
    ) {
      v = v / 100;
    }
    valueNumeric = v.toString();
  } else if (typeof f.value === "string") {
    const parsed = parseFloat(f.value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      valueNumeric = parsed.toString();
    } else {
      valueText = f.value;
    }
  } else {
    return null;
  }

  return {
    entity_page_id: entityPageId,
    metric: f.metric,
    period: f.period ?? null,
    value_numeric: valueNumeric,
    value_text: valueText,
    unit: f.unit ?? null,
    confidence: (f.confidence ?? 1.0).toString(),
    source_quote: f.source_quote ?? null,
    extracted_by: extractedBy,
    table_id: f.table_id ?? null,
    row_index: typeof f.row_index === "number" ? f.row_index : null,
    column_index: typeof f.column_index === "number" ? f.column_index : null,
    period_header: f.period_header ?? null,
    metric_header: f.metric_header ?? null,
    cell_ref: f.cell_ref ?? null,
    header_path: Array.isArray(f.header_path) ? f.header_path : null,
  };
}

function toCellRef(rowIndex: number, columnIndex: number): string {
  return `r${rowIndex}c${columnIndex}`;
}

function compactHeaders(headers: Array<string | undefined>): string[] {
  return headers.filter((header): header is string => Boolean(header && header.trim().length > 0));
}
