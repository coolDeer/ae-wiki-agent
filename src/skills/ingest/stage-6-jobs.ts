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
import type { IngestContext } from "~/core/types.ts";

export async function stage6Jobs(ctx: IngestContext): Promise<void> {
  await db.insert(schema.minionJobs).values([
    withCreateAudit(
      {
        name: "embed_chunks",
        status: "waiting",
        // 抬高优先级：enrich agent 调 search 依赖 source 的 chunks 已 embed
        priority: 80,
        data: { pageId: ctx.pageId.toString() },
      },
      ctx.actor
    ),
    withCreateAudit(
      {
        name: "detect_signals",
        status: "waiting",
        data: { pageId: ctx.pageId.toString() },
      },
      ctx.actor
    ),
    // enrich_entity 在 Stage 4 自动建实体后单独入队（这里先占位）
  ]);

  console.log(`  [stage6] jobs queued`);
}
