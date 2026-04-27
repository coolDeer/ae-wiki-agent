import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

export const signals = pgTable(
  "signals",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    signalType: text("signal_type").notNull(),
    entityPageId: bigint("entity_page_id", { mode: "bigint" }),
    thesisPageId: bigint("thesis_page_id", { mode: "bigint" }),
    sourcePageId: bigint("source_page_id", { mode: "bigint" }),
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    detail: text("detail"),
    data: jsonb("data"),
    resolved: boolean("resolved").notNull().default(false),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...auditFields,
  },
  (t) => ({
    entityIdx: index("idx_signals_entity").on(t.entityPageId, t.detectedAt),
    thesisIdx: index("idx_signals_thesis").on(t.thesisPageId),
  })
);

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;

export type SignalSeverity = "critical" | "warning" | "info";
export type SignalType =
  | "consensus_drift"
  | "thesis_validation"
  | "thesis_invalidation"
  | "earnings_surprise"
  | "rating_change"
  | "price_target_change"
  | "fact_outlier"
  | "thesis_human_override_suggestion"
  | "internal_inconsistency"
  | (string & {});
