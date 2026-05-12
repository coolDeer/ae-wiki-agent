/**
 * Stage 7: timeline 提取
 *
 * 从 page.timeline 解析 YAML 列表并写入 timeline_entries。
 * page.timeline 由 Stage 3 在 narrative body 中通过 `<!-- timeline -->`
 * sentinel 切出，dedup 走 (entity_page_id, event_date, summary) 唯一索引。
 *
 * 块格式：
 *   <!-- timeline
 *   - entity: companies/<slug>     # 可选；缺失时 entity_page_id=NULL（source-level 事件）
 *     date: 2026-04-15             # YYYY-MM-DD
 *     event_type: earnings | guidance | rating_change | product_launch | thesis_open | thesis_close | news | other
 *     summary: <一句话>
 *     detail: <可选，多行明细>
 *   -->
 *
 * 未知 entity 不自动建（与 Stage 4 不同，timeline 只挂已有 page 上）。
 */

import { eq } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import {
  isValidTimelineEntry,
  matchTimelineSpec,
  normalizeTimelineEventType,
  parseTimelineYaml,
  type YamlTimelineEntry as YamlTimeline,
} from "~/core/extractors/timeline.ts";
import {
  maybeEnqueueEnrichForBacklinkGrowth,
  resolveOrCreatePage,
} from "./_helpers.ts";
import type { IngestContext } from "~/core/types.ts";

export async function stage7Timeline(ctx: IngestContext): Promise<void> {
  const [page] = await db
    .select({ timeline: schema.pages.timeline, type: schema.pages.type })
    .from(schema.pages)
    .where(eq(schema.pages.id, ctx.pageId))
    .limit(1);
  if (!page) return;
  const timelineSpec = matchTimelineSpec(page.type);

  const entries = extractTimelineText(page.timeline);
  if (entries.length === 0) {
    console.log(`  [stage7] no timeline content, skipped`);
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const e of entries) {
    if (!isValidTimelineEntry(e, timelineSpec)) {
      skipped++;
      continue;
    }

    let entityPageId: bigint | null = null;
    if (e.entity) {
      entityPageId = await resolveOrCreatePage(e.entity, {
        actor: ctx.actor,
        autoCreate: false,
      });
      if (!entityPageId) {
        console.warn(`  [stage7] 跳过未知 entity: ${e.entity}`);
        skipped++;
        continue;
      }
    }

    const eventType = normalizeTimelineEventType(e.event_type, timelineSpec);

    const result = await db
      .insert(schema.timelineEntries)
      .values(
        withCreateAudit(
          {
            entityPageId,
            sourcePageId: ctx.pageId,
            eventDate: e.date,
            eventType,
            summary: e.summary.trim(),
            detail: e.detail ?? null,
            metadata: e.metadata ?? {},
          },
          ctx.actor
        )
      )
      .onConflictDoNothing()
      .returning({ id: schema.timelineEntries.id });

    if (result.length > 0) {
      inserted++;
      if (entityPageId && e.entity) {
        await maybeEnqueueEnrichForBacklinkGrowth({
          pageId: entityPageId,
          slug: e.entity,
          sourcePageId: ctx.pageId,
          actor: ctx.actor,
        });
      }
    } else {
      skipped++;
    }
  }

  console.log(`  [stage7] inserted=${inserted} skipped=${skipped}`);
}

function extractTimelineText(timeline: string): YamlTimeline[] {
  const trimmed = timeline.trim();
  if (!trimmed) return [];
  return parseTimelineYaml(trimmed, "timeline field");
}
