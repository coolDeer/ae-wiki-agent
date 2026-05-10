/**
 * Stage 6: 异步任务入队
 *
 * 把昂贵 / 不阻塞主路径的任务派发到 minion_jobs：
 *   - embed_chunks: 调 OpenAI embedding API 给 content_chunks 填 embedding
 *   - enrich_entity: 给红链 entity 补全（公司基本面、关键人）
 *   - detect_signals: 跨 source 比对发现 expectation gap
 */

import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import { and, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import type { IngestContext } from "~/core/types.ts";

export async function stage6Jobs(ctx: IngestContext): Promise<void> {
  const pageIdText = ctx.pageId.toString();
  const activeStatuses = ["waiting", "active", "paused"] as const;
  const existingRows = await db
    .select({ name: schema.minionJobs.name })
    .from(schema.minionJobs)
    .where(
      and(
        eq(schema.minionJobs.deleted, 0),
        inArray(schema.minionJobs.status, [...activeStatuses]),
        drizzleSql`${schema.minionJobs.data}->>'pageId' = ${pageIdText}`,
        inArray(schema.minionJobs.name, ["embed_chunks", "detect_signals"])
      )
    );

  const existing = new Set(existingRows.map((row) => row.name));
  const jobs = [];

  if (!existing.has("embed_chunks")) {
    jobs.push(
      withCreateAudit(
        {
          name: "embed_chunks",
          status: "waiting",
          // 抬高优先级：enrich agent 调 search 依赖 source 的 chunks 已 embed
          priority: 80,
          data: { pageId: pageIdText },
        },
        ctx.actor
      )
    );
  }

  if (!existing.has("detect_signals")) {
    jobs.push(
      withCreateAudit(
        {
          name: "detect_signals",
          status: "waiting",
          data: { pageId: pageIdText },
        },
        ctx.actor
      )
    );
  }

  if (jobs.length > 0) {
    await db.insert(schema.minionJobs).values(jobs);
  }

  console.log(
    `  [stage6] jobs queued=${jobs.length} skipped_existing=${existing.size}`
  );
}
