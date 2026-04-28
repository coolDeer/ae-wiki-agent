/**
 * Stage 5 Tier C: LLM 兜底 fact 抽取
 *
 * 在 Tier A (YAML block) + Tier B (markdown table) 跑完后，请 LLM
 * 从 narrative prose 里挑出尚未结构化的 fact。
 *
 * 设计要点：
 *   - 默认开启；env STAGE5_TIER_C_DISABLED=true 关
 *   - 模型 OPENAI_FACT_EXTRACT_MODEL（默认 gpt-5-mini）
 *   - 输入：page.content 截到 50K 字符 + 已抽到的 (entity, metric, period) 三元组
 *   - 输出 schema：{facts: [{entity, metric, period?, value, unit?, source_quote}]}
 *   - 抗幻觉：source_quote 必须是 narrative 子串（normalized whitespace），否则丢弃
 *   - confidence=0.7（低于 Tier A 的 1.0）
 *   - fail-soft：API 抛错时记 warning + 返回空数组，不中断 finalize
 */

import OpenAI from "openai";
import { getEnv } from "~/core/env.ts";

interface TierCFact {
  entity: string;
  metric: string;
  period?: string;
  value: number | string;
  unit?: string;
  source_quote: string;
}

interface CandidateOut {
  entity: string;
  metric: string;
  period?: string;
  value: number | string;
  unit?: string;
  source_quote: string;
  confidence: number;
}

const SYSTEM_PROMPT = [
  "You extract structured financial / operational facts from investment research narratives.",
  "",
  "Strict rules:",
  '1. Only extract facts EXPLICITLY stated in the narrative. No inference, no completion.',
  '2. Every fact MUST include a "source_quote" — an exact contiguous substring of the narrative that states the fact (will be validated).',
  '3. Entity MUST be a slug starting with "companies/" / "industries/" / "persons/" / "concepts/". Pick from the allowed_entities list (taken from [[wikilink]] usage in the narrative). If none fits, SKIP the fact rather than invent a new slug.',
  '4. Use snake_case for "metric" (e.g., revenue, eps_non_gaap, gross_margin, target_price, comps_us, ma_deal_size).',
  '5. Use compact period codes ("FY2027E", "1Q26A", "current", "2026-04", "2026-04-27", or omit if context-free).',
  '6. Common units: usd, usd_m, usd_bn, cny, cny_bn, jpy_m, pct (for percentages), x, t (tons), bp (basis points).',
  '7. SKIP any fact whose (entity, metric, period) tuple appears in the "already_extracted" list.',
  "8. If the narrative does not contain new structured numerical facts, return an empty list.",
  "9. Return at most 12 facts.",
  '10. The "value" field MUST be a NUMBER (or a numeric-looking string like "1.5"). Do NOT extract narrative quotes / opinions / qualitative views as facts. NEVER use metric names like "quote", "comment", "view", "note", "summary", "opinion".',
  "",
  'Return JSON only: {"facts": [...]}',
].join("\n");

function extractWikilinkSlugs(text: string): string[] {
  const matches = Array.from(
    text.matchAll(/\[\[((?:companies|industries|persons|concepts)\/[^\]|]+)(?:\|[^\]]+)?\]\]/g)
  );
  const slugs = matches
    .map((m) => m[1]?.trim())
    .filter((s): s is string => Boolean(s && s.length > 0));
  return Array.from(new Set(slugs));
}

