/**
 * enrich:retrigger —— 找"该重 enrich 的实体"批量重新入队。
 *
 * 解决 NVIDIA 永久 conf=low 类问题：
 *   首次 enrich 时只有 1 个 backlink，agent 按规矩留 low confidence；
 *   后续 N 篇 source 又提到 NVIDIA，backlink 累积到 5+，但没机制让它重 enrich。
 *
 * 触发候选条件（AND 关系）：
 *   1. 完整度低：completeness_score < `--min-score`（默认 0.5）
 *   2. backlink 量大：backlinks >= `--min-backlinks`（默认 3）
 *   3. 有"涨势"：自上次 enrich event 以来 backlink 增量 >= `--min-new-backlinks`（默认 2）
 *      —— 防止刚 enrich 完的 page 立刻又重跑
 *   4. 没有 in-flight enrich job
 *   5. type ∈ {company, industry, concept, thesis}
 *
 * 入队优先级 80（高于默认 50）：让"已被多次引用但 conf 低"的核心实体优先处理。
 *
 * 使用：
 *   bun src/cli.ts enrich:retrigger                       # 跑（默认阈值）
 *   bun src/cli.ts enrich:retrigger --dry-run             # 看清单不入队
 *   bun src/cli.ts enrich:retrigger --min-score 0.7       # 严格模式
 *   bun src/cli.ts enrich:retrigger --limit 10            # 限制数量
 *   bun src/cli.ts enrich:retrigger --json                # 给脚本 / cron 用
 */

import { sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit, Actor } from "~/core/audit.ts";

const ELIGIBLE_TYPES = ["company", "industry", "concept", "thesis"];

export interface RetriggerCandidate {
  pageId: string;
  slug: string;
  type: string;
  title: string;
  confidence: string;
  completenessScore: number;
  backlinks: number;
  newBacklinksSinceEnrich: number;
  lastEnrichAt: string | null;
  reason: string;
}

export interface RetriggerResult {
  generatedAt: string;
  filters: {
    minScore: number;
    minBacklinks: number;
    minNewBacklinks: number;
    type: string | null;
    limit: number;
    dryRun: boolean;
  };
  totalCandidates: number;
  enqueued: number;
  candidates: RetriggerCandidate[];
}

export interface RetriggerOpts {
  /** completeness_score < 此值才考虑（默认 0.5）*/
  minScore?: number;
  /** 当前 backlink 数 >= 此值（默认 3）*/
  minBacklinks?: number;
  /** 自上次 enrich 以来新增 backlink 数 >= 此值（默认 2）*/
  minNewBacklinks?: number;
  /** 限定 type；不传则查所有 eligible type */
  type?: string;
  /** 最多入队 N 个（默认 30）*/
  limit?: number;
  /** dry-run 不真入队 */
  dryRun?: boolean;
}

