import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

const DEFAULT_PID_FILE = resolve(process.cwd(), ".runtime/worker-supervisor.pid");
const BASE_RESTART_DELAY_MS = 1000;
const MAX_RESTART_DELAY_MS = 30000;
const STABLE_RUN_MS = 10000;

interface SupervisorState {
  pid: number | null;
  workerPid: number | null;
  running: boolean;
  status:
    | "starting"
    | "running"
    | "backoff"
    | "stopping"
    | "stopped";
  restartCount: number;
  consecutiveFailures: number;
  lastStartAt: string | null;
  lastExitAt: string | null;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  nextRestartDelayMs: number | null;
  updatedAt: string;
}

function ensureRuntimeDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  const raw = readFileSync(pidFile, "utf8").trim();
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function writePidFile(pidFile: string, pid: number): void {
  ensureRuntimeDir(pidFile);
  writeFileSync(pidFile, String(pid), "utf8");
}

function removePidFile(pidFile: string): void {
  if (existsSync(pidFile)) unlinkSync(pidFile);
}

function stateFileFor(pidFile: string): string {
  return resolve(dirname(pidFile), `${basename(pidFile)}.state.json`);
}

function defaultState(): SupervisorState {
  return {
    pid: null,
    workerPid: null,
    running: false,
    status: "stopped",
    restartCount: 0,
    consecutiveFailures: 0,
    lastStartAt: null,
    lastExitAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    nextRestartDelayMs: null,
    updatedAt: new Date().toISOString(),
  };
}

function readState(stateFile: string): SupervisorState {
  if (!existsSync(stateFile)) return defaultState();
  try {
    return {
      ...defaultState(),
      ...(JSON.parse(readFileSync(stateFile, "utf8")) as Partial<SupervisorState>),
    };
  } catch {
    return defaultState();
  }
}

