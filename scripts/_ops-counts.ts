#!/usr/bin/env bun
/**
 * 运维状态快照 — 给 scripts/run-daily.sh 用，shell 解析 JSON。
 *
 * 输出 6 个数：
 *   rawPending      raw_files 待 ingest（未提交也未 skip）
 *   ingestWaiting   agent_run waiting 中、skill=ae-research-ingest
 *   ingestActive    agent_run active 中、skill=ae-research-ingest
 *   queueWaiting    全部 minion_jobs.status='waiting'（含下游 cascade）
 *   queueActive     全部 minion_jobs.status='active'
 *
 * drain 判定：rawPending=0 && ingestWaiting=0 && ingestActive=0
 * （下游 embed/signals/enrich 不阻塞 daily-review，让它们后台慢慢跑）
 *
 * 用法：bun scripts/_ops-counts.ts
 */

import { sql } from "~/core/db.ts";

try {
  const rawPendingRows = await sql<{ c: number }[]>`
    SELECT COUNT(*)::int AS c FROM raw_files
    WHERE deleted = 0
      AND ingested_page_id IS NULL
      AND skipped_at IS NULL
  `;

  const queueRows = await sql<{ status: string; c: number }[]>`
    SELECT status, COUNT(*)::int AS c FROM minion_jobs
    WHERE deleted = 0 AND status IN ('waiting', 'active')
    GROUP BY status
  `;

  const ingestRows = await sql<{ status: string; c: number }[]>`
    SELECT status, COUNT(*)::int AS c FROM minion_jobs
    WHERE deleted = 0
      AND name = 'agent_run'
      AND status IN ('waiting', 'active')
      AND data->>'skill' = 'ae-research-ingest'
    GROUP BY status
  `;

  const queueWaiting = queueRows.find((r) => r.status === "waiting")?.c ?? 0;
  const queueActive = queueRows.find((r) => r.status === "active")?.c ?? 0;
  const ingestWaiting = ingestRows.find((r) => r.status === "waiting")?.c ?? 0;
  const ingestActive = ingestRows.find((r) => r.status === "active")?.c ?? 0;

  console.log(
    JSON.stringify({
      rawPending: rawPendingRows[0]?.c ?? 0,
      ingestWaiting,
      ingestActive,
      queueWaiting,
      queueActive,
    })
  );
} finally {
  await sql.end();
}
