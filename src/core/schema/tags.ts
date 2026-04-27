import { bigint, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

export const tags = pgTable(
  "tags",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    pageId: bigint("page_id", { mode: "bigint" }).notNull(),
    tag: text("tag").notNull(),
    ...auditFields,
  },
  (t) => ({
    pageTagUnique: uniqueIndex("uq_tags_page_tag")
      .on(t.pageId, t.tag)
      .where(sql`deleted = 0`),
    tagIdx: index("idx_tags_tag").on(t.tag),
    pageIdx: index("idx_tags_page").on(t.pageId),
  })
);

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
