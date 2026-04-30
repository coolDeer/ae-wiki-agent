/**
 * lint:duplicates / duplicates 诊断
 *
 * 离线扫描整个 page 库，找潜在重复实体（trgm > 阈值 + 同 type）。
 *
 * 设计取舍：
 *   - **不内联进 stage-4**——ingest 路径要快、要确定，trgm 软建议进了主路径会
 *     冒 false-positive 风险（NVIDIA / AMD 距离太近会被误合并）。
 *   - **作为离线 lint 跑**——周/月一次，输出建议清单，agent / 人工 review 后用
 *     `enrich:retype` + 手工合并。
 *   - **不写 events**——这是信息工具不是审计触发器；多次跑应当无副作用。
 *
 * 工作原理：
 *   - 自连接 pages × pages，同 type、a.id < b.id（每对只算一次）
 *   - 用 GREATEST(similarity(title), word_similarity(title)) 综合分数
 *   - 阈值默认 0.7，可调
 *   - 输出按相似度降序，附 backlink 数（高 backlink 的 dup 更值得合并）
 */

import { sql } from "drizzle-orm";
import { db } from "~/core/db.ts";

const ELIGIBLE_TYPES = ["company", "industry", "concept", "thesis"];

export interface DuplicateRow {
  aId: string;
  aSlug: string;
  aTitle: string;
  aConfidence: string;
  aBacklinks: number;
  aAliases: string[];
  bId: string;
  bSlug: string;
  bTitle: string;
  bConfidence: string;
  bBacklinks: number;
  bAliases: string[];
  type: string;
  titleSim: number;
  wordSim: number;
  /** GREATEST(titleSim, wordSim) */
  score: number;
}

export interface DuplicateFilters {
  type?: string;
  /** 默认 0.7 */
  minSim?: number;
  /** 默认 50 */
  limit?: number;
}

export interface DuplicateReport {
  generatedAt: string;
  filters: {
    type: string | null;
    minSim: number;
    limit: number;
  };
  totalPairsScanned: number;
  pairsAboveThreshold: number;
  pairs: DuplicateRow[];
}

export async function findDuplicates(
  opts: DuplicateFilters = {}
): Promise<DuplicateReport> {
  const minSim = opts.minSim ?? 0.7;
  const limit = opts.limit ?? 50;

  if (opts.type && !ELIGIBLE_TYPES.includes(opts.type)) {
    throw new Error(
      `type='${opts.type}' 不支持。允许: ${ELIGIBLE_TYPES.join(" / ")}`
    );
  }

  const typeFilter = opts.type
    ? sql`AND a.type = ${opts.type}`
    : sql`AND a.type IN (${sql.join(
        ELIGIBLE_TYPES.map((t) => sql`${t}`),
        sql`, `
      )})`;

  // 主查询：自连接，同 type 同 source，i 严格 < j 避免重复对 / 自比较
  const rows = (await db.execute(sql`
    WITH pairs AS (
      SELECT
        a.id::text AS a_id, a.slug AS a_slug, a.title AS a_title,
        a.confidence AS a_conf, a.aliases AS a_aliases,
        b.id::text AS b_id, b.slug AS b_slug, b.title AS b_title,
        b.confidence AS b_conf, b.aliases AS b_aliases,
        a.type AS type,
        similarity(a.title, b.title) AS title_sim,
        GREATEST(
          word_similarity(a.title, b.title),
          word_similarity(b.title, a.title)
        ) AS word_sim,
        GREATEST(
          similarity(a.title, b.title),
          word_similarity(a.title, b.title),
          word_similarity(b.title, a.title)
        ) AS score
      FROM pages a
      JOIN pages b ON a.id < b.id
        AND a.type = b.type
        AND a.source_id = b.source_id
        AND a.deleted = 0 AND b.deleted = 0
        ${typeFilter}
    )
    SELECT
      p.*,
      (SELECT COUNT(*)::int FROM links l WHERE l.deleted = 0 AND l.to_page_id = p.a_id::bigint) AS a_backlinks,
      (SELECT COUNT(*)::int FROM links l WHERE l.deleted = 0 AND l.to_page_id = p.b_id::bigint) AS b_backlinks
    FROM pairs p
    WHERE p.score >= ${minSim}
    ORDER BY p.score DESC, p.a_id ASC, p.b_id ASC
    LIMIT ${limit}
  `)) as Array<{
    a_id: string;
    a_slug: string;
    a_title: string;
    a_conf: string;
    a_aliases: string[] | null;
    a_backlinks: number;
    b_id: string;
    b_slug: string;
    b_title: string;
    b_conf: string;
    b_aliases: string[] | null;
    b_backlinks: number;
    type: string;
    title_sim: string | number;
    word_sim: string | number;
    score: string | number;
  }>;

  // 总扫描对数（仅用于报告，不影响结果）
  const totalScanned = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM pages a
    JOIN pages b ON a.id < b.id
      AND a.type = b.type
      AND a.source_id = b.source_id
      AND a.deleted = 0 AND b.deleted = 0
      ${typeFilter}
  `)) as Array<{ n: number }>;

  const aboveThreshold = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM pages a
    JOIN pages b ON a.id < b.id
      AND a.type = b.type
      AND a.source_id = b.source_id
      AND a.deleted = 0 AND b.deleted = 0
      ${typeFilter}
    WHERE GREATEST(
      similarity(a.title, b.title),
      word_similarity(a.title, b.title),
      word_similarity(b.title, a.title)
    ) >= ${minSim}
  `)) as Array<{ n: number }>;

  const toNum = (v: string | number): number =>
    typeof v === "string" ? parseFloat(v) : v;

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      type: opts.type ?? null,
      minSim,
      limit,
    },
    totalPairsScanned: totalScanned[0]?.n ?? 0,
    pairsAboveThreshold: aboveThreshold[0]?.n ?? 0,
    pairs: rows.map((r) => ({
      aId: r.a_id,
      aSlug: r.a_slug,
      aTitle: r.a_title,
      aConfidence: r.a_conf,
      aBacklinks: r.a_backlinks,
      aAliases: r.a_aliases ?? [],
      bId: r.b_id,
      bSlug: r.b_slug,
      bTitle: r.b_title,
      bConfidence: r.b_conf,
      bBacklinks: r.b_backlinks,
      bAliases: r.b_aliases ?? [],
      type: r.type,
      titleSim: toNum(r.title_sim),
      wordSim: toNum(r.word_sim),
      score: toNum(r.score),
    })),
  };
}

