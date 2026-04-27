import { pgTable, text } from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

export const config = pgTable("config", {
  id: text("id").primaryKey(), // 配置 key 同时作为主键
  value: text("value").notNull(),
  ...auditFields,
});

export type Config = typeof config.$inferSelect;
export type NewConfig = typeof config.$inferInsert;
