/**
 * Stage 5 Fact 抽取 orchestrator —— 三层调度 + 落库。
 *
 * 三层抽取（实现拆到独立模块）：
 *   - Tier A: stage-5-tier-a.ts — `<!-- facts ... -->` YAML 直读
 *   - Tier B: stage-5-tier-b.ts — markdown table 结构化解析
 *   - Tier C: stage-5-tier-c.ts — LLM 兜底（OPENAI_FACT_EXTRACT_MODEL，env STAGE5_TIER_C_DISABLED 关）
 *
 * orchestrator 职责（保留在本文件）：
 *   1. 取 page.content
 *   2. 跑 A / B 两层
 *   3. 用 (entity, metric, period) 三元组算 alreadyKeys，传给 Tier C 让它从 prose 补漏
 *   4. dedupe + normalize（含 pct 自动归一 100→1）
 *   5. 同 (entity, metric, period) 旧 fact 标 valid_to=today（覆盖语义）
 *   6. INSERT 新 fact，metadata.extracted_by ∈ {tier_a, tier_b, tier_c}
 */

import { eq, and, isNull, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import { resolveOrCreatePage } from "./_helpers.ts";
import type { IngestContext } from "~/core/types.ts";
import { extractTierA } from "./stage-5-tier-a.ts";
import { extractTierBFromTables } from "./stage-5-tier-b.ts";
import { extractTierC } from "./stage-5-tier-c.ts";
import type {
  CandidateFact,
  ExtractedBy,
  NormalizedFact,
  YamlFact,
} from "./stage-5-types.ts";

export async function stage5Facts(ctx: IngestContext): Promise<void> {
  const [page] = await db
    .select({ content: schema.pages.content })
    .from(schema.pages)
    .where(eq(schema.pages.id, ctx.pageId))
    .limit(1);
  if (!page) return;

  const tierA: CandidateFact[] = extractTierA(page.content).map((fact) => ({
    ...fact,
    extractedBy: "tier_a" as const,
  }));
  const tierB: CandidateFact[] = (
    await extractTierBFromTables(ctx.pageId, page.content)
  ).map((fact) => ({ ...fact, extractedBy: "tier_b" as const }));

  console.log(`  [stage5] tier A: ${tierA.length} candidate facts`);
  console.log(`  [stage5] tier B: ${tierB.length} candidate facts`);

  // Tier C：把 A+B 已有的 (entity, metric, period) 传过去，让 LLM 只补漏
  const alreadyKeys = new Set<string>();
  for (const f of [...tierA, ...tierB]) {
    alreadyKeys.add(
      `${String(f.entity).trim()}|${String(f.metric).trim()}|${String(f.period ?? "").trim()}`
    );
  }
  const tierCRaw = await extractTierC(page.content, alreadyKeys);
  const tierC: CandidateFact[] = tierCRaw.map((fact) => ({
    entity: fact.entity,
    metric: fact.metric,
    period: fact.period,
    value: fact.value,
    unit: fact.unit,
    source_quote: fact.source_quote,
    confidence: fact.confidence,
    extractedBy: "tier_c" as const,
  }));

  const candidates = dedupeCandidates([...tierA, ...tierB, ...tierC]);
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

// =============================================================================
// dedupe + normalize（orchestrator 私有）
// =============================================================================

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

function candidateKey(fact: CandidateFact): string {
  return [
    String(fact.entity).trim(),
    String(fact.metric).trim(),
    String(fact.period ?? "").trim(),
    String(fact.value).trim(),
    String(fact.unit ?? "").trim(),
  ].join("|");
}

async function normalize(
  f: YamlFact,
  ctx: IngestContext,
  extractedBy: ExtractedBy
): Promise<NormalizedFact | null> {
  if (!f.entity || typeof f.entity !== "string") return null;

  const entityPageId = await resolveOrCreatePage(f.entity, {
    actor: ctx.actor,
    autoCreate: true,
    sourcePageId: ctx.pageId,
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
