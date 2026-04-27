import {
  bigint,
  date,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

export const timelineEntries = pgTable(
  "timeline_entries",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    entityPageId: bigint("entity_page_id", { mode: "bigint" }),
    sourcePageId: bigint("source_page_id", { mode: "bigint" }),
    eventDate: date("event_date").notNull(),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    detail: text("detail"),
    metadata: jsonb("metadata").default({}),
    ...auditFields,
  },
  (t) => ({
    entityDateIdx: index("idx_timeline_entity_date").on(
      t.entityPageId,
      t.eventDate
    ),
    typeIdx: index("idx_timeline_event_type").on(t.eventType),
    // NOTE: 实际的 NULLS NOT DISTINCT 由 init-v2.sql 维护，
    // Drizzle 0.36 的 uniqueIndex builder 没暴露该 API。
    dedupIdx: uniqueIndex("idx_timeline_dedup")
      .on(t.entityPageId, t.eventDate, t.summary)
      .where(sql`deleted = 0`),
  })
);

export type TimelineEntry = typeof timelineEntries.$inferSelect;
export type NewTimelineEntry = typeof timelineEntries.$inferInsert;

export type EventType =
  | "earnings"
  | "guidance"
  | "rating_change"
  | "product_launch"
  | "thesis_open"
  | "thesis_close"
  | "news"
  | "other";
