#!/usr/bin/env bun
/**
 * 临时诊断脚本：过去 12h job 完成 / 失败 / 卡住情况。
 * 用完可删。
 */

import { sql } from "~/core/db.ts";

try {
  // 1. 当前队列状态（按 name + status 分组）
  console.log("=== 当前队列分布 ===");
  const live = await sql<{ name: string; status: string; c: number }[]>`
    SELECT name, status, COUNT(*)::int AS c
    FROM minion_jobs
    WHERE deleted = 0 AND status IN ('waiting','active','paused')
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  for (const r of live) console.log(`  ${r.name.padEnd(18)} ${r.status.padEnd(10)} ${r.c}`);

  // 2. 过去 12h 完成 / 失败
  console.log("\n=== 过去 12h 完成情况（按小时）===");
  const completed = await sql<{ hour: string; name: string; c: number }[]>`
    SELECT TO_CHAR(DATE_TRUNC('hour', finished_at), 'MM-DD HH24:00') AS hour,
           name, COUNT(*)::int AS c
    FROM minion_jobs
    WHERE status = 'completed'
      AND finished_at > NOW() - INTERVAL '12 hours'
      AND deleted = 0
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  for (const r of completed) console.log(`  ${r.hour}  ${r.name.padEnd(18)} ${r.c}`);
  if (completed.length === 0) console.log("  (none)");

  console.log("\n=== 过去 12h 失败情况 ===");
  const failed = await sql<{ name: string; c: number }[]>`
    SELECT name, COUNT(*)::int AS c
    FROM minion_jobs
    WHERE status = 'failed'
      AND finished_at > NOW() - INTERVAL '12 hours'
      AND deleted = 0
    GROUP BY 1
    ORDER BY c DESC
  `;
  for (const r of failed) console.log(`  ${r.name.padEnd(18)} ${r.c}`);
  if (failed.length === 0) console.log("  (none)");

  // 3. 当前 active 是不是卡住了
  console.log("\n=== 当前 active job 详情 ===");
  const active = await sql<{
    id: bigint;
    name: string;
    started_at: string | null;
    attempts: number;
    skill: string | null;
    stuck_sec: number | null;
  }[]>`
    SELECT id, name, started_at::text AS started_at, attempts,
           data->>'skill' AS skill,
           CASE WHEN started_at IS NULL THEN NULL
                ELSE EXTRACT(EPOCH FROM (NOW() - started_at))::int
           END AS stuck_sec
    FROM minion_jobs
    WHERE status = 'active' AND deleted = 0
    ORDER BY started_at NULLS LAST
  `;
  for (const r of active) {
    console.log(
      `  #${r.id} ${r.name.padEnd(14)} ${(r.skill ?? "-").padEnd(22)} attempts=${r.attempts} stuck=${r.stuck_sec ?? "?"}s started=${r.started_at ?? "?"}`
    );
  }
  if (active.length === 0) console.log("  (none)");

  // 4. 最近失败样本（看 error）
  console.log("\n=== 最近 5 条失败 error 样本 ===");
  const errors = await sql<{
    id: bigint;
    name: string;
    attempts: number;
    error: string | null;
    finished_at: Date;
  }[]>`
    SELECT id, name, attempts, error, finished_at
    FROM minion_jobs
    WHERE status = 'failed'
      AND finished_at > NOW() - INTERVAL '12 hours'
      AND deleted = 0
    ORDER BY finished_at DESC
    LIMIT 5
  `;
  for (const r of errors) {
    const errHead = (r.error ?? "").slice(0, 120).replace(/\n/g, " ");
    console.log(`  #${r.id} ${r.name} attempts=${r.attempts}`);
    console.log(`    ${errHead}`);
  }
  if (errors.length === 0) console.log("  (none)");

  // 5. ingest 进度（agent_run + skill=ae-research-ingest）
  console.log("\n=== ingest agent_run 总览（全周期）===");
  const ingestTotals = await sql<{ status: string; c: number }[]>`
    SELECT status, COUNT(*)::int AS c
    FROM minion_jobs
    WHERE deleted = 0
      AND name = 'agent_run'
      AND data->>'skill' = 'ae-research-ingest'
    GROUP BY 1
    ORDER BY 1
  `;
  for (const r of ingestTotals) console.log(`  ${r.status.padEnd(10)} ${r.c}`);

  // 6. enrich agent_run 总览
  console.log("\n=== ae-enrich agent_run 总览 ===");
  const enrichTotals = await sql<{ status: string; c: number }[]>`
    SELECT status, COUNT(*)::int AS c
    FROM minion_jobs
    WHERE deleted = 0
      AND name = 'agent_run'
      AND data->>'skill' = 'ae-enrich'
    GROUP BY 1
    ORDER BY 1
  `;
  for (const r of enrichTotals) console.log(`  ${r.status.padEnd(10)} ${r.c}`);

  // 7. raw_files 状态
  console.log("\n=== raw_files 状态 ===");
  const rawStats = await sql<{ kind: string; c: number }[]>`
    SELECT
      CASE
        WHEN ingested_page_id IS NOT NULL THEN 'ingested'
        WHEN skipped_at IS NOT NULL THEN 'skipped'
        ELSE 'pending'
      END AS kind,
      COUNT(*)::int AS c
    FROM raw_files
    WHERE deleted = 0
    GROUP BY 1
    ORDER BY 1
  `;
  for (const r of rawStats) console.log(`  ${r.kind.padEnd(10)} ${r.c}`);
} finally {
  await sql.end();
}
