#!/usr/bin/env bash
# 优雅停掉所有 supervisor（含默认 pid_file 那个）。
# worker 会 drain 完手上当前 job 才退；不强杀。

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

ts() { date +"%H:%M:%S"; }
log() { echo "[$(ts)] $*"; }

# 找出所有 pid_file（包括默认那个）
pid_files=()
for f in .runtime/worker-supervisor.pid .runtime/supervisor-*.pid; do
  [ -f "$f" ] && pid_files+=("$f")
done

if [ "${#pid_files[@]}" = "0" ]; then
  log "没找到任何 supervisor pid_file，看下是不是没起 / 已经停了"
  ps -ef | grep -E "jobs:supervisor|jobs:worker" | grep -v grep || log "ps 也没 supervisor 进程，干净"
  exit 0
fi

log "found ${#pid_files[@]} supervisor pid_file(s)"

# 1. 给每个发 stop（写 stopping 状态 + SIGTERM）
for f in "${pid_files[@]}"; do
  log "  stopping $f..."
  bun src/cli.ts jobs:supervisor stop --pid-file "$f" \
    | grep -E '"pid"|"stopped"' || true
done

# 2. 等 supervisor + worker 退出
log "waiting up to 600s for graceful drain..."
for sec in $(seq 1 600); do
  ALIVE=0
  for f in "${pid_files[@]}"; do
    [ -f "$f" ] || continue
    pid=$(cat "$f" 2>/dev/null || echo "")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      ALIVE=$((ALIVE + 1))
    fi
  done
  if [ "$ALIVE" = "0" ]; then
    log "all supervisors stopped after ${sec}s"
    break
  fi
  if [ $((sec % 30)) = 0 ]; then
    log "  $ALIVE supervisor(s) 还在 drain... (${sec}s)"
  fi
  sleep 1
done

# 3. 还有残留进程？
LEFTOVER=$(ps -ef | grep -E "jobs:supervisor|jobs:worker" | grep -v grep | wc -l | tr -d ' ')
if [ "$LEFTOVER" != "0" ]; then
  log "⚠ 仍有 $LEFTOVER 个 supervisor/worker 进程，需要手动处理："
  ps -ef | grep -E "jobs:supervisor|jobs:worker" | grep -v grep
  log "  强杀: pkill -KILL -f 'jobs:(supervisor|worker)'"
  exit 1
fi

log "✓ all clean"
