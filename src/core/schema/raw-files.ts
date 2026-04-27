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

export const rawFiles = pgTable(
  "raw_files",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    sourceId: text("source_id").notNull().default("default"),
    rawPath: text("raw_path").notNull(),
    researchId: text("research_id"),
    researchType: text("research_type"),
    orgCode: text("org_code"),
    title: text("title"),
    tags: text("tags").array(),
    mongoDoc: jsonb("mongo_doc"),
    parseStatus: text("parse_status"),
    ingestedPageId: bigint("ingested_page_id", { mode: "bigint" }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }),
    // triage 主动跳过：raw 不入 wiki（跟 deleted=1 语义分开）
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    skipReason: text("skip_reason"),
    ...auditFields,
  },
  (t) => ({
    rawPathUnique: uniqueIndex("uq_raw_files_path")
      .on(t.rawPath)
      .where(sql`deleted = 0`),
    researchIdUnique: uniqueIndex("uq_raw_files_research_id")
      .on(t.researchId)
      .where(sql`deleted = 0 AND research_id IS NOT NULL`),
    pendingIdx: index("idx_raw_files_pending").on(t.createTime),
    typeIdx: index("idx_raw_files_research_type").on(t.researchType),
    orgIdx: index("idx_raw_files_org").on(t.orgCode),
    skippedIdx: index("idx_raw_files_skipped")
      .on(t.skippedAt)
      .where(sql`skipped_at IS NOT NULL`),
  })
);

export type RawFile = typeof rawFiles.$inferSelect;
export type NewRawFile = typeof rawFiles.$inferInsert;
