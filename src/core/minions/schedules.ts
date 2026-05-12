import { and, asc, desc, eq } from "drizzle-orm";

import { Actor, withAudit, withCreateAudit } from "~/core/audit.ts";
import { db, schema, sql } from "~/core/db.ts";

import type { MinionJobName } from "./types.ts";

export interface CreateScheduleInput {
  name: string;
  jobName: MinionJobName;
  jobData: Record<string, unknown>;
  nextRunAt: Date;
  intervalSeconds?: number | null;
  priority?: number;
  maxAttempts?: number;
  maxRuns?: number | null;
  actor?: string;
}

export interface ListSchedulesOptions {
  status?: string;
  limit?: number;
}

export interface TriggeredSchedule {
  scheduleId: string;
  scheduleName: string;
  jobId: string;
  jobName: string;
  nextRunAt: string | null;
  status: string;
}

export interface DueSchedulesReport {
  checkedAt: string;
  triggered: TriggeredSchedule[];
}

interface DueScheduleRow {
  id: bigint;
  name: string;
  job_name: string;
  job_data: Record<string, unknown>;
  priority: number;
  max_attempts: number;
  next_run_at: Date | string | null;
  interval_seconds: number | null;
  max_runs: number | null;
  run_count: number;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function advanceNextRunAt(
  current: Date,
  intervalSeconds: number | null,
  now: Date
): Date | null {
  if (!intervalSeconds || intervalSeconds <= 0) return null;
  let next = new Date(current.getTime() + intervalSeconds * 1000);
  while (next <= now) {
    next = new Date(next.getTime() + intervalSeconds * 1000);
  }
  return next;
}

export async function createSchedule(
  input: CreateScheduleInput
): Promise<typeof schema.schedules.$inferSelect> {
  const actor = input.actor ?? Actor.systemJobs;
  const [row] = await db
    .insert(schema.schedules)
    .values(
      withCreateAudit(
        {
          name: input.name,
          status: "active",
          jobName: input.jobName,
          jobData: input.jobData,
          nextRunAt: input.nextRunAt,
          intervalSeconds: input.intervalSeconds ?? null,
          priority: input.priority ?? 50,
          maxAttempts: input.maxAttempts ?? 3,
          maxRuns: input.maxRuns ?? null,
        },
        actor
      )
    )
    .returning();
  if (!row) throw new Error(`failed to create schedule ${input.name}`);
  return row;
}

export async function listSchedules(
  opts: ListSchedulesOptions = {}
): Promise<Array<typeof schema.schedules.$inferSelect>> {
  const conditions = [eq(schema.schedules.deleted, 0)];
  if (opts.status) conditions.push(eq(schema.schedules.status, opts.status));
  return db
    .select()
    .from(schema.schedules)
    .where(and(...conditions))
    .orderBy(asc(schema.schedules.nextRunAt), desc(schema.schedules.createTime))
    .limit(opts.limit ?? 50);
}

export async function getSchedule(
  id: bigint
): Promise<typeof schema.schedules.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(schema.schedules)
    .where(and(eq(schema.schedules.id, id), eq(schema.schedules.deleted, 0)))
    .limit(1);
  return row ?? null;
}

export async function pauseSchedule(
  id: bigint,
  reason?: string
): Promise<typeof schema.schedules.$inferSelect | null> {
  const [row] = await db
    .update(schema.schedules)
    .set(withAudit({ status: "paused", lastError: reason ?? "paused" }, Actor.systemJobs))
    .where(and(eq(schema.schedules.id, id), eq(schema.schedules.deleted, 0)))
    .returning();
  return row ?? null;
}

export async function resumeSchedule(
  id: bigint
): Promise<typeof schema.schedules.$inferSelect | null> {
  const [row] = await db
    .update(schema.schedules)
    .set(withAudit({ status: "active", lastError: null }, Actor.systemJobs))
    .where(and(eq(schema.schedules.id, id), eq(schema.schedules.deleted, 0)))
    .returning();
  return row ?? null;
}

