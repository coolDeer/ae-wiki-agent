import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

export const rawData = pgTable(
  "raw_data",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    pageId: bigint("page_id", { mode: "bigint" }).notNull(),
    source: text("source").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...auditFields,
  },
  (t) => ({
    pageSourceUnique: uniqueIndex("uq_raw_data_page_source")
      .on(t.pageId, t.source)
      .where(sql`deleted = 0`),
    pageIdx: index("idx_raw_data_page").on(t.pageId),
  })
);

export type RawData = typeof rawData.$inferSelect;
export type NewRawData = typeof rawData.$inferInsert;
