#!/usr/bin/env bash
# 起 N 个 supervisor 常驻（每个独立 pid_file + log）。
# 跟 run-workers.sh 不同：本脚本是 fire-and-forget，跑完就退；supervisor 在后台
# 由 OS 持有，靠 jobs:supervisor stop 关停（不靠当前 shell 持有进程）。
#
# 用法: scripts/start-supervisors.sh [N]   # 默认 3
# 关停: scripts/stop-supervisors.sh

set -euo pipefail

N="${1:-3}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

mkdir -p logs .runtime

ts() { date +"%H:%M:%S"; }
log() { echo "[$(ts)] $*"; }

# ──────────────────────────────────────────────────────────
# 0. 预检：之前是不是有 supervisor 还在跑
# ──────────────────────────────────────────────────────────
ALIVE=0
for f in .runtime/supervisor-*.pid; do
  [ -f "$f" ] || continue
  pid=$(cat "$f" 2>/dev/null || echo "")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    log "⚠ supervisor still running: pid=$pid pid_file=$f"
    ALIVE=$((ALIVE + 1))
  fi
done

# 默认 pid 文件也要查
if [ -f .runtime/worker-supervisor.pid ]; then
  pid=$(cat .runtime/worker-supervisor.pid 2>/dev/null || echo "")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    log "⚠ default supervisor still running: pid=$pid (.runtime/worker-supervisor.pid)"
    ALIVE=$((ALIVE + 1))
  fi
fi

if [ "$ALIVE" -gt 0 ]; then
  log "ABORT: $ALIVE supervisor 还在运行"
  log "  → 先停掉再重启： scripts/stop-supervisors.sh"
  exit 1
fi

# ──────────────────────────────────────────────────────────
# 1. 起 N 个 supervisor（nohup + 重定向 + disown）
# ──────────────────────────────────────────────────────────
log "starting $N supervisor(s)..."
for i in $(seq 1 "$N"); do
  PID_FILE=".runtime/supervisor-$i.pid"
  LOG_FILE="logs/supervisor-$i.log"

  # 旧 log 翻篇（避免多轮启动累在一起）
  if [ -f "$LOG_FILE" ] && [ -s "$LOG_FILE" ]; then
    mv "$LOG_FILE" "$LOG_FILE.$(date +%Y%m%d-%H%M%S)"
  fi

  nohup bun src/cli.ts jobs:supervisor start --pid-file "$PID_FILE" \
    > "$LOG_FILE" 2>&1 &
  disown

  log "  #$i started, log=$LOG_FILE"
done

# ──────────────────────────────────────────────────────────
# 2. 验证（等 supervisor 写 pid_file + 起 child worker）
# ──────────────────────────────────────────────────────────
log "waiting 3s for supervisors to settle..."
sleep 3

OK=0
FAIL=0
for i in $(seq 1 "$N"); do
  PID_FILE=".runtime/supervisor-$i.pid"
  if [ ! -f "$PID_FILE" ]; then
    log "  ✗ #$i: pid_file 没生成（启动失败，看 logs/supervisor-$i.log）"
    FAIL=$((FAIL + 1))
    continue
  fi
  pid=$(cat "$PID_FILE")
  if ! kill -0 "$pid" 2>/dev/null; then
    log "  ✗ #$i: pid=$pid 已退出（看 logs/supervisor-$i.log）"
    FAIL=$((FAIL + 1))
    continue
  fi

  # 拉一下 status，看 worker 起来没
  STATUS_JSON=$(bun src/cli.ts jobs:supervisor status --pid-file "$PID_FILE" 2>/dev/null || echo "{}")
  WORKER_PID=$(echo "$STATUS_JSON" | grep -o '"workerPid":[^,]*' | head -1 | sed 's/"workerPid"://;s/null//' | tr -d ' ')
  if [ -n "$WORKER_PID" ] && [ "$WORKER_PID" != "null" ]; then
    log "  ✓ #$i: supervisor=$pid worker=$WORKER_PID"
    OK=$((OK + 1))
  else
    log "  ⚠ #$i: supervisor=$pid 起来了但 worker 还没启动（再等等）"
    OK=$((OK + 1))
  fi
done

echo ""
log "summary: ok=$OK fail=$FAIL / total=$N"
if [ "$FAIL" -gt 0 ]; then
  log "⚠ 有 supervisor 失败，看对应 log 排查"
  exit 1
fi

echo ""
log "查看日志: tail -f logs/supervisor-*.log"
log "看队列: bun scripts/_ops-counts.ts"
log "停止:   scripts/stop-supervisors.sh"
