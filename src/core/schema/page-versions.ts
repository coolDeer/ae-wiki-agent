import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

export const pageVersions = pgTable(
  "page_versions",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    pageId: bigint("page_id", { mode: "bigint" }).notNull(),
    content: text("content").notNull(),
    timeline: text("timeline").notNull().default(""),
    frontmatter: jsonb("frontmatter").notNull().default({}),
    editedBy: text("edited_by"),
    reason: text("reason"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...auditFields,
  },
  (t) => ({
    pageIdx: index("idx_versions_page").on(t.pageId, t.snapshotAt),
  })
);

export type PageVersion = typeof pageVersions.$inferSelect;
export type NewPageVersion = typeof pageVersions.$inferInsert;
