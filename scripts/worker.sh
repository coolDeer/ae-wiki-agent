#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
COUNT="${2:-3}"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

mkdir -p logs .runtime

usage() {
  echo "Usage: scripts/worker.sh [start|stop|restart|status] [count]"
}

is_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

supervisor_pid_files() {
  find .runtime -maxdepth 1 \( -name 'supervisor-*.pid' -o -name 'worker-supervisor.pid' \) -type f 2>/dev/null | sort
}

start_workers() {
  local alive=0
  while IFS= read -r pid_file; do
    [ -n "$pid_file" ] || continue
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if is_alive "$pid"; then
      echo "Supervisor already running pid=$pid pid_file=$pid_file"
      alive=$((alive + 1))
    fi
  done < <(supervisor_pid_files)

  if [ "$alive" -gt 0 ]; then
    echo "Abort: $alive supervisor(s) already running. Use scripts/worker.sh status or scripts/worker.sh restart $COUNT."
    exit 1
  fi

  echo "Starting $COUNT worker supervisor(s)"
  for i in $(seq 1 "$COUNT"); do
    local pid_file=".runtime/supervisor-$i.pid"
    local log_file="logs/supervisor-$i.log"

    if [ -f "$log_file" ] && [ -s "$log_file" ]; then
      mv "$log_file" "$log_file.$(date +%Y%m%d-%H%M%S)"
    fi

    nohup bun src/cli.ts jobs:supervisor start --pid-file "$pid_file" > "$log_file" 2>&1 &
    disown
    echo "  #$i supervisor starting pid_file=$pid_file log=$log_file"
  done

  sleep 3
  status_workers
}

stop_workers() {
  local found=0
  while IFS= read -r pid_file; do
    [ -n "$pid_file" ] || continue
    found=$((found + 1))
    echo "Stopping supervisor pid_file=$pid_file"
    bun src/cli.ts jobs:supervisor stop --pid-file "$pid_file" >/dev/null 2>&1 || true
  done < <(supervisor_pid_files)

  if [ "$found" -eq 0 ]; then
    echo "No supervisor pid files found"
    return
  fi

  for _ in $(seq 1 30); do
    local alive=0
    while IFS= read -r pid_file; do
      [ -n "$pid_file" ] || continue
      local pid
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if is_alive "$pid"; then
        alive=$((alive + 1))
      fi
    done < <(supervisor_pid_files)
    if [ "$alive" -eq 0 ]; then break; fi
    sleep 1
  done

  status_workers
}

status_workers() {
  local found=0
  while IFS= read -r pid_file; do
    [ -n "$pid_file" ] || continue
    found=$((found + 1))
    echo "== $pid_file =="
    bun src/cli.ts jobs:supervisor status --pid-file "$pid_file" || true
  done < <(supervisor_pid_files)

  if [ "$found" -eq 0 ]; then
    echo "worker: stopped"
  fi
}

case "$ACTION" in
  start)
    start_workers
    ;;
  stop)
    stop_workers
    ;;
  restart)
    stop_workers
    start_workers
    ;;
  status)
    status_workers
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
