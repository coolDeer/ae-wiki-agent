import { jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    config: jsonb("config").notNull().default({}),
    ...auditFields,
  },
  (t) => ({
    nameUnique: uniqueIndex("uq_sources_name")
      .on(t.name)
      .where(sql`deleted = 0`),
  })
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
