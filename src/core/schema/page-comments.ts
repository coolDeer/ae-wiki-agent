import { bigint, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

/**
 * page_comments — 用户在 web UI 上对任意 page 留下的 free-text 评论。
 *
 * 用途：人工反馈通道。后续 skill / agent 可以读这些评论调整 fact 抽取 /
 * narrative 生成 / triage 策略。没有登录系统，author 是自填的 display name。
 * parent_id 为未来线程化预留，目前只用顶级评论。
 */
export const pageComments = pgTable(
  "page_comments",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    pageId: bigint("page_id", { mode: "bigint" }).notNull(),
    author: text("author").notNull(),
    content: text("content").notNull(),
    parentId: bigint("parent_id", { mode: "bigint" }),
    metadata: jsonb("metadata").notNull().default({}),
    ...auditFields,
  },
  (t) => ({
    pageIdx: index("idx_page_comments_page")
      .on(t.pageId, t.createTime.desc())
      .where(sql`deleted = 0`),
    timeIdx: index("idx_page_comments_create_time")
      .on(t.createTime.desc())
      .where(sql`deleted = 0`),
    parentIdx: index("idx_page_comments_parent")
      .on(t.parentId)
      .where(sql`deleted = 0 AND parent_id IS NOT NULL`),
  })
);

export type PageComment = typeof pageComments.$inferSelect;
export type NewPageComment = typeof pageComments.$inferInsert;
