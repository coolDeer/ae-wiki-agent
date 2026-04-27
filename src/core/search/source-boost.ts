/**
 * Source-aware ranking — 借鉴 gbrain v0.22.0
 *
 * 不同来源的信噪比天差地别。一份 Arete 深度模型 vs 一份 chat brilliant 个股纪要，
 * 同一个 query "NOW EPS"，前者应该排前面。
 *
 * 实现：在 SQL ranking 阶段乘一个 multiplier（按 page slug 前缀最长匹配）。
 *
 * 默认 boost 表针对投资研究场景：
 *   - sources/Arete-*       1.5  深度财务模型 + estimates
 *   - sources/Merit-*       1.4  深度行业 / 专家调研
 *   - sources/MS- BofA- ... 1.3  顶级 broker 报告
 *   - sources/sub-*         1.1  独立分析（substack）
 *   - sources/ace-* mm-*    1.0  baseline
 *   - sources/vk-*          0.9  宏观快讯
 *   - sources/cb-*          0.6  chat brilliant 散点纪要
 *   - companies/* industries/* 1.4  策展页（人工 / agent enrich 过的）
 *   - thesis/*              1.5  投资论点
 *
 * 可通过 env `WIKI_SOURCE_BOOST` 覆盖，格式 "prefix:mult,prefix:mult"。
 * 硬排除走 env `WIKI_SEARCH_EXCLUDE`，同格式但不带 multiplier，逗号分隔前缀。
 */

import { sql, type SQL } from "drizzle-orm";

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_SOURCE_BOOST: Record<string, number> = {
  "sources/Arete-": 1.5,
  "sources/Merit-": 1.4,
  "sources/MS-": 1.3,
  "sources/BofA-": 1.3,
  "sources/Daiwa-": 1.3,
  "sources/Nomura-": 1.3,
  "sources/SMBC-": 1.3,
  "sources/Verdent-": 1.3,
  "sources/sub-": 1.1,
  "sources/ace-": 1.0,
  "sources/mm-": 1.0,
  "sources/meeting_minutes-": 1.0,
  "sources/vk-": 0.9,
  "sources/cb-": 0.6,
  "companies/": 1.4,
  "industries/": 1.4,
  "thesis/": 1.5,
  "concepts/": 1.2,
};

export const DEFAULT_EXCLUDE_PREFIXES: string[] = [
  // 默认啥都不排除；按需用 WIKI_SEARCH_EXCLUDE 覆盖
];

// ============================================================================
// Env 解析
// ============================================================================

/** 解析 "prefix1:1.5,prefix2:0.7" 形式 */
export function parseEnvBoosts(raw?: string): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const part of raw.split(",")) {
    const [prefix, multStr] = part.split(":");
    if (!prefix || !multStr) continue;
    const mult = parseFloat(multStr);
    if (Number.isFinite(mult) && mult > 0) {
      out[prefix.trim()] = mult;
    }
  }
  return out;
}

export function parseEnvExclude(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 合并默认 + env 覆盖。env 中出现的前缀完全覆盖默认值（同 gbrain 语义）。
 */
export function resolveSourceBoosts(envRaw?: string): Record<string, number> {
  return { ...DEFAULT_SOURCE_BOOST, ...parseEnvBoosts(envRaw) };
}

export function resolveExcludePrefixes(
  envRaw?: string,
  perCallExcludes: string[] = [],
  perCallIncludes: string[] = []
): string[] {
  const merged = [
    ...DEFAULT_EXCLUDE_PREFIXES,
    ...parseEnvExclude(envRaw),
    ...perCallExcludes,
  ];
  // include 优先级最高：把 include 列表里的前缀从 exclude 中移除
  const includeSet = new Set(perCallIncludes);
  return Array.from(new Set(merged.filter((p) => !includeSet.has(p))));
}

// ============================================================================
// SQL fragment builders
// ============================================================================

/**
 * 把 boost 表编译成 CASE WHEN 表达式。按 prefix 长度倒序排（最长匹配胜出）。
 *
 * 示例返回：
 *   CASE
 *     WHEN slug LIKE 'sources/Arete-%' THEN 1.5
 *     WHEN slug LIKE 'sources/Merit-%' THEN 1.4
 *     ...
 *     ELSE 1.0
 *   END
 *
 * @param column SQL 列引用（用 sql.raw 或 sql`...`），通常是 'p.slug'
 * @param boosts 已 resolve 的 boost map
 */
export function buildSourceFactorCase(
  column: SQL,
  boosts: Record<string, number>
): SQL {
  const entries = Object.entries(boosts).sort(
    (a, b) => b[0].length - a[0].length
  );
  if (entries.length === 0) return sql`1.0`;

  // 用 sql.join + 模板拼出 CASE WHEN 链
  const whenClauses = entries.map(
    ([prefix, mult]) =>
      sql`WHEN ${column} LIKE ${prefix + "%"} THEN ${sql.raw(mult.toString())}`
  );
  return sql`(CASE ${sql.join(whenClauses, sql` `)} ELSE 1.0 END)`;
}

/**
 * 硬排除：构造 NOT (col LIKE 'p1%' OR col LIKE 'p2%' ...)
 * 用于 keyword/semantic 候选池的 WHERE 子句。
 *
 * LIKE meta 字符（%, _, \）需要转义。
 */
export function buildHardExcludeClause(
  column: SQL,
  prefixes: string[]
): SQL | null {
  if (prefixes.length === 0) return null;
  const escaped = prefixes.map(escapeLikePattern);
  const orChain = escaped.map((p) => sql`${column} LIKE ${p + "%"}`);
  return sql`NOT (${sql.join(orChain, sql` OR `)})`;
}

/**
 * 转义 LIKE pattern 中的 \, %, _ — 防止用户配置里的特殊字符被误解析为通配。
 * 配合 PG 默认 ESCAPE '\\'。
 */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
