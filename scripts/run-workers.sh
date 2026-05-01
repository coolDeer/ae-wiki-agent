#!/usr/bin/env bash
# 起 N 个独立 supervisor，每个管 1 worker，crash 自带指数退避重启。
# 各 supervisor 用独立 pid file (.runtime/supervisor-{1..N}.pid)，互不干扰。
# Trap SIGTERM/SIGINT → 转发给 supervisor → supervisor 再 drain worker。
#
# 用法: scripts/run-workers.sh [N]   # N 默认 3
#
# 单独查某个：
#   bun src/cli.ts jobs:supervisor status --pid-file .runtime/supervisor-1.pid

set -euo pipefail

N="${1:-3}"
cd "$(dirname "$0")/.."

RUNTIME_DIR=".runtime"
mkdir -p "$RUNTIME_DIR"

pids=()
shutting_down=0

shutdown() {
  if [ "$shutting_down" = "1" ]; then return; fi
  shutting_down=1
  echo "[run-workers] forwarding signal to ${#pids[@]} supervisor(s)..."
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
}

trap shutdown SIGTERM SIGINT

for i in $(seq 1 "$N"); do
  pid_file="$RUNTIME_DIR/supervisor-$i.pid"
  bun src/cli.ts jobs:supervisor start --pid-file "$pid_file" &
  pid=$!
  pids+=("$pid")
  echo "[run-workers] started supervisor #$i pid=$pid pid_file=$pid_file"
done

exit_code=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    code=$?
    echo "[run-workers] supervisor pid=$pid exited with code=$code"
    if [ "$exit_code" = "0" ]; then exit_code=$code; fi
  fi
done

echo "[run-workers] all supervisors stopped (exit=$exit_code)"
exit "$exit_code"
