import {
  bigint,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

export const facts = pgTable(
  "facts",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    entityPageId: bigint("entity_page_id", { mode: "bigint" }).notNull(),
    metric: text("metric").notNull(),
    period: text("period"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    valueNumeric: numeric("value_numeric"),
    valueText: text("value_text"),
    unit: text("unit"),
    sourcePageId: bigint("source_page_id", { mode: "bigint" }),
    confidence: numeric("confidence").notNull().default("1.0"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    metadata: jsonb("metadata").default({}),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...auditFields,
  },
  (t) => ({
    entityMetricIdx: index("idx_facts_entity_metric").on(
      t.entityPageId,
      t.metric
    ),
    periodIdx: index("idx_facts_period").on(t.periodStart, t.periodEnd),
    sourceIdx: index("idx_facts_source").on(t.sourcePageId),
  })
);

export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;

/** 常用 metric 枚举（不强制） */
export type MetricName =
  | "revenue"
  | "cogs"
  | "gross_profit"
  | "gross_margin"
  | "opex"
  | "ebit"
  | "ebit_margin"
  | "ebitda"
  | "net_income"
  | "eps_gaap"
  | "eps_non_gaap"
  | "fcf"
  | "fcf_margin"
  | "target_price"
  | "market_cap"
  | "ev"
  | "pe"
  | "ev_ebitda"
  | (string & {}); // 允许扩展
