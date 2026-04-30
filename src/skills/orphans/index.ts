/**
 * orphans 诊断
 *
 * 找出"应当被引用但没有任何入站 link"的实体页——也就是 Stage 4 自动建出来
 * 但没人接着指过去的孤儿 stub。是 red-link explosion 的可见表现：
 * narrative 提到了一个新公司 → 红链建空 stub → 那篇 source ingest 完之后
 * 再没人提到它 → 永远停在 confidence='low' 不会被 enrich pipeline 拣起来。
 *
 * 设计参考 gbrain `gbrain orphans` 命令：
 *   - 仅检查"应当有反向链接"的 type（company / industry / concept / thesis）
 *   - 自动排除 source / brief / output（这些类型本来就是叶子页，不需要被反链）
 *   - 返回完整 page 元数据（slug + title + age + confidence），便于 agent 决策
 *   - 跟 lint:run 解耦：可以频繁调用且不写 events
 *
 * 跟 lint:run 的 `orphan_pages` 检查的关系：
 *   - lint:run 跑 5 项混合检查、写一条 events，是定期巡检
 *   - orphans 是即查即出的诊断工具，agent 用它做"今天孤儿多了多少"日常筛查
 */

import { sql } from "drizzle-orm";
import { db } from "~/core/db.ts";

