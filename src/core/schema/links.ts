import {
  bigint,
  check,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

export const links = pgTable(
  "links",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    fromPageId: bigint("from_page_id", { mode: "bigint" }).notNull(),
    toPageId: bigint("to_page_id", { mode: "bigint" }).notNull(),
    linkType: text("link_type").notNull().default(""),
    context: text("context").notNull().default(""),
    linkSource: text("link_source"),
    originPageId: bigint("origin_page_id", { mode: "bigint" }),
    originField: text("origin_field"),
    weight: numeric("weight").notNull().default("1.0"),
    ...auditFields,
  },
  (t) => ({
    typeCheck: check(
      "links_type_check",
      sql`${t.linkSource} IS NULL OR ${t.linkSource} IN ('markdown', 'frontmatter', 'manual', 'extracted')`
    ),
    // NOTE: 实际的 NULLS NOT DISTINCT 由 init-v2.sql 维护，
    // Drizzle 0.36 的 uniqueIndex builder 没暴露该 API。
    unique: uniqueIndex("uq_links")
      .on(
        t.fromPageId,
        t.toPageId,
        t.linkType,
        t.linkSource,
        t.originPageId
      )
      .where(sql`deleted = 0`),
    fromIdx: index("idx_links_from").on(t.fromPageId),
    toIdx: index("idx_links_to").on(t.toPageId),
    typeIdx: index("idx_links_type").on(t.linkType),
    sourceIdx: index("idx_links_source").on(t.linkSource),
  })
);

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;

export type LinkSource = "markdown" | "frontmatter" | "manual" | "extracted";
export type LinkType =
  | "" // mention
  | "covers"
  | "competes_with"
  | "invests_in"
  | "works_at"
  | "attended"
  | "subsidiary_of"
  | "partners_with";
