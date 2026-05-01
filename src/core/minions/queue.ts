import { and, desc, eq, ne } from "drizzle-orm";

import { withAudit, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";

import type { MinionJobName, MinionJobStatus } from "./types.ts";

export async function addJob(
  name: MinionJobName,
  data: Record<string, unknown>,
  actor: string,
  opts: {
    status?: MinionJobStatus;
    maxAttempts?: number;
    priority?: number;
    progress?: Record<string, unknown> | null;
  } = {}
): Promise<typeof schema.minionJobs.$inferSelect> {
  const [job] = await db
    .insert(schema.minionJobs)
    .values(
      withCreateAudit(
        {
          name,
          status: opts.status ?? "waiting",
          data,
          maxAttempts: opts.maxAttempts ?? 3,
          priority: opts.priority,
          progress: opts.progress ?? null,
        },
        actor
      )
    )
    .returning();

  if (!job) throw new Error(`failed to add job ${name}`);
  return job;
}

export async function getJob(jobId: bigint): Promise<typeof schema.minionJobs.$inferSelect | null> {
  const [job] = await db
    .select()
    .from(schema.minionJobs)
    .where(and(eq(schema.minionJobs.id, jobId), eq(schema.minionJobs.deleted, 0)))
    .limit(1);
  return job ?? null;
}

export async function listJobs(opts: {
  status?: MinionJobStatus | string;
  name?: MinionJobName | string;
  limit?: number;
} = {}): Promise<Array<typeof schema.minionJobs.$inferSelect>> {
  const conditions = [eq(schema.minionJobs.deleted, 0)];
  if (opts.status) conditions.push(eq(schema.minionJobs.status, opts.status));
  if (opts.name) conditions.push(eq(schema.minionJobs.name, opts.name));

  return db
    .select()
    .from(schema.minionJobs)
    .where(and(...conditions))
    .orderBy(desc(schema.minionJobs.createTime))
    .limit(opts.limit ?? 20);
}

export async function updateJobProgress(
  jobId: bigint,
  progress: Record<string, unknown> | null,
  actor: string
): Promise<void> {
  await db
    .update(schema.minionJobs)
    .set(withAudit({ progress }, actor))
    .where(eq(schema.minionJobs.id, jobId));
}

export async function completeJob(
  jobId: bigint,
  actor: string,
  result: unknown
): Promise<void> {
  await db
    .update(schema.minionJobs)
    .set(
      withAudit(
        {
          status: "completed",
          result: result == null ? null : result,
          finishedAt: new Date(),
        },
        actor
      )
    )
    .where(
      and(
        eq(schema.minionJobs.id, jobId),
        ne(schema.minionJobs.status, "cancelled"),
        ne(schema.minionJobs.status, "paused")
      )
    );
}

export async function failJob(
  jobId: bigint,
  actor: string,
  error: string,
  retry: boolean
): Promise<void> {
  await db
    .update(schema.minionJobs)
    .set(
      withAudit(
        {
          status: retry ? "waiting" : "failed",
          error,
        },
        actor
      )
    )
    .where(
      and(
        eq(schema.minionJobs.id, jobId),
        ne(schema.minionJobs.status, "cancelled"),
        ne(schema.minionJobs.status, "paused")
      )
    );
}

export async function retryJob(jobId: bigint, actor: string): Promise<void> {
  await db
    .update(schema.minionJobs)
    .set(
      withAudit(
        {
          status: "waiting",
          progress: null,
          result: null,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
        actor
      )
    )
    .where(eq(schema.minionJobs.id, jobId));
}

export async function cancelJob(jobId: bigint, actor: string, reason?: string): Promise<void> {
  await db
    .update(schema.minionJobs)
    .set(
      withAudit(
        {
          status: "cancelled",
          error: reason ?? "cancelled",
          finishedAt: new Date(),
        },
        actor
      )
    )
    .where(eq(schema.minionJobs.id, jobId));
}

export async function pauseJob(jobId: bigint, actor: string, reason?: string): Promise<void> {
  await db
    .update(schema.minionJobs)
    .set(
      withAudit(
        {
          status: "paused",
          error: reason ?? "paused",
        },
        actor
      )
    )
    .where(eq(schema.minionJobs.id, jobId));
}

export async function resumeJob(jobId: bigint, actor: string): Promise<void> {
  await db
    .update(schema.minionJobs)
    .set(
      withAudit(
        {
          status: "waiting",
          error: null,
        },
        actor
      )
    )
    .where(eq(schema.minionJobs.id, jobId));
}