/** 把 string[] 包成 SQL `IN (...)` 子句的内部 list（避开 `= ANY(${arr})` 在 drizzle template 里绑定不可靠的问题）*/
function inList(values: ReadonlyArray<string>): ReturnType<typeof sql> {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

const DEFAULT_LINKABLE_TYPES: ReadonlyArray<string> = [
  "company",
  "industry",
  "concept",
  "thesis",
];

const EXCLUDED_TYPES: ReadonlyArray<string> = [
  "source",
  "brief",
  "output",
];

export interface OrphanRow {
  pageId: string;
  slug: string;
  type: string;
  title: string;
  confidence: string;
  createTime: string;
  daysOld: number;
}

export interface OrphanFilters {
  /** 限定 type；不传则查所有 linkable type */
  type?: string;
  /** 限定 confidence；不传则查所有 */
  confidence?: "low" | "medium" | "high";
  /** 仅返回 ≥ N 天的 page（避免误报刚建的）*/
  minAgeDays?: number;
  /** 最多返回 N 条；默认 50 */
  limit?: number;
}

export interface OrphanReport {
  generatedAt: string;
  filters: {
    type: string | null;
    confidence: string | null;
    minAgeDays: number;
    limit: number;
    excludedTypes: string[];
  };
  totalPages: number;
  totalLinkable: number;
  totalOrphans: number;
  orphans: OrphanRow[];
}

export async function findOrphans(
  opts: OrphanFilters = {}
): Promise<OrphanReport> {
  const limit = opts.limit ?? 50;
  const minAgeDays = opts.minAgeDays ?? 0;

  // 当前 type 过滤：要么 user 指定单个 type，要么默认查所有 linkable type
  const effectiveTypes = opts.type
    ? [opts.type]
    : Array.from(DEFAULT_LINKABLE_TYPES);

  // 校验：不允许查 EXCLUDED_TYPES（source/brief/output）—— 它们天然没反链
  if (opts.type && EXCLUDED_TYPES.includes(opts.type)) {
    throw new Error(
      `type='${opts.type}' 没有"孤儿"概念（source/brief/output 是叶子页，不需要被反链）。` +
        `允许的 type: ${DEFAULT_LINKABLE_TYPES.join(" / ")}`
    );
  }

  const confFilter = opts.confidence
    ? sql`AND p.confidence = ${opts.confidence}`
    : sql``;
  const ageFilter =
    minAgeDays > 0
      ? sql`AND p.create_time < NOW() - (${minAgeDays}::int * INTERVAL '1 day')`
      : sql``;

  // 1) 主查询：孤儿列表
  const orphans = (await db.execute(sql`
    SELECT
      p.id::text AS id,
      p.slug,
      p.type,
      p.title,
      p.confidence,
      p.create_time,
      EXTRACT(DAY FROM (NOW() - p.create_time))::int AS days_old
    FROM pages p
    WHERE p.deleted = 0
      AND p.type IN (${inList(effectiveTypes)})
      ${confFilter}
      ${ageFilter}
      AND NOT EXISTS (
        SELECT 1 FROM links l
        WHERE l.deleted = 0 AND l.to_page_id = p.id
      )
    ORDER BY p.create_time
    LIMIT ${limit}
  `)) as Array<{
    id: string;
    slug: string;
    type: string;
    title: string;
    confidence: string;
    create_time: Date | string;
    days_old: number;
  }>;

  // 2) 统计：总孤儿数（不受 limit 影响）
  const [totalOrphans] = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM pages p
    WHERE p.deleted = 0
      AND p.type IN (${inList(effectiveTypes)})
      ${confFilter}
      ${ageFilter}
      AND NOT EXISTS (
        SELECT 1 FROM links l
        WHERE l.deleted = 0 AND l.to_page_id = p.id
      )
  `)) as Array<{ n: number }>;

  // 3) 统计：linkable page 总数（分母，让 agent 知道孤儿率）
  const [totalLinkable] = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM pages p
    WHERE p.deleted = 0
      AND p.type IN (${inList(effectiveTypes)})
      ${confFilter}
      ${ageFilter}
  `)) as Array<{ n: number }>;

  // 4) 统计：active page 总数（参考值）
  const [totalPages] = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM pages WHERE deleted = 0
  `)) as Array<{ n: number }>;

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      type: opts.type ?? null,
      confidence: opts.confidence ?? null,
      minAgeDays,
      limit,
      excludedTypes: Array.from(EXCLUDED_TYPES),
    },
    totalPages: totalPages?.n ?? 0,
    totalLinkable: totalLinkable?.n ?? 0,
    totalOrphans: totalOrphans?.n ?? 0,
    orphans: orphans.map((r) => ({
      pageId: r.id,
      slug: r.slug,
      type: r.type,
      title: r.title,
      confidence: r.confidence,
      createTime:
        r.create_time instanceof Date
          ? r.create_time.toISOString()
          : String(r.create_time),
      daysOld: r.days_old,
    })),
  };
}

/**
 * 把 OrphanReport 渲染为人读 table（CLI 默认输出）。
 */
export function formatOrphanTable(report: OrphanReport): string {
  const { orphans, totalOrphans, totalLinkable, totalPages, filters } = report;

  if (orphans.length === 0) {
    return [
      `No orphans matching filter`,
      `  type=${filters.type ?? "(all linkable)"}, confidence=${filters.confidence ?? "(any)"}, min_age=${filters.minAgeDays}d`,
      `  total_pages=${totalPages}, linkable=${totalLinkable}, orphans=${totalOrphans}`,
    ].join("\n");
  }

  const header = [
    `Orphans (${orphans.length}/${totalOrphans} shown; ${totalLinkable} linkable / ${totalPages} total active pages)`,
    `  filter: type=${filters.type ?? "(all linkable)"}, confidence=${filters.confidence ?? "(any)"}, min_age=${filters.minAgeDays}d`,
    "",
  ];

  // 按 type 分组渲染
  const byType = new Map<string, OrphanRow[]>();
  for (const o of orphans) {
    const arr = byType.get(o.type) ?? [];
    arr.push(o);
    byType.set(o.type, arr);
  }

  const lines: string[] = [...header];
  for (const [type, rows] of byType) {
    lines.push(`# ${type} (${rows.length})`);
    for (const r of rows) {
      const ageLabel = r.daysOld <= 0 ? "<1d" : `${r.daysOld}d`;
      lines.push(
        `  #${r.pageId.padEnd(4)} ${r.slug.padEnd(50)}  ${r.confidence.padEnd(6)}  age=${ageLabel}`
      );
    }
    lines.push("");
  }

  // 末尾给个建议
  lines.push("Suggested actions:");
  lines.push("  - 类型错了的（companies/Trainium 等）→ enrich:retype <pageId> --new-type concept");
  lines.push("  - 真孤儿但值得保留 → enrich:next 拣起来正式补全");
  lines.push("  - 误建（匿名专家 / 噪声）→ 需要单独的清理脚本（lint 暂未自动删除）");

  return lines.join("\n");
}
