/**
 * Stage 8: thesis 关联 + ingest 完成
 *
 * 1. 找本 source 出去的所有 entity 链接（links.from_page_id = ctx.pageId）
 * 2. 对其中是某个 active thesis 的 target_page_id 的实体，写一条 signal
 *    （signal_type='thesis_validation' 默认，severity='info'，PM 看见后再人工/worker 判定方向）
 * 3. 写 events (action='ingest_complete')
 *
 * 真正的 validation/invalidation 判定由 minion-worker.detect_signals 跨 source 比对完成。
 */

import { eq, and, inArray } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import {
  inferSignalTypeFromLinkType,
  loadThesisConditionSpec,
  matchThesisConditions,
} from "~/core/extractors/signals.ts";
import type { IngestContext } from "~/core/types.ts";

export async function stage8Thesis(ctx: IngestContext): Promise<void> {
  const linkedEntities = await db
    .select({ toPageId: schema.links.toPageId, linkType: schema.links.linkType })
    .from(schema.links)
    .where(
      and(
        eq(schema.links.fromPageId, ctx.pageId),
        eq(schema.links.deleted, 0)
      )
    );

  const entityIds = [...new Set(linkedEntities.map((l) => l.toPageId))];

  const conditionSpec = loadThesisConditionSpec();
  let signalsWritten = 0;
  if (entityIds.length > 0) {
    const activeTheses = await db
      .select({
        thesisPageId: schema.theses.pageId,
        targetPageId: schema.theses.targetPageId,
        direction: schema.theses.direction,
        conviction: schema.theses.conviction,
        title: schema.pages.title,
        validationConditions: schema.theses.validationConditions,
      })
      .from(schema.theses)
      .innerJoin(schema.pages, eq(schema.pages.id, schema.theses.pageId))
      .where(
        and(
          eq(schema.theses.status, "active"),
          inArray(schema.theses.targetPageId, entityIds),
          eq(schema.theses.deleted, 0)
        )
      );

    for (const t of activeTheses) {
      const relatedLink = linkedEntities.find((l) => l.toPageId === t.targetPageId);
      const signalType = inferSignalTypeFromLinkType(relatedLink?.linkType ?? "mention");
      const matchedConditions = matchThesisConditions(
        ((t.validationConditions as Array<{ condition?: string; title?: string; summary?: string }>) ?? []),
        ctx.rawMarkdown || ""
      );
      const inserted = await db
        .insert(schema.signals)
        .values(
          withCreateAudit(
            {
              signalType,
              entityPageId: t.targetPageId,
              thesisPageId: t.thesisPageId,
              sourcePageId: ctx.pageId,
              severity: "info",
              title: `新 source 触及 active thesis: ${t.title}`,
              data: {
                direction: t.direction,
                conviction: t.conviction,
                ingestStage: 8,
                matched_conditions: matchedConditions.map((c) => c.condition),
                thesis_condition_status:
                  conditionSpec.status_mapping[signalType] ?? "pending",
              },
            },
            ctx.actor
          )
        )
        .onConflictDoNothing()
        .returning({ id: schema.signals.id });
      if (inserted.length > 0) signalsWritten++;
    }
  }

  if (signalsWritten > 0) {
    console.log(
      `  [stage8] ${signalsWritten} thesis-related signals written (entities=${entityIds.length})`
    );
  }

  await db.insert(schema.events).values({
    actor: ctx.actor,
    action: "ingest_complete",
    entityType: "page",
    entityId: ctx.pageId,
    payload: { rawFileId: ctx.rawFileId.toString() },
    createBy: ctx.actor,
    updateBy: ctx.actor,
  });

  console.log(`  [stage8] ingest_complete event logged`);
}
