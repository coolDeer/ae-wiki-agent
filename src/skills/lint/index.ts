/**
 * lint skill — 知识库健康检查
 *
 * 跑 5 类只读 SQL 检查，输出报告并写一条 events(action='lint_run')
 * 供后续审计 / 仪表盘消费。被 `lint_run` minion job 与 CLI `ae-wiki lint:run`
 * 共用。
 */

import { sql } from "drizzle-orm";

import { Actor, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";

interface LintCheck {
  name: string;
  count: number;
  sampleIds: string[];
  description: string;
}

export interface LintReport {
  runAt: string;
  totalIssues: number;
  checks: LintCheck[];
}

interface LintOptions {
  /** orphan / pending / fact 检查的"超过 N 天"阈值 */
  staleDays?: number;
  rawAgeDays?: number;
  factAgeDays?: number;
  /** 每项检查保留的样本 ID 数量 */
  sampleSize?: number;
}

const ENTITY_TYPES = ["company", "industry", "concept", "thesis"];

/** drizzle sql template 直接绑 array 给 `= ANY(...)` 在 postgres-js 路径上不稳定，
 *  改用 IN (a,b,c) 列表绑定。同时 orphans skill 也用相同 helper。*/
function inList(values: ReadonlyArray<string>): ReturnType<typeof sql> {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

export async function runLint(opts: LintOptions = {}): Promise<LintReport> {
  const staleDays = opts.staleDays ?? 30;
  const rawAgeDays = opts.rawAgeDays ?? 7;
  const factAgeDays = opts.factAgeDays ?? 90;
  const sampleSize = opts.sampleSize ?? 10;

  const checks: LintCheck[] = [];

  const orphanRows = (await db.execute(sql`
    SELECT p.id::text AS id
    FROM pages p
    WHERE p.deleted = 0
      AND p.type IN (${inList(ENTITY_TYPES)})
      AND NOT EXISTS (
        SELECT 1 FROM links l
        WHERE l.deleted = 0 AND l.to_page_id = p.id
      )
    ORDER BY p.create_time DESC
    LIMIT ${sampleSize + 1}
  `)) as Array<{ id: string }>;

  const orphanCountRow = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM pages p
    WHERE p.deleted = 0
      AND p.type IN (${inList(ENTITY_TYPES)})
      AND NOT EXISTS (
        SELECT 1 FROM links l
        WHERE l.deleted = 0 AND l.to_page_id = p.id
      )
  `)) as Array<{ n: number }>;

  checks.push({
    name: "orphan_pages",
    count: orphanCountRow[0]?.n ?? 0,
    sampleIds: orphanRows.slice(0, sampleSize).map((r) => r.id),
    description: "实体页（company/industry/concept/thesis）没有任何入站 link",
  });

  const staleThesisRows = (await db.execute(sql`
    SELECT t.page_id::text AS id
    FROM theses t
    WHERE t.deleted = 0
      AND t.status = 'active'
      AND t.update_time < NOW() - (${staleDays}::int * INTERVAL '1 day')
    ORDER BY t.update_time ASC
    LIMIT ${sampleSize + 1}
  `)) as Array<{ id: string }>;

  const staleThesisCountRow = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM theses t
    WHERE t.deleted = 0
      AND t.status = 'active'
      AND t.update_time < NOW() - (${staleDays}::int * INTERVAL '1 day')
  `)) as Array<{ n: number }>;

  checks.push({
    name: "stale_active_theses",
    count: staleThesisCountRow[0]?.n ?? 0,
    sampleIds: staleThesisRows.slice(0, sampleSize).map((r) => r.id),
    description: `active thesis 超过 ${staleDays} 天未更新`,
  });

  const redLinkRows = (await db.execute(sql`
    SELECT id::text AS id
    FROM pages
    WHERE deleted = 0
      AND confidence = 'low'
    ORDER BY create_time DESC
    LIMIT ${sampleSize + 1}
  `)) as Array<{ id: string }>;

  const redLinkCountRow = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM pages
    WHERE deleted = 0 AND confidence = 'low'
  `)) as Array<{ n: number }>;

  checks.push({
    name: "unenriched_red_links",
    count: redLinkCountRow[0]?.n ?? 0,
    sampleIds: redLinkRows.slice(0, sampleSize).map((r) => r.id),
    description: "confidence='low' 的红链 entity 还没 enrich",
  });

  const pendingRawRows = (await db.execute(sql`
    SELECT id::text AS id
    FROM raw_files
    WHERE deleted = 0
      AND ingested_page_id IS NULL
      AND skipped_at IS NULL
      AND create_time < NOW() - (${rawAgeDays}::int * INTERVAL '1 day')
    ORDER BY create_time ASC
    LIMIT ${sampleSize + 1}
  `)) as Array<{ id: string }>;

  const pendingRawCountRow = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM raw_files
    WHERE deleted = 0
      AND ingested_page_id IS NULL
      AND skipped_at IS NULL
      AND create_time < NOW() - (${rawAgeDays}::int * INTERVAL '1 day')
  `)) as Array<{ n: number }>;

  checks.push({
    name: "pending_raw_files",
    count: pendingRawCountRow[0]?.n ?? 0,
    sampleIds: pendingRawRows.slice(0, sampleSize).map((r) => r.id),
    description: `raw_files 入库 ${rawAgeDays} 天还没 ingest 也没标 skip`,
  });

  const expiredFactRows = (await db.execute(sql`
    SELECT id::text AS id
    FROM facts
    WHERE deleted = 0
      AND valid_to IS NULL
      AND period_end IS NOT NULL
      AND period_end < CURRENT_DATE - (${factAgeDays}::int * INTERVAL '1 day')
    ORDER BY period_end ASC
    LIMIT ${sampleSize + 1}
  `)) as Array<{ id: string }>;

  const expiredFactCountRow = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM facts
    WHERE deleted = 0
      AND valid_to IS NULL
      AND period_end IS NOT NULL
      AND period_end < CURRENT_DATE - (${factAgeDays}::int * INTERVAL '1 day')
  `)) as Array<{ n: number }>;

  checks.push({
    name: "expired_latest_facts",
    count: expiredFactCountRow[0]?.n ?? 0,
    sampleIds: expiredFactRows.slice(0, sampleSize).map((r) => r.id),
    description: `latest fact (valid_to IS NULL) 的 period_end 已过 ${factAgeDays} 天，应跑 facts:expire`,
  });

  const totalIssues = checks.reduce((sum, c) => sum + c.count, 0);

  const report: LintReport = {
    runAt: new Date().toISOString(),
    totalIssues,
    checks,
  };

  await db.insert(schema.events).values(
    withCreateAudit(
      {
        actor: Actor.systemJobs,
        action: "lint_run",
        entityType: null,
        entityId: null,
        payload: report as unknown as Record<string, unknown>,
      },
      Actor.systemJobs
    )
  );

  return report;
}
