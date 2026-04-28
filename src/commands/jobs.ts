import { Actor } from "~/core/audit.ts";
import {
  cancelJob as cancelJobRow,
  getJob as getJobRow,
  listJobs as listJobRows,
  pauseJob as pauseJobRow,
  resumeJob as resumeJobRow,
  retryJob as retryJobRow,
} from "~/core/minions/queue.ts";
import {
  startSupervisor,
  stopSupervisor,
  supervisorStatus,
} from "~/core/minions/supervisor.ts";
import { runWorker } from "~/core/minions/worker.ts";

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

async function listJobsCmd(args: string[]): Promise<void> {
  const status = parseFlag(args, "--status");
  const name = parseFlag(args, "--name");
  const limit = parseFlag(args, "--limit");

  const rows = await listJobRows({
    status,
    name,
    limit: limit ? parseInt(limit, 10) : undefined,
  });

  console.log(
    jsonStringify(
      rows.map((row) => ({
        id: row.id.toString(),
        name: row.name,
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        progress: row.progress,
        result: row.result,
        error: row.error,
        createdAt: row.createTime,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
      }))
    )
  );
}

async function getJobCmd(jobIdStr: string): Promise<void> {
  const job = await getJobRow(BigInt(jobIdStr));

  if (!job) {
    console.error(`job #${jobIdStr} 不存在`);
    process.exit(1);
  }

  console.log(
    jsonStringify({
      ...job,
      id: job.id.toString(),
    })
  );
}

async function retryJobCmd(jobIdStr: string): Promise<void> {
  const jobId = BigInt(jobIdStr);
  const job = await getJobRow(jobId);

  if (!job) {
    console.error(`job #${jobIdStr} 不存在`);
    process.exit(1);
  }
  if (job.status === "active") {
    console.error(`job #${jobIdStr} 正在运行，不能 retry`);
    process.exit(1);
  }

  await retryJobRow(jobId, Actor.systemJobs);

  console.log(jsonStringify({ ok: true, jobId: jobIdStr, status: "waiting" }));
}

async function cancelJobCmd(jobIdStr: string, reason?: string): Promise<void> {
  const job = await getJobRow(BigInt(jobIdStr));
  if (!job) {
    console.error(`job #${jobIdStr} 不存在`);
    process.exit(1);
  }
  await cancelJobRow(BigInt(jobIdStr), Actor.systemJobs, reason ?? "cancelled by operator");
  console.log(jsonStringify({ ok: true, jobId: jobIdStr, status: "cancelled" }));
}

async function pauseJobCmd(jobIdStr: string, reason?: string): Promise<void> {
  const job = await getJobRow(BigInt(jobIdStr));
  if (!job) {
    console.error(`job #${jobIdStr} 不存在`);
    process.exit(1);
  }
  await pauseJobRow(BigInt(jobIdStr), Actor.systemJobs, reason ?? "paused by operator");
  console.log(jsonStringify({ ok: true, jobId: jobIdStr, status: "paused" }));
}

async function resumeJobCmd(jobIdStr: string): Promise<void> {
  const job = await getJobRow(BigInt(jobIdStr));
  if (!job) {
    console.error(`job #${jobIdStr} 不存在`);
    process.exit(1);
  }
  await resumeJobRow(BigInt(jobIdStr), Actor.systemJobs);
  console.log(jsonStringify({ ok: true, jobId: jobIdStr, status: "waiting" }));
}

export async function runJobsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(`Usage:
  ae-wiki jobs:worker
  ae-wiki jobs:supervisor start [--detach] [--pid-file PATH]
  ae-wiki jobs:supervisor status [--pid-file PATH]
  ae-wiki jobs:supervisor stop [--pid-file PATH]
  ae-wiki jobs:list [--status S] [--name N] [--limit N]
  ae-wiki jobs:get <job_id>
  ae-wiki jobs:pause <job_id> [--reason "..."]
  ae-wiki jobs:resume <job_id>
  ae-wiki jobs:cancel <job_id> [--reason "..."]
  ae-wiki jobs:retry <job_id>`);
    return;
  }

  switch (sub) {
    case "worker":
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage:
  ae-wiki jobs:worker`);
        return;
      }
      await runWorker();
      return;
    case "supervisor": {
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage:
  ae-wiki jobs:supervisor start [--detach] [--pid-file PATH]
  ae-wiki jobs:supervisor status [--pid-file PATH]
  ae-wiki jobs:supervisor stop [--pid-file PATH]`);
        return;
      }
      const action = args[1] ?? "start";
      const pidFile = parseFlag(args, "--pid-file");
      if (action === "start") {
        await startSupervisor({ detach: args.includes("--detach"), pidFile });
        return;
      }
      if (action === "status") {
        console.log(jsonStringify(supervisorStatus(pidFile)));
        return;
      }
      if (action === "stop") {
        console.log(jsonStringify(stopSupervisor(pidFile)));
        return;
      }
      console.error(`Unknown supervisor action: ${action}`);
      process.exit(1);
    }
    case "list":
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage:
  ae-wiki jobs:list [--status S] [--name N] [--limit N]`);
        return;
      }
      await listJobsCmd(args);
      return;
    case "get": {
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage:
  ae-wiki jobs:get <job_id>`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("jobs:get 需要 job_id");
        process.exit(1);
      }
      await getJobCmd(jobIdStr);
      return;
    }
    case "pause": {
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage:
  ae-wiki jobs:pause <job_id> [--reason "..."]`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("jobs:pause 需要 job_id");
        process.exit(1);
      }
      await pauseJobCmd(jobIdStr, parseFlag(args, "--reason"));
      return;
    }
    case "resume": {
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage:
  ae-wiki jobs:resume <job_id>`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("jobs:resume 需要 job_id");
        process.exit(1);
      }
      await resumeJobCmd(jobIdStr);
      return;
    }
    case "cancel": {
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage:
  ae-wiki jobs:cancel <job_id> [--reason "..."]`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("jobs:cancel 需要 job_id");
        process.exit(1);
      }
      await cancelJobCmd(jobIdStr, parseFlag(args, "--reason"));
      return;
    }
    case "retry": {
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage:
  ae-wiki jobs:retry <job_id>`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("jobs:retry 需要 job_id");
        process.exit(1);
      }
      await retryJobCmd(jobIdStr);
      return;
    }
    default:
      console.error(`Unknown jobs command: ${sub}`);
      process.exit(1);
  }
}
