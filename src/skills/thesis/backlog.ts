/**
 * thesis backlog
 *
 * 目标：把 thesis upkeep 变成可巡检的列表：
 *   - active / monitoring thesis 是否过久未更新
 *   - unresolved validation conditions 有多少
 *   - 最近新增 signals 有多少
 */

import { sql } from "drizzle-orm";

import { db } from "~/core/db.ts";

export interface ThesisBacklogRow {
  pageId: string;
  slug: string;
  title: string;
  status: string;
  conviction: string | null;
  targetSlug: string | null;
  daysSinceUpdate: number;
  unresolvedConditions: number;
  recentSignals: number;
  priority: number;
  recommendedAction: "review_now" | "monitor";
}

export interface ThesisBacklogReport {
  generatedAt: string;
  filters: {
    status: string | null;
    staleDays: number;
    signalDays: number;
    limit: number;
  };
  summary: {
    reviewNow: number;
    monitor: number;
  };
  rows: ThesisBacklogRow[];
}

export async function getThesisBacklog(opts: {
  status?: "active" | "monitoring" | "closed" | "invalidated";
  staleDays?: number;
  signalDays?: number;
  limit?: number;
} = {}): Promise<ThesisBacklogReport> {
  const staleDays = opts.staleDays ?? 21;
  const signalDays = opts.signalDays ?? 14;
  const limit = opts.limit ?? 30;
  const statusFilter = opts.status
    ? sql`AND t.status = ${opts.status}`
    : sql`AND t.status IN ('active', 'monitoring')`;

  const rows = (await db.execute(sql`
    SELECT
      p.id::text AS page_id,
      p.slug,
      p.title,
      t.status,
      t.conviction,
      tp.slug AS target_slug,
      EXTRACT(DAY FROM (NOW() - t.update_time))::int AS days_since_update,
      COALESCE((
        SELECT COUNT(*)::int
        FROM jsonb_array_elements(COALESCE(t.validation_conditions, '[]'::jsonb)) AS vc
        WHERE COALESCE(vc->>'status', 'pending') IN ('pending', 'unmet')
      ), 0) AS unresolved_conditions,
      COALESCE((
        SELECT COUNT(*)::int
        FROM signals s
        WHERE s.deleted = 0
          AND s.thesis_page_id = t.page_id
          AND s.detected_at > NOW() - (${signalDays}::int * INTERVAL '1 day')
      ), 0) AS recent_signals
    FROM theses t
    JOIN pages p ON p.id = t.page_id
    LEFT JOIN pages tp ON tp.id = t.target_page_id
    WHERE t.deleted = 0
      AND p.deleted = 0
      ${statusFilter}
    ORDER BY
      t.update_time ASC,
      p.id ASC
    LIMIT ${limit}
  `)) as Array<{
    page_id: string;
    slug: string;
    title: string;
    status: string;
    conviction: string | null;
    target_slug: string | null;
    days_since_update: number;
    unresolved_conditions: number;
    recent_signals: number;
  }>;

  const mapped = rows.map((row) => {
    const recommendedAction =
      row.days_since_update >= staleDays ||
      row.unresolved_conditions > 0 ||
      row.recent_signals > 0
        ? "review_now"
        : "monitor";
    const priority =
      Math.max(row.days_since_update - staleDays, 0) +
      row.unresolved_conditions * 3 +
      row.recent_signals * 2;
    return {
      pageId: row.page_id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      conviction: row.conviction,
      targetSlug: row.target_slug,
      daysSinceUpdate: row.days_since_update,
      unresolvedConditions: row.unresolved_conditions,
      recentSignals: row.recent_signals,
      priority,
      recommendedAction,
    } satisfies ThesisBacklogRow;
  });

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      status: opts.status ?? null,
      staleDays,
      signalDays,
      limit,
    },
    summary: {
      reviewNow: mapped.filter((row) => row.recommendedAction === "review_now").length,
      monitor: mapped.filter((row) => row.recommendedAction === "monitor").length,
    },
    rows: mapped,
  };
}

export function formatThesisBacklog(report: ThesisBacklogReport): string {
  const lines = [
    `Thesis backlog (${report.rows.length} shown)`,
    `  filter: status=${report.filters.status ?? "(active+monitoring)"} stale_days=${report.filters.staleDays} signal_days=${report.filters.signalDays} limit=${report.filters.limit}`,
    `  summary: review_now=${report.summary.reviewNow} monitor=${report.summary.monitor}`,
    "",
  ];
  if (report.rows.length === 0) {
    lines.push("No thesis backlog rows.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(
      `  priority=${row.priority} action=${row.recommendedAction} [${row.status}] #${row.pageId} ${row.slug}`
    );
    lines.push(
      `    conviction=${row.conviction ?? "(none)"} target=${row.targetSlug ?? "(none)"} stale=${row.daysSinceUpdate}d unresolved=${row.unresolvedConditions} signals=${row.recentSignals}`
    );
  }
  return lines.join("\n");
}