function buildUserPrompt(
  content: string,
  alreadyExtracted: Set<string>,
  allowedEntities: string[]
): string {
  const already =
    alreadyExtracted.size > 0
      ? Array.from(alreadyExtracted)
          .slice(0, 100)
          .map((k) => `- ${k}`)
          .join("\n")
      : "(none)";

  const allowed =
    allowedEntities.length > 0
      ? allowedEntities.map((s) => `- ${s}`).join("\n")
      : "(none — return empty list)";

  // 长 narrative 截断到 50K 字符
  const trimmed = content.length > 50000 ? content.slice(0, 50000) : content;

  return [
    "## allowed_entities",
    "Use ONLY these slugs for the entity field. Drop any fact that does not fit one of these.",
    "",
    allowed,
    "",
    "## already_extracted",
    "Format: entity|metric|period (period may be empty).",
    "",
    already,
    "",
    "## narrative",
    "```",
    trimmed,
    "```",
    "",
    "Extract any ADDITIONAL facts from the narrative that are not in already_extracted. Quote each fact verbatim from the narrative.",
  ].join("\n");
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function validateSourceQuote(quote: string, content: string): boolean {
  if (!quote || typeof quote !== "string") return false;
  const trimmed = quote.trim();
  if (trimmed.length < 4) return false;
  const a = normalizeWhitespace(trimmed.toLowerCase());
  const b = normalizeWhitespace(content.toLowerCase());
  return b.includes(a);
}

function looksLikeSlug(entity: unknown): boolean {
  if (typeof entity !== "string") return false;
  return /^(companies|industries|persons|concepts)\/[^/\s][^/]*$/.test(entity.trim());
}

async function callLLM(
  content: string,
  alreadyExtracted: Set<string>,
  allowedEntities: string[]
): Promise<TierCFact[]> {
  const env = getEnv();
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: 180_000,
    maxRetries: 0,
  });

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: buildUserPrompt(content, alreadyExtracted, allowedEntities),
    },
  ];

  // Bun 的 native fetch 在长 unary 请求上容易掉 socket（OpenAI 端点尤其明显）。
  // 走 stream=true + 累积 delta 更稳；reasoning_effort='low' 限制思考时长，
  // max_completion_tokens 限制总产出（含推理），避免长尾导致超时。
  // 失败时手动 retry，最多 3 次，指数 backoff。
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const stream = await client.chat.completions.create({
        model: env.OPENAI_FACT_EXTRACT_MODEL,
        messages,
        response_format: { type: "json_object" },
        stream: true,
        max_completion_tokens: 8000,
        reasoning_effort: "low",
      });

      let text = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) text += delta;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text || "{}");
      } catch {
        return [];
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("facts" in parsed) ||
        !Array.isArray((parsed as { facts: unknown }).facts)
      ) {
        return [];
      }
      return (parsed as { facts: unknown[] }).facts.filter(
        (f): f is TierCFact =>
          typeof f === "object" &&
          f !== null &&
          "entity" in f &&
          "metric" in f &&
          "value" in f &&
          "source_quote" in f
      );
    } catch (e) {
      lastErr = e;
      const errMsg = (e as Error).message ?? "";
      const transient =
        /socket|connection|certificate|fetch|timeout|ECONN|EAI_AGAIN/i.test(errMsg);
      if (!transient || attempt === maxAttempts) break;
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      console.warn(
        `  [stage5:tierC] attempt ${attempt}/${maxAttempts} failed (${errMsg.slice(0, 80)}), retrying in ${backoffMs}ms`
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

export async function extractTierC(
  content: string,
  alreadyExtracted: Set<string>
): Promise<CandidateOut[]> {
  const env = getEnv();
  if (env.STAGE5_TIER_C_DISABLED) {
    console.log("  [stage5:tierC] disabled by env");
    return [];
  }
  // 太短的素材跳过（brief / 占位 page）
  if (content.trim().length < 400) {
    console.log("  [stage5:tierC] content too short, skip");
    return [];
  }

  const allowedEntities = extractWikilinkSlugs(content);
  if (allowedEntities.length === 0) {
    console.log("  [stage5:tierC] no [[wikilinks]] in content, skip");
    return [];
  }

  let raw: TierCFact[];
  try {
    raw = await callLLM(content, alreadyExtracted, allowedEntities);
  } catch (e) {
    const err = e as { message?: string; name?: string; status?: number; cause?: unknown };
    console.warn(
      `  [stage5:tierC] LLM call failed (${err.name ?? "Error"}, status=${err.status ?? "n/a"}): ${err.message ?? String(e)} — fail-soft, skip`
    );
    if (err.cause) {
      console.warn(`  [stage5:tierC] cause: ${String(err.cause)}`);
    }
    return [];
  }

  const kept: CandidateOut[] = [];
  let droppedSchema = 0;
  let droppedHallucinated = 0;
  let droppedDup = 0;

  const NON_NUMERIC_METRICS = new Set([
    "quote",
    "comment",
    "view",
    "note",
    "summary",
    "opinion",
  ]);

  for (const f of raw) {
    if (!looksLikeSlug(f.entity)) {
      droppedSchema++;
      continue;
    }
    if (typeof f.metric !== "string" || f.metric.trim().length === 0) {
      droppedSchema++;
      continue;
    }
    if (NON_NUMERIC_METRICS.has(f.metric.trim().toLowerCase())) {
      droppedSchema++;
      continue;
    }
    if (
      f.value === null ||
      f.value === undefined ||
      (typeof f.value !== "number" && typeof f.value !== "string")
    ) {
      droppedSchema++;
      continue;
    }
    // Reject narrative-style "facts" — value 必须是数字或可解析数字串
    if (typeof f.value === "string") {
      const numeric = parseFloat(f.value.replace(/,/g, ""));
      if (!Number.isFinite(numeric)) {
        droppedSchema++;
        continue;
      }
    }
    if (!validateSourceQuote(f.source_quote, content)) {
      droppedHallucinated++;
      continue;
    }
    const key = `${f.entity.trim()}|${f.metric.trim()}|${(f.period ?? "").trim()}`;
    if (alreadyExtracted.has(key)) {
      droppedDup++;
      continue;
    }
    kept.push({
      entity: f.entity.trim(),
      metric: f.metric.trim(),
      period: f.period?.trim() || undefined,
      value: f.value,
      unit: f.unit?.trim() || undefined,
      source_quote: f.source_quote.trim(),
      confidence: 0.7,
    });
  }

  console.log(
    `  [stage5:tierC] proposed=${raw.length} kept=${kept.length} dropped_schema=${droppedSchema} dropped_hallucinated=${droppedHallucinated} dropped_dup=${droppedDup}`
  );
  return kept;
}