function writeState(stateFile: string, patch: Partial<SupervisorState>): SupervisorState {
  ensureRuntimeDir(stateFile);
  const next = {
    ...readState(stateFile),
    ...patch,
    updatedAt: new Date().toISOString(),
  } satisfies SupervisorState;
  writeFileSync(stateFile, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function cleanupSupervisorFiles(pidFile: string): void {
  const stateFile = stateFileFor(pidFile);
  removePidFile(pidFile);
  if (existsSync(stateFile)) rmSync(stateFile, { force: true });
}

function adoptOrCleanupStaleState(pidFile: string): number | null {
  const pid = readPidFile(pidFile);
  if (!pid) return null;
  if (isProcessAlive(pid)) return pid;
  cleanupSupervisorFiles(pidFile);
  return null;
}

function spawnWorker(): ChildProcess {
  const cliPath = resolve(process.cwd(), "src/cli.ts");
  return spawn(process.execPath, [cliPath, "jobs:worker"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
}

function computeRestartDelay(consecutiveFailures: number): number {
  return Math.min(
    MAX_RESTART_DELAY_MS,
    BASE_RESTART_DELAY_MS * 2 ** Math.max(0, Math.min(consecutiveFailures, 5))
  );
}

export async function startSupervisor(opts: {
  detach?: boolean;
  pidFile?: string;
} = {}): Promise<void> {
  const pidFile = opts.pidFile ?? DEFAULT_PID_FILE;
  const stateFile = stateFileFor(pidFile);
  const current = adoptOrCleanupStaleState(pidFile);
  if (current) {
    throw new Error(`supervisor already running (pid=${current})`);
  }

  if (opts.detach) {
    const cliPath = resolve(process.cwd(), "src/cli.ts");
    const detached = spawn(process.execPath, [cliPath, "jobs:supervisor", "start"], {
      cwd: process.cwd(),
      stdio: "ignore",
      env: process.env,
      detached: true,
    });
    if (!detached.pid) throw new Error("failed to detach supervisor");
    detached.unref();
    console.log(JSON.stringify({ event: "started", pid: detached.pid, pidFile, stateFile }, null, 2));
    return;
  }

  let stopping = false;
  let child: ChildProcess | null = null;

  const stop = () => {
    stopping = true;
    writeState(stateFile, {
      pid: process.pid,
      workerPid: child?.pid ?? null,
      running: false,
      status: "stopping",
      nextRestartDelayMs: null,
    });
    if (child && child.pid) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  };

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  writePidFile(pidFile, process.pid);
  writeState(stateFile, {
    pid: process.pid,
    workerPid: null,
    running: true,
    status: "starting",
    restartCount: 0,
    consecutiveFailures: 0,
    lastStartAt: null,
    lastExitAt: null,
    lastExitCode: null,
    lastExitSignal: null,
    nextRestartDelayMs: null,
  });

  let restartCount = 0;
  let consecutiveFailures = 0;

  try {
    while (!stopping) {
      const startedAt = Date.now();
      child = spawnWorker();
      restartCount += 1;

      writeState(stateFile, {
        pid: process.pid,
        workerPid: child.pid ?? null,
        running: true,
        status: "running",
        restartCount,
        consecutiveFailures,
        lastStartAt: new Date(startedAt).toISOString(),
        nextRestartDelayMs: null,
      });

      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolveExit) => {
          child!.once("exit", (code, signal) => resolveExit({ code, signal }));
        }
      );

      const runtimeMs = Date.now() - startedAt;
      if (stopping) break;

      consecutiveFailures = runtimeMs < STABLE_RUN_MS ? consecutiveFailures + 1 : 0;
      const delayMs = computeRestartDelay(consecutiveFailures);

      writeState(stateFile, {
        pid: process.pid,
        workerPid: null,
        running: true,
        status: "backoff",
        restartCount,
        consecutiveFailures,
        lastExitAt: new Date().toISOString(),
        lastExitCode: exit.code,
        lastExitSignal: exit.signal,
        nextRestartDelayMs: delayMs,
      });

      console.error(
        `[supervisor] worker exited (code=${exit.code ?? "null"}, signal=${exit.signal ?? "null"}), restart in ${delayMs}ms`
      );
      await Bun.sleep(delayMs);
    }
  } finally {
    writeState(stateFile, {
      pid: null,
      workerPid: null,
      running: false,
      status: "stopped",
      nextRestartDelayMs: null,
    });
    removePidFile(pidFile);
  }
}

export function supervisorStatus(pidFile?: string): {
  pidFile: string;
  stateFile: string;
  running: boolean;
  pid: number | null;
  workerPid: number | null;
  status: SupervisorState["status"];
  restartCount: number;
  consecutiveFailures: number;
  lastStartAt: string | null;
  lastExitAt: string | null;
  lastExitCode: number | null;
  lastExitSignal: string | null;
  nextRestartDelayMs: number | null;
} {
  const resolved = pidFile ?? DEFAULT_PID_FILE;
  const stateFile = stateFileFor(resolved);
  const pid = adoptOrCleanupStaleState(resolved);
  const state = readState(stateFile);
  const running = pid != null && isProcessAlive(pid);

  return {
    pidFile: resolved,
    stateFile,
    running,
    pid,
    workerPid: running && state.workerPid && isProcessAlive(state.workerPid) ? state.workerPid : null,
    status: running ? state.status : "stopped",
    restartCount: state.restartCount,
    consecutiveFailures: state.consecutiveFailures,
    lastStartAt: state.lastStartAt,
    lastExitAt: state.lastExitAt,
    lastExitCode: state.lastExitCode,
    lastExitSignal: state.lastExitSignal,
    nextRestartDelayMs: state.nextRestartDelayMs,
  };
}

export function stopSupervisor(pidFile?: string): {
  pidFile: string;
  stateFile: string;
  stopped: boolean;
  pid: number | null;
} {
  const resolved = pidFile ?? DEFAULT_PID_FILE;
  const stateFile = stateFileFor(resolved);
  const pid = readPidFile(resolved);
  if (!pid) {
    cleanupSupervisorFiles(resolved);
    return { pidFile: resolved, stateFile, stopped: false, pid: null };
  }

  writeState(stateFile, {
    pid,
    running: false,
    status: "stopping",
    nextRestartDelayMs: null,
  });

  try {
    process.kill(pid, "SIGTERM");
  } catch {}

  return { pidFile: resolved, stateFile, stopped: true, pid };
}
