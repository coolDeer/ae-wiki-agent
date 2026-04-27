/**
 * Stage 5: 三层 Fact 抽取
 *
 * Tier A: <!-- facts ... --> YAML block 直读（agent 在 Stage 3 写入）✓ 实现
 * Tier B: 正则模板匹配                                                 - SKIP（见 TODO）
 * Tier C: LLM 兜底（默认开启 Haiku）                                    - TODO
 *
 * 流程：
 *   1. 读 page.content
 *   2. Tier A 解析 YAML 块
 *   3. 对每条 YamlFact:
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
 *   - 模型：env.ANTHROPIC_FACT_EXTRACT_MODEL（默认 claude-haiku-4-5）
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

interface YamlFact {
  entity: string;
  metric: string;
  period?: string;
  value: number | string;
  unit?: string;
  source_quote?: string;
  confidence?: number;
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
}

export async function stage5Facts(ctx: IngestContext): Promise<void> {
  const [page] = await db
    .select({ content: schema.pages.content })
    .from(schema.pages)
    .where(eq(schema.pages.id, ctx.pageId))
    .limit(1);
  if (!page) return;

  const yamlFacts = extractTierA(page.content);
  console.log(`  [stage5] tier A: ${yamlFacts.length} candidate facts`);

  if (yamlFacts.length === 0) return;

  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0;
  let skipped = 0;

  for (const f of yamlFacts) {
    const normalized = await normalize(f, ctx, "tier_a");
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
  };
}
