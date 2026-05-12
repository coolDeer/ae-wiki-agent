import {
  createSchedule,
  deleteSchedule,
  enqueueDueSchedules,
  getSchedule,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
} from "~/core/minions/schedules.ts";
import { MINION_JOB_NAMES, type MinionJobName } from "~/core/minions/types.ts";
import type { Schedule } from "~/core/schema/schedules.ts";

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, current) => (typeof current === "bigint" ? current.toString() : current),
    2
  );
}

function requireFlag(args: string[], flag: string): string {
  const value = parseFlag(args, flag);
  if (!value) {
    console.error(`schedules:add 需要 ${flag}`);
    process.exit(1);
  }
  return value;
}

function parseJobName(value: string): MinionJobName {
  if ((MINION_JOB_NAMES as readonly string[]).includes(value)) return value as MinionJobName;
  console.error(`Unknown job name: ${value}`);
  console.error(`Allowed: ${MINION_JOB_NAMES.join(", ")}`);
  process.exit(1);
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--data must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function parsePositiveInt(value: string | undefined, name: string): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseDailyAt(value: string): Date {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error("--daily-at must be HH:MM");
  const hour = parseInt(m[1]!, 10);
  const minute = parseInt(m[2]!, 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("--daily-at must be a valid local wall-clock time");
  }
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  return next;
}

function parseNextRun(args: string[]): { nextRunAt: Date; intervalSeconds: number | null } {
  const dailyAt = parseFlag(args, "--daily-at");
  if (dailyAt) {
    return { nextRunAt: parseDailyAt(dailyAt), intervalSeconds: 24 * 3600 };
  }

  const at = requireFlag(args, "--at");
  const nextRunAt = at === "now" ? new Date() : new Date(at);
  if (Number.isNaN(nextRunAt.getTime())) {
    throw new Error("--at must be an ISO timestamp or 'now'");
  }
  const intervalMinutes = parsePositiveInt(
    parseFlag(args, "--interval-minutes"),
    "--interval-minutes"
  );
  return {
    nextRunAt,
    intervalSeconds: intervalMinutes ? intervalMinutes * 60 : null,
  };
}

function serializeSchedule(row: Schedule) {
  return {
    id: row.id.toString(),
    name: row.name,
    status: row.status,
    jobName: row.jobName,
    jobData: row.jobData,
    priority: row.priority,
    maxAttempts: row.maxAttempts,
    nextRunAt: row.nextRunAt,
    intervalSeconds: row.intervalSeconds,
    maxRuns: row.maxRuns,
    runCount: row.runCount,
    lastRunAt: row.lastRunAt,
    lastJobId: row.lastJobId?.toString() ?? null,
    lastError: row.lastError,
    createdAt: row.createTime,
    updatedAt: row.updateTime,
  };
}

async function addScheduleCmd(args: string[]): Promise<void> {
  const { nextRunAt, intervalSeconds } = parseNextRun(args);
  const row = await createSchedule({
    name: requireFlag(args, "--name"),
    jobName: parseJobName(requireFlag(args, "--job-name")),
    jobData: parseJsonObject(parseFlag(args, "--data")),
    nextRunAt,
    intervalSeconds,
    priority: parsePositiveInt(parseFlag(args, "--priority"), "--priority"),
    maxAttempts: parsePositiveInt(parseFlag(args, "--max-attempts"), "--max-attempts"),
    maxRuns: parsePositiveInt(parseFlag(args, "--max-runs"), "--max-runs") ?? null,
  });
  console.log(jsonStringify(serializeSchedule(row)));
}

async function createNightlyCmd(args: string[]): Promise<void> {
  const dailyAt = parseFlag(args, "--daily-at") ?? "02:30";
  const maintainAt = parseDailyAt(dailyAt);
  const refreshAt = new Date(maintainAt.getTime() + 15 * 60 * 1000);

  const maintain = await createSchedule({
    name: parseFlag(args, "--maintain-name") ?? "nightly-wiki-maintain",
    jobName: "wiki_maintain",
    jobData: {
      limit: parsePositiveInt(parseFlag(args, "--limit"), "--limit") ?? 100,
      applySafe: true,
      entityRefreshLimit:
        parsePositiveInt(parseFlag(args, "--entity-refresh-limit"), "--entity-refresh-limit") ?? 10,
      enqueueEnrich: true,
      enrichLimit: parsePositiveInt(parseFlag(args, "--enrich-limit"), "--enrich-limit") ?? 50,
      enqueueThesisReview: true,
      thesisLimit: parsePositiveInt(parseFlag(args, "--thesis-limit"), "--thesis-limit") ?? 30,
      factAgeDays: parsePositiveInt(parseFlag(args, "--fact-age-days"), "--fact-age-days") ?? 90,
    },
    nextRunAt: maintainAt,
    intervalSeconds: 24 * 3600,
    priority: 40,
  });

  const refresh = await createSchedule({
    name: parseFlag(args, "--refresh-name") ?? "nightly-entity-refresh-queue",
    jobName: "entity_refresh_queue",
    jobData: {
      limit: parsePositiveInt(parseFlag(args, "--queue-refresh-limit"), "--queue-refresh-limit") ?? 200,
    },
    nextRunAt: refreshAt,
    intervalSeconds: 24 * 3600,
    priority: 39,
  });

  console.log(
    jsonStringify({
      created: [serializeSchedule(maintain), serializeSchedule(refresh)],
    })
  );
}

export async function runSchedulesCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(`Usage:
  ae-wiki schedules:list [--status active|paused|completed|cancelled] [--limit N]
  ae-wiki schedules:get <schedule_id>
  ae-wiki schedules:add --name NAME --job-name JOB --data JSON (--at ISO|now [--interval-minutes N] | --daily-at HH:MM)
                         [--priority N] [--max-attempts N] [--max-runs N]
  ae-wiki schedules:create-nightly [--daily-at HH:MM]
                         [--limit N] [--entity-refresh-limit N] [--enrich-limit N]
                         [--thesis-limit N] [--fact-age-days N] [--queue-refresh-limit N]
  ae-wiki schedules:run-due [--limit N]
  ae-wiki schedules:pause <schedule_id> [--reason "..."]
  ae-wiki schedules:resume <schedule_id>
  ae-wiki schedules:delete <schedule_id> [--reason "..."]`);
    return;
  }

  switch (sub) {
    case "list": {
      const rows = await listSchedules({
        status: parseFlag(args, "--status"),
        limit: parsePositiveInt(parseFlag(args, "--limit"), "--limit"),
      });
      console.log(jsonStringify(rows.map(serializeSchedule)));
      return;
    }
    case "get": {
      const id = args[1];
      if (!id) {
        console.error("schedules:get 需要 schedule_id");
        process.exit(1);
      }
      const row = await getSchedule(BigInt(id));
      if (!row) {
        console.error(`schedule #${id} 不存在`);
        process.exit(1);
      }
      console.log(jsonStringify(serializeSchedule(row)));
      return;
    }
    case "add":
      await addScheduleCmd(args);
      return;
    case "create-nightly":
      await createNightlyCmd(args);
      return;
    case "run-due": {
      const report = await enqueueDueSchedules(
        parsePositiveInt(parseFlag(args, "--limit"), "--limit") ?? 10
      );
      console.log(jsonStringify(report));
      return;
    }
    case "pause": {
      const id = args[1];
      if (!id) {
        console.error("schedules:pause 需要 schedule_id");
        process.exit(1);
      }
      const row = await pauseSchedule(BigInt(id), parseFlag(args, "--reason"));
      if (!row) {
        console.error(`schedule #${id} 不存在`);
        process.exit(1);
      }
      console.log(jsonStringify(serializeSchedule(row)));
      return;
    }
    case "resume": {
      const id = args[1];
      if (!id) {
        console.error("schedules:resume 需要 schedule_id");
        process.exit(1);
      }
      const row = await resumeSchedule(BigInt(id));
      if (!row) {
        console.error(`schedule #${id} 不存在`);
        process.exit(1);
      }
      console.log(jsonStringify(serializeSchedule(row)));
      return;
    }
    case "delete": {
      const id = args[1];
      if (!id) {
        console.error("schedules:delete 需要 schedule_id");
        process.exit(1);
      }
      const row = await deleteSchedule(BigInt(id), parseFlag(args, "--reason"));
      if (!row) {
        console.error(`schedule #${id} 不存在`);
        process.exit(1);
      }
      console.log(jsonStringify(serializeSchedule(row)));
      return;
    }
    default:
      console.error(`Unknown schedules command: ${sub}`);
      process.exit(1);
  }
}