export async function deleteSchedule(
  id: bigint,
  reason?: string
): Promise<typeof schema.schedules.$inferSelect | null> {
  const [row] = await db
    .update(schema.schedules)
    .set(
      withAudit(
        {
          status: "cancelled",
          deleted: 1,
          lastError: reason ?? "deleted",
        },
        Actor.systemJobs
      )
    )
    .where(and(eq(schema.schedules.id, id), eq(schema.schedules.deleted, 0)))
    .returning();
  return row ?? null;
}

export async function enqueueDueSchedules(limit = 10): Promise<DueSchedulesReport> {
  const now = new Date();
  const checkedAt = now.toISOString();
  const triggered = await sql.begin(async (tx) => {
    const q = tx as unknown as typeof sql;
    const due = (await q`
      SELECT
        id,
        name,
        job_name,
        job_data,
        priority,
        max_attempts,
        next_run_at,
        interval_seconds,
        max_runs,
        run_count
      FROM schedules
      WHERE deleted = 0
        AND status = 'active'
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
        AND (max_runs IS NULL OR run_count < max_runs)
      ORDER BY next_run_at ASC, id ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `) as DueScheduleRow[];

    const out: TriggeredSchedule[] = [];
    for (const schedule of due) {
      const scheduleId = schedule.id.toString();
      const jobData = {
        ...(schedule.job_data ?? {}),
        schedule: {
          id: scheduleId,
          name: schedule.name,
          triggeredAt: checkedAt,
        },
      };
      const jobs = (await q`
        INSERT INTO minion_jobs (
          name,
          status,
          priority,
          data,
          max_attempts,
          create_by,
          update_by
        )
        VALUES (
          ${schedule.job_name},
          'waiting',
          ${schedule.priority},
          ${JSON.stringify(jobData)}::jsonb,
          ${schedule.max_attempts},
          ${Actor.systemCron},
          ${Actor.systemCron}
        )
        RETURNING id
      `) as Array<{ id: bigint }>;
      const job = jobs[0];
      if (!job) throw new Error(`failed to enqueue scheduled job for ${schedule.name}`);

      const runCount = schedule.run_count + 1;
      const currentRunAt = schedule.next_run_at ? toDate(schedule.next_run_at) : now;
      const nextRunAt =
        schedule.max_runs != null && runCount >= schedule.max_runs
          ? null
          : advanceNextRunAt(currentRunAt, schedule.interval_seconds, now);
      const nextRunAtIso = nextRunAt ? nextRunAt.toISOString() : null;
      const status = nextRunAt ? "active" : "completed";

      await q.unsafe(
        `
          UPDATE schedules
          SET
            status = $1,
            run_count = $2,
            last_run_at = NOW(),
            last_job_id = $3,
            next_run_at = $4,
            last_error = NULL,
            update_by = $5,
            update_time = NOW()
          WHERE id = $6
        `,
        [status, runCount, job.id.toString(), nextRunAtIso, Actor.systemCron, scheduleId]
      );

      await q.unsafe(
        `
          INSERT INTO events (
            actor,
            action,
            entity_type,
            entity_id,
            payload,
            create_by,
            update_by
          )
          VALUES (
            $1,
            'schedule_fire',
            'schedule',
            $2,
            $3::jsonb,
            $4,
            $5
          )
        `,
        [
          Actor.systemCron,
          scheduleId,
          JSON.stringify({
            scheduleId,
            scheduleName: schedule.name,
            jobId: job.id.toString(),
            jobName: schedule.job_name,
            nextRunAt: nextRunAtIso,
          }),
          Actor.systemCron,
          Actor.systemCron,
        ]
      );

      out.push({
        scheduleId,
        scheduleName: schedule.name,
        jobId: job.id.toString(),
        jobName: schedule.job_name,
        nextRunAt: nextRunAtIso,
        status,
      });
    }
    return out;
  });

  return { checkedAt, triggered };
}
