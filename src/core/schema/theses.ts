import {
  bigint,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

export const theses = pgTable(
  "theses",
  {
    pageId: bigint("page_id", { mode: "bigint" }).primaryKey(), // 1:1 扩展 pages
    targetPageId: bigint("target_page_id", { mode: "bigint" }).notNull(),
    direction: text("direction").notNull(),
    conviction: text("conviction"),
    status: text("status").notNull(),
    dateOpened: date("date_opened"),
    dateClosed: date("date_closed"),
    priceAtOpen: numeric("price_at_open"),
    priceAtClose: numeric("price_at_close"),
    catalysts: jsonb("catalysts").notNull().default([]),
    validationConditions: jsonb("validation_conditions").notNull().default([]),
    pmOwner: text("pm_owner"),
    ...auditFields,
  },
  (t) => ({
    statusIdx: index("idx_theses_status").on(t.status),
    targetIdx: index("idx_theses_target").on(t.targetPageId),
    directionIdx: index("idx_theses_direction").on(t.direction),
  })
);

export type Thesis = typeof theses.$inferSelect;
export type NewThesis = typeof theses.$inferInsert;

export type ThesisDirection = "long" | "short" | "pair" | "neutral";
export type ThesisConviction = "high" | "medium" | "low";
export type ThesisStatus = "active" | "monitoring" | "closed" | "invalidated";
