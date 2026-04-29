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
    /** 上游 parsedMarkdownS3 直链 — ingest 时按需 fetch（不再落本地） */
    markdownUrl: text("markdown_url").notNull(),
    /** 上游 parsedContentListV2S3 — mineru V2 block JSON；chunker 用，缺失时回退 markdown */
    parsedContentListV2Url: text("parsed_content_list_v2_url"),
    /** ResearchReportRecord._id (hex)；唯一去重键 */
    recordId: text("record_id"),
    /** 上游 researchId（**非**唯一，同 researchId 可对应多份文件） */
    researchId: text("research_id"),
    researchType: text("research_type"),
    orgCode: text("org_code"),
    title: text("title"),
    tags: text("tags").array(),
    mongoDoc: jsonb("mongo_doc"),
    parseStatus: text("parse_status"),
    // 显式 triage 结果：pending | pass | commit | brief
    triageDecision: text("triage_decision").notNull().default("pending"),
    ingestedPageId: bigint("ingested_page_id", { mode: "bigint" }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }),
    // triage 主动跳过：raw 不入 wiki（跟 deleted=1 语义分开）
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    skipReason: text("skip_reason"),
    ...auditFields,
  },
  (t) => ({
    recordIdUnique: uniqueIndex("uq_raw_files_record_id")
      .on(t.recordId)
      .where(sql`deleted = 0 AND record_id IS NOT NULL`),
    researchIdIdx: index("idx_raw_files_research_id")
      .on(t.researchId)
      .where(sql`deleted = 0 AND research_id IS NOT NULL`),
    pendingIdx: index("idx_raw_files_pending").on(t.createTime),
    typeIdx: index("idx_raw_files_research_type").on(t.researchType),
    triageIdx: index("idx_raw_files_triage_decision").on(t.triageDecision),
    orgIdx: index("idx_raw_files_org").on(t.orgCode),
    skippedIdx: index("idx_raw_files_skipped")
      .on(t.skippedAt)
      .where(sql`skipped_at IS NOT NULL`),
  })
);

export type RawFile = typeof rawFiles.$inferSelect;
export type NewRawFile = typeof rawFiles.$inferInsert;
