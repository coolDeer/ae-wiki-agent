import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

export const minionJobs = pgTable(
  "minion_jobs",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    status: text("status").notNull().default("waiting"),
    data: jsonb("data").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    result: jsonb("result"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...auditFields,
  },
  (t) => ({
    pendingIdx: index("idx_jobs_pending").on(t.name, t.createTime),
    statusIdx: index("idx_jobs_status").on(t.status, t.createTime),
  })
);

export type MinionJob = typeof minionJobs.$inferSelect;
export type NewMinionJob = typeof minionJobs.$inferInsert;

export type JobName =
  | "embed_chunks"
  | "extract_facts"
  | "enrich_entity"
  | "detect_signals";

export type JobStatus = "waiting" | "active" | "completed" | "failed";
