import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

export const schedules = pgTable(
  "schedules",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    jobName: text("job_name").notNull(),
    jobData: jsonb("job_data").notNull().default({}),
    priority: integer("priority").notNull().default(50),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    intervalSeconds: integer("interval_seconds"),
    maxRuns: integer("max_runs"),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastJobId: bigint("last_job_id", { mode: "bigint" }),
    lastError: text("last_error"),
    ...auditFields,
  },
  (t) => ({
    nameUq: uniqueIndex("uq_schedules_name")
      .on(t.name)
      .where(sql`deleted = 0`),
    dueIdx: index("idx_schedules_due")
      .on(t.status, t.nextRunAt)
      .where(sql`deleted = 0 AND status = 'active'`),
    jobIdx: index("idx_schedules_job_name").on(t.jobName),
  })
);

export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;

export type ScheduleStatus = "active" | "paused" | "completed" | "cancelled";