/** 渲染人读 table 用于 CLI 默认输出。 */
export function formatDuplicateTable(report: DuplicateReport): string {
  const { pairs, totalPairsScanned, pairsAboveThreshold, filters } = report;

  if (pairs.length === 0) {
    return [
      `No potential duplicates found (sim >= ${filters.minSim})`,
      `  scanned: ${totalPairsScanned} pairs (type=${filters.type ?? "all eligible"})`,
    ].join("\n");
  }

  const lines: string[] = [
    `Potential duplicates (${pairs.length}/${pairsAboveThreshold} shown; ${totalPairsScanned} pairs scanned)`,
    `  filter: type=${filters.type ?? "all eligible"}, min_sim=${filters.minSim}`,
    "",
  ];

  for (const p of pairs) {
    const aBL = p.aBacklinks > 0 ? `(${p.aBacklinks}bl)` : "";
    const bBL = p.bBacklinks > 0 ? `(${p.bBacklinks}bl)` : "";
    lines.push(
      `  [${p.type}] sim=${p.score.toFixed(2)} (title=${p.titleSim.toFixed(2)} word=${p.wordSim.toFixed(2)})`
    );
    lines.push(
      `    A: #${p.aId.padStart(4)} ${p.aSlug.padEnd(40)} ${p.aConfidence.padEnd(6)} ${aBL}`
    );
    if (p.aAliases.length > 0) lines.push(`        aliases: ${p.aAliases.slice(0, 5).join(", ")}`);
    lines.push(
      `    B: #${p.bId.padStart(4)} ${p.bSlug.padEnd(40)} ${p.bConfidence.padEnd(6)} ${bBL}`
    );
    if (p.bAliases.length > 0) lines.push(`        aliases: ${p.bAliases.slice(0, 5).join(", ")}`);
    lines.push("");
  }

  lines.push("Suggested merge workflow:");
  lines.push("  1. 决定哪个是 canonical（通常 backlink 数高 / confidence 高的）");
  lines.push("  2. 把另一个的 narrative 内容 / aliases 合并进 canonical（手工编辑后 enrich:save）");
  lines.push("  3. 软删 dup：把 dup 的所有 inbound link 移到 canonical（SQL）");
  lines.push("  4. 之后用 enrich:save 把全 alias 集合写到 canonical 防止再次 dup");

  return lines.join("\n");
}
