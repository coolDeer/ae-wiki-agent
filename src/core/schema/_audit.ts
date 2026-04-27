import { jsonb, smallint, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * 标准审计字段（所有表统一）。在每个 table 定义里 spread 进去。
 *
 * 注意：update_time 默认值是 NOW()，但 UPDATE 时不自动维护 —
 * 应用层在每次 UPDATE 时显式 SET update_time = NOW() / update_by = <actor>。
 * 用 src/core/audit.ts 的 helper 统一注入。
 */
export const auditFields = {
  extend: jsonb("extend"),
  createBy: varchar("create_by", { length: 64 }).notNull().default(""),
  updateBy: varchar("update_by", { length: 64 }).notNull().default(""),
  createTime: timestamp("create_time", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updateTime: timestamp("update_time", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deleted: smallint("deleted").notNull().default(0),
};
