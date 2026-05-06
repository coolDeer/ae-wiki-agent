#!/bin/bash
set -e

PORT=${1:-9083}
LOG_FILE="logs/web.log"
PID_FILE="logs/web.pid"

cd "$(dirname "$0")/.."
mkdir -p logs

# Kill existing process
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping PID $OLD_PID..."
    kill "$OLD_PID"
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

# Also kill any stragglers on the port
STALE=$(lsof -ti tcp:$PORT 2>/dev/null || true)
if [ -n "$STALE" ]; then
  echo "Killing stale process on port $PORT..."
  kill $STALE 2>/dev/null || true
  sleep 1
fi

# Start
nohup bun src/cli.ts web --port "$PORT" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "Started PID $(cat $PID_FILE) on port $PORT, log: $LOG_FILE"
