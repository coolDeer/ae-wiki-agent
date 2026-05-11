#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-start}"
PORT="${2:-9083}"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

mkdir -p logs .runtime

LOG_FILE="logs/web.log"
PID_FILE=".runtime/web.pid"
LEGACY_PID_FILE="logs/web.pid"

usage() {
  echo "Usage: scripts/web.sh [start|stop|restart|status] [port]"
}

is_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

pid_from_file() {
  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE" 2>/dev/null || true
  fi
}

stop_pid() {
  local pid
  pid="${1:-}"
  if is_alive "$pid"; then
    echo "Stopping web pid=$pid"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      if ! is_alive "$pid"; then break; fi
      sleep 0.2
    done
    if is_alive "$pid"; then
      echo "Web pid=$pid did not stop cleanly; sending SIGKILL"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
}

stop_web() {
  local pid legacy_pid
  pid="$(pid_from_file)"
  stop_pid "$pid"
  legacy_pid="$([ -f "$LEGACY_PID_FILE" ] && cat "$LEGACY_PID_FILE" 2>/dev/null || true)"
  if [ "$legacy_pid" != "$pid" ]; then
    stop_pid "$legacy_pid"
  fi
  rm -f "$PID_FILE"
  rm -f "$LEGACY_PID_FILE"
}

clear_port() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local stale
  stale="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
  if [ -z "$stale" ]; then
    return
  fi

  echo "Clearing stale process(es) on port $PORT: $stale"
  kill $stale 2>/dev/null || true
  for _ in $(seq 1 20); do
    stale="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
    if [ -z "$stale" ]; then
      return
    fi
    sleep 0.2
  done

  stale="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
  if [ -n "$stale" ]; then
    echo "Stale process(es) on port $PORT did not stop cleanly; sending SIGKILL: $stale"
    kill -KILL $stale 2>/dev/null || true
  fi
}

start_web() {
  local clear_stale="${1:-0}"
  local pid
  pid="$(pid_from_file)"
  if is_alive "$pid"; then
    echo "Web already running pid=$pid port=$PORT"
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    local stale
    stale="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
    if [ -n "$stale" ]; then
      if [ "$clear_stale" = "1" ]; then
        clear_port
      else
      echo "Port $PORT is already in use by pid(s): $stale"
      echo "Use scripts/web.sh restart $PORT to clear the stale web process, or free the port manually."
      exit 1
      fi
    fi
  fi

  nohup bun src/cli.ts web --port "$PORT" >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  disown
  echo "Started web pid=$(cat "$PID_FILE") port=$PORT log=$LOG_FILE"
}

status_web() {
  local pid
  pid="$(pid_from_file)"
  if is_alive "$pid"; then
    echo "web: running pid=$pid port=$PORT log=$LOG_FILE"
  else
    echo "web: stopped"
    [ -f "$PID_FILE" ] && rm -f "$PID_FILE"
  fi
}

case "$ACTION" in
  start)
    start_web
    ;;
  stop)
    stop_web
    ;;
  restart)
    stop_web
    start_web 1
    ;;
  status)
    status_web
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
