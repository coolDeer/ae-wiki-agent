#!/usr/bin/env bun
/**
 * 运维状态快照 — 给 scripts/run-daily.sh 用，shell 解析 JSON。
 *
 * 输出：
 *   {"rawPending": N, "queueWaiting": N, "queueActive": N}
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

  const waiting = queueRows.find((r) => r.status === "waiting")?.c ?? 0;
  const active = queueRows.find((r) => r.status === "active")?.c ?? 0;

  console.log(
    JSON.stringify({
      rawPending: rawPendingRows[0]?.c ?? 0,
      queueWaiting: waiting,
      queueActive: active,
    })
  );
} finally {
  await sql.end();
}
