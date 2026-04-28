import {
  getAgentRun,
  getAgentTranscript,
  listAgentRuns,
  replayAgentRun,
  submitAgentRun,
} from "~/agents/runtime.ts";
import { Actor } from "~/core/audit.ts";
import { cancelJob, pauseJob, resumeJob } from "~/core/minions/queue.ts";

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, current) => (typeof current === "bigint" ? current.toString() : current),
    2
  );
}

async function follow(jobId: bigint, timeoutMs = 0): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now();
  while (true) {
    const job = await getAgentRun(jobId);
    if (!job) return null;
    if (
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "paused" ||
      job.status === "cancelled"
    ) {
      return job;
    }
    if (timeoutMs > 0 && Date.now() - startedAt > timeoutMs) return job;
    await Bun.sleep(1500);
  }
}

export async function runAgentCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(`Usage:
  ae-wiki agent:run --skill <skill> [--prompt "..."] [--model X] [--max-turns N] [--follow]
  ae-wiki agent:list [--status S] [--skill X] [--limit N]
  ae-wiki agent:show <job_id>
  ae-wiki agent:logs <job_id>
  ae-wiki agent:replay <job_id> [--follow]
  ae-wiki agent:pause <job_id> [--reason "..."]
  ae-wiki agent:resume <job_id>
  ae-wiki agent:cancel <job_id> [--reason "..."]`);
    return;
  }

  switch (sub) {
    case "run": {
      if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
        console.log(`Usage:
  ae-wiki agent:run --skill <skill> [--prompt "..."] [--model X] [--max-turns N] [--follow]`);
        return;
      }
      const skill = parseFlag(args, "--skill");
      if (!skill) {
        console.error("agent:run 需要 --skill <skill>");
        process.exit(1);
      }
      const maxTurns = parseFlag(args, "--max-turns");
      const result = await submitAgentRun({
        skill,
        prompt: parseFlag(args, "--prompt"),
        model: parseFlag(args, "--model"),
        maxTurns: maxTurns ? parseInt(maxTurns, 10) : undefined,
      });
      if (hasFlag(args, "--follow")) {
        const job = await follow(result.jobId);
        console.log(jsonStringify(job));
      } else {
        console.log(jsonStringify({ jobId: result.jobId.toString(), skill }));
      }
      return;
    }

    case "list": {
      if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
        console.log(`Usage:
  ae-wiki agent:list [--status S] [--skill X] [--limit N]`);
        return;
      }
      const limit = parseFlag(args, "--limit");
      const rows = await listAgentRuns({
        status: parseFlag(args, "--status") as
          | "waiting"
          | "active"
          | "paused"
          | "completed"
          | "failed"
          | "cancelled"
          | undefined,
        skill: parseFlag(args, "--skill"),
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      console.log(jsonStringify(rows));
      return;
    }

    case "show": {
      if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
        console.log(`Usage:
  ae-wiki agent:show <job_id>`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("agent:show 需要 job_id");
        process.exit(1);
      }
      const job = await getAgentRun(BigInt(jobIdStr));
      if (!job) {
        console.error(`agent job #${jobIdStr} 不存在`);
        process.exit(1);
      }
      console.log(jsonStringify(job));
      return;
    }

    case "logs": {
      if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
        console.log(`Usage:
  ae-wiki agent:logs <job_id>`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("agent:logs 需要 job_id");
        process.exit(1);
      }
      const transcript = await getAgentTranscript(BigInt(jobIdStr));
      console.log(jsonStringify(transcript));
      return;
    }

    case "replay": {
      if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
        console.log(`Usage:
  ae-wiki agent:replay <job_id> [--follow]`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("agent:replay 需要 job_id");
        process.exit(1);
      }
      const result = await replayAgentRun(BigInt(jobIdStr));
      if (hasFlag(args, "--follow")) {
        const job = await follow(result.jobId);
        console.log(jsonStringify(job));
      } else {
        console.log(jsonStringify({ jobId: result.jobId.toString(), replayOf: jobIdStr }));
      }
      return;
    }

    case "cancel": {
      if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
        console.log(`Usage:
  ae-wiki agent:cancel <job_id> [--reason "..."]`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("agent:cancel 需要 job_id");
        process.exit(1);
      }
      await cancelJob(BigInt(jobIdStr), Actor.agentRuntime, parseFlag(args, "--reason") ?? "cancelled by operator");
      console.log(jsonStringify({ ok: true, jobId: jobIdStr, status: "cancelled" }));
      return;
    }

    case "pause": {
      if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
        console.log(`Usage:
  ae-wiki agent:pause <job_id> [--reason "..."]`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("agent:pause 需要 job_id");
        process.exit(1);
      }
      await pauseJob(BigInt(jobIdStr), Actor.agentRuntime, parseFlag(args, "--reason") ?? "paused by operator");
      console.log(jsonStringify({ ok: true, jobId: jobIdStr, status: "paused" }));
      return;
    }

    case "resume": {
      if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
        console.log(`Usage:
  ae-wiki agent:resume <job_id>`);
        return;
      }
      const jobIdStr = args[1];
      if (!jobIdStr) {
        console.error("agent:resume 需要 job_id");
        process.exit(1);
      }
      await resumeJob(BigInt(jobIdStr), Actor.agentRuntime);
      console.log(jsonStringify({ ok: true, jobId: jobIdStr, status: "waiting" }));
      return;
    }

    default:
      console.error(`Unknown agent command: ${sub}`);
      process.exit(1);
  }
}