export async function runRetrigger(opts: RetriggerOpts = {}): Promise<RetriggerResult> {
  const minScore = opts.minScore ?? 0.5;
  const minBacklinks = opts.minBacklinks ?? 3;
  const minNewBacklinks = opts.minNewBacklinks ?? 2;
  const limit = opts.limit ?? 30;
  const dryRun = opts.dryRun ?? false;

  if (opts.type && !ELIGIBLE_TYPES.includes(opts.type)) {
    throw new Error(
      `type='${opts.type}' 不支持。允许: ${ELIGIBLE_TYPES.join(" / ")}`
    );
  }

  const typeFilter = opts.type
    ? drizzleSql`AND p.type = ${opts.type}`
    : drizzleSql`AND p.type IN (${drizzleSql.join(
        ELIGIBLE_TYPES.map((t) => drizzleSql`${t}`),
        drizzleSql`, `
      )})`;

  // 主查询：找候选
  // - 当前 backlinks count
  // - 上次 enrich event 时间（events.action='enrich'，最近一条）
  // - 该 ts 之后的 backlink 增量
  const rows = (await db.execute(drizzleSql`
    WITH last_enrich AS (
      SELECT entity_id::bigint AS page_id, MAX(ts) AS last_at
      FROM events
      WHERE deleted = 0 AND action = 'enrich' AND entity_type = 'page'
      GROUP BY entity_id
    ),
    backlink_counts AS (
      SELECT to_page_id, COUNT(*)::int AS n
      FROM links
      WHERE deleted = 0
      GROUP BY to_page_id
    )
    SELECT
      p.id::text AS page_id,
      p.slug,
      p.type,
      p.title,
      p.confidence,
      p.completeness_score::text AS completeness_score,
      COALESCE(bc.n, 0) AS backlinks,
      le.last_at AS last_enrich_at,
      COALESCE(
        (SELECT COUNT(*)::int FROM links l
          WHERE l.deleted = 0 AND l.to_page_id = p.id
            AND (le.last_at IS NULL OR l.create_time > le.last_at)),
        0
      ) AS new_backlinks_since_enrich
    FROM pages p
    LEFT JOIN last_enrich le ON le.page_id = p.id
    LEFT JOIN backlink_counts bc ON bc.to_page_id = p.id
    WHERE p.deleted = 0
      ${typeFilter}
      AND p.completeness_score::numeric < ${minScore}
      AND COALESCE(bc.n, 0) >= ${minBacklinks}
      AND NOT EXISTS (
        SELECT 1 FROM minion_jobs mj
        WHERE mj.deleted = 0
          AND mj.name = 'enrich_entity'
          AND mj.status IN ('waiting', 'active')
          AND mj.data->>'pageId' = p.id::text
      )
    ORDER BY bc.n DESC, p.completeness_score::numeric ASC, p.id ASC
    LIMIT ${limit * 3}
  `)) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    confidence: string;
    completeness_score: string;
    backlinks: number;
    last_enrich_at: Date | string | null;
    new_backlinks_since_enrich: number;
  }>;

  // 应用 minNewBacklinks 过滤（从未 enrich 过的 last_at IS NULL，new_backlinks = backlinks，永远算）
  const candidates: RetriggerCandidate[] = rows
    .filter((r) => r.new_backlinks_since_enrich >= minNewBacklinks)
    .slice(0, limit)
    .map((r) => {
      const lastAt = r.last_enrich_at
        ? r.last_enrich_at instanceof Date
          ? r.last_enrich_at.toISOString()
          : String(r.last_enrich_at)
        : null;
      return {
        pageId: r.page_id,
        slug: r.slug,
        type: r.type,
        title: r.title,
        confidence: r.confidence ?? "unknown",
        completenessScore: parseFloat(r.completeness_score),
        backlinks: r.backlinks,
        newBacklinksSinceEnrich: r.new_backlinks_since_enrich,
        lastEnrichAt: lastAt,
        reason: lastAt
          ? `score=${parseFloat(r.completeness_score).toFixed(2)} bl=${r.backlinks} new=${r.new_backlinks_since_enrich}`
          : `never-enriched bl=${r.backlinks}`,
      };
    });

  let enqueued = 0;
  if (!dryRun) {
    for (const c of candidates) {
      await db.insert(schema.minionJobs).values(
        withCreateAudit(
          {
            name: "enrich_entity",
            status: "waiting",
            priority: 80, // 高于默认 50，retrigger 优先消费
            data: {
              pageId: c.pageId,
              slug: c.slug,
              sourcePageId: null,
              retrigger: true,
              reason: c.reason,
            },
          },
          Actor.systemIngest
        )
      );
      enqueued++;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      minScore,
      minBacklinks,
      minNewBacklinks,
      type: opts.type ?? null,
      limit,
      dryRun,
    },
    totalCandidates: candidates.length,
    enqueued,
    candidates,
  };
}

export function formatRetriggerTable(result: RetriggerResult): string {
  const { candidates, enqueued, filters } = result;
  const lines: string[] = [
    `enrich:retrigger ${filters.dryRun ? "(DRY-RUN)" : `→ enqueued ${enqueued}`}`,
    `  filter: minScore=${filters.minScore} minBacklinks=${filters.minBacklinks} minNew=${filters.minNewBacklinks} type=${filters.type ?? "(all)"} limit=${filters.limit}`,
    "",
  ];
  if (candidates.length === 0) {
    lines.push("No candidates — wiki is healthy at current thresholds, or all already in-flight.");
    return lines.join("\n");
  }
  for (const c of candidates) {
    lines.push(
      `  #${c.pageId.padStart(4)} [${c.type.padEnd(8)}] ${c.slug.padEnd(40)} score=${c.completenessScore.toFixed(2)} bl=${c.backlinks}/${c.newBacklinksSinceEnrich}new`
    );
    lines.push(`        last_enrich=${c.lastEnrichAt ?? "(never)"} reason=${c.reason}`);
  }
  return lines.join("\n");
}
