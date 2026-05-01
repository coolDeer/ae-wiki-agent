/**
 * Completeness scoring (借鉴 gbrain `src/core/enrichment/completeness.ts`).
 *
 * 纯函数：输入 page → 输出 0.000-1.000 综合分 + 每维度分项。每次 enrich:save
 * 后调用，落进 `pages.completeness_score` 列。
 *
 * 设计原则：
 *   - **deterministic, no side effects**：同样 page → 同样分。不调 LLM，不查 DB。
 *   - **per-type rubric**：company / industry / concept / thesis 各自的 weighted dimensions。
 *   - **每个维度 0.0-1.0**：分项可解释，未来 search boost / retrigger 决策可用。
 *   - **不是 "agent 自评 confidence"**：confidence 是 enum 主观判断；score 是客观 metric。
 *
 * 用途：
 *   1. enrich:save 之后写 pages.completeness_score
 *   2. enrich:retrigger 决策：score < 0.5 + backlink 涨幅 ≥ N 时重 enqueue
 *   3. search 排序：低 score 的 page dampen
 *   4. lint 报表：列出长期低分的"半成品"
 */

import type { Page } from "~/core/schema/pages.ts";

export interface DimensionScore {
  name: string;
  weight: number;
  score: number; // 0.0-1.0
}

export interface CompletenessResult {
  total: number; // weighted sum, 0.0-1.0
  dimensions: DimensionScore[];
  rubric: string;
}

/** Public API. 输入完整 page 行（来自 SELECT），返回 completeness。 */
export function scorePage(page: Page): CompletenessResult {
  switch (page.type) {
    case "company":
      return scoreCompany(page);
    case "industry":
      return scoreIndustry(page);
    case "concept":
      return scoreConcept(page);
    case "thesis":
      return scoreThesis(page);
    default:
      // source / brief / output 等：completeness 由 ingest pipeline 决定，本函数不评
      return {
        total: 0,
        dimensions: [],
        rubric: `not-scored:${page.type}`,
      };
  }
}

// ─── 共用维度计算 ─────────────────────────────────────────────────────

function hasContent(page: Page): number {
  const len = (page.content ?? "").trim().length;
  if (len === 0) return 0;
  if (len < 200) return 0.2;
  if (len < 800) return 0.5;
  if (len < 2000) return 0.8;
  return 1.0;
}

function hasFrontmatterField(page: Page, field: string): number {
  const fm = (page.frontmatter ?? {}) as Record<string, unknown>;
  const v = fm[field];
  if (v === undefined || v === null) return 0;
  if (typeof v === "string" && v.trim().length === 0) return 0;
  if (Array.isArray(v) && v.length === 0) return 0;
  return 1.0;
}

function aliasesScore(page: Page): number {
  const n = (page.aliases ?? []).length;
  if (n === 0) return 0;
  if (n === 1) return 0.3;
  if (n === 2) return 0.6;
  if (n >= 3) return 1.0;
  return 0;
}

function tickerScore(page: Page): number {
  return page.ticker && page.ticker.length > 0 ? 1.0 : 0;
}

function sectorScore(page: Page): number {
  let s = 0;
  if (page.sector) s += 0.5;
  if (page.subSector) s += 0.5;
  return Math.min(1.0, s);
}

function recencyScore(page: Page): number {
  const updated = page.updateTime;
  if (!updated) return 0;
  const ageMs = Date.now() - new Date(updated).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 30) return 1.0;
  if (ageDays < 90) return 0.7;
  if (ageDays < 365) return 0.4;
  return 0.1;
}

/** 检查 narrative 里有没有引用 [[wikilink]]，作为"建立交叉引用"的代理信号。*/
function hasWikilinks(page: Page): number {
  const matches = (page.content ?? "").match(/\[\[[a-z]+\/[^\]|#]+/g);
  const n = matches?.length ?? 0;
  if (n === 0) return 0;
  if (n < 3) return 0.4;
  if (n < 10) return 0.7;
  return 1.0;
}

/** 检查 narrative 里有没有 source citation 模式（"(来源：[[sources/...]]）"等）。*/
function hasCitations(page: Page): number {
  const content = page.content ?? "";
  const patterns = [
    /\[\[sources\//g,
    /来源[:：]/g,
    /Sources?[:：]/i,
    /\(per\s+\[\[/g,
  ];
  let total = 0;
  for (const p of patterns) {
    const m = content.match(p);
    if (m) total += m.length;
  }
  if (total === 0) return 0;
  if (total < 2) return 0.3;
  if (total < 5) return 0.7;
  return 1.0;
}

// ─── 各 type 的 rubric ────────────────────────────────────────────────

function scoreCompany(page: Page): CompletenessResult {
  const dimensions: DimensionScore[] = [
    { name: "content", weight: 0.20, score: hasContent(page) },
    { name: "ticker", weight: 0.15, score: tickerScore(page) },
    { name: "sector", weight: 0.10, score: sectorScore(page) },
    { name: "aliases", weight: 0.15, score: aliasesScore(page) },
    { name: "wikilinks", weight: 0.10, score: hasWikilinks(page) },
    { name: "citations", weight: 0.15, score: hasCitations(page) },
    { name: "recency", weight: 0.05, score: recencyScore(page) },
    { name: "country_or_exchange", weight: 0.10, score: page.country || page.exchange ? 1.0 : 0 },
  ];
  return {
    total: weightedSum(dimensions),
    dimensions,
    rubric: "company",
  };
}

function scoreIndustry(page: Page): CompletenessResult {
  const dimensions: DimensionScore[] = [
    { name: "content", weight: 0.30, score: hasContent(page) },
    { name: "aliases", weight: 0.20, score: aliasesScore(page) },
    { name: "wikilinks", weight: 0.20, score: hasWikilinks(page) },
    { name: "citations", weight: 0.20, score: hasCitations(page) },
    { name: "recency", weight: 0.10, score: recencyScore(page) },
  ];
  return {
    total: weightedSum(dimensions),
    dimensions,
    rubric: "industry",
  };
}

function scoreConcept(page: Page): CompletenessResult {
  const dimensions: DimensionScore[] = [
    { name: "content", weight: 0.35, score: hasContent(page) },
    { name: "aliases", weight: 0.15, score: aliasesScore(page) },
    { name: "wikilinks", weight: 0.20, score: hasWikilinks(page) },
    { name: "citations", weight: 0.20, score: hasCitations(page) },
    { name: "recency", weight: 0.10, score: recencyScore(page) },
  ];
  return {
    total: weightedSum(dimensions),
    dimensions,
    rubric: "concept",
  };
}

function scoreThesis(page: Page): CompletenessResult {
  const dimensions: DimensionScore[] = [
    { name: "content", weight: 0.30, score: hasContent(page) },
    { name: "wikilinks", weight: 0.15, score: hasWikilinks(page) },
    { name: "citations", weight: 0.15, score: hasCitations(page) },
    { name: "validation_conditions", weight: 0.20, score: hasFrontmatterField(page, "validation_conditions") },
    { name: "catalysts", weight: 0.10, score: hasFrontmatterField(page, "catalysts") },
    { name: "recency", weight: 0.10, score: recencyScore(page) },
  ];
  return {
    total: weightedSum(dimensions),
    dimensions,
    rubric: "thesis",
  };
}

function weightedSum(dimensions: DimensionScore[]): number {
  let total = 0;
  for (const d of dimensions) total += d.weight * d.score;
  // round to 3 decimals
  return Math.round(total * 1000) / 1000;
}
