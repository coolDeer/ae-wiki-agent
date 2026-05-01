#!/usr/bin/env bash
# 全自动日循环：起 N worker → fetch-reports → 排 ingest → 等队列 drain
# → daily-review → daily-summarize → 关 worker。
#
# 用法: scripts/run-daily.sh [worker_count] [ingest_cap]
#   worker_count  并发 worker 数（默认 3）
#   ingest_cap    最多 ingest 多少篇 raw（默认 = 当前 pending 总数）
#
# 状态文件：
#   logs/workers.log         worker 池 stdout
#   logs/run-daily.log       本脚本 stdout（如果你 nohup 包了）

set -euo pipefail

WORKER_COUNT="${1:-3}"
INGEST_CAP_ARG="${2:-}"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

ts() { date +"%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*"; }

# ──────────────────────────────────────────────────────────
# 状态查询 helper
# ──────────────────────────────────────────────────────────
read_counts() {
  bun scripts/_ops-counts.ts 2>/dev/null
}
extract_int() {
  # $1 = JSON 字符串, $2 = key
  local json="$1" key="$2"
  echo "$json" | grep -o "\"$key\":[0-9]*" | grep -o "[0-9]*" | head -1
}

# ──────────────────────────────────────────────────────────
# 1. 起 worker 池
# ──────────────────────────────────────────────────────────
log "starting $WORKER_COUNT worker(s)"
bash "$PROJECT_DIR/scripts/run-workers.sh" "$WORKER_COUNT" \
  > "$LOG_DIR/workers.log" 2>&1 &
WORKER_PGID=$!
log "worker pool pgid=$WORKER_PGID, log=$LOG_DIR/workers.log"

cleanup() {
  log "shutting down worker pool (pgid=$WORKER_PGID)"
  kill -TERM "$WORKER_PGID" 2>/dev/null || true
  # 给 worker 60s 把手上 job 跑完
  for _ in $(seq 1 60); do
    if ! kill -0 "$WORKER_PGID" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$WORKER_PGID" 2>/dev/null; then
    log "worker pool still alive after 60s drain, force killing"
    kill -KILL "$WORKER_PGID" 2>/dev/null || true
  fi
  log "done"
}
trap cleanup EXIT INT TERM

# 等 worker 起来（开始 poll 队列）
sleep 3

# ──────────────────────────────────────────────────────────
# 2. fetch-reports
# ──────────────────────────────────────────────────────────
log "fetch-reports"
bun src/cli.ts fetch-reports

# ──────────────────────────────────────────────────────────
# 3. 排 ingest 任务
# ──────────────────────────────────────────────────────────
COUNTS=$(read_counts)
PENDING=$(extract_int "$COUNTS" rawPending)
log "raw_files pending: $PENDING"

if [ -n "$INGEST_CAP_ARG" ]; then
  if [ "$PENDING" -gt "$INGEST_CAP_ARG" ]; then
    INGEST_N="$INGEST_CAP_ARG"
    log "ingest_cap=$INGEST_CAP_ARG hit, only enqueueing $INGEST_N (剩 $((PENDING - INGEST_N)) 篇下次跑)"
  else
    INGEST_N="$PENDING"
  fi
else
  INGEST_N="$PENDING"
fi

if [ "$INGEST_N" -gt 0 ]; then
  log "enqueueing $INGEST_N ingest agent_run job(s)"
  for i in $(seq 1 "$INGEST_N"); do
    bun src/cli.ts agent:run --skill ae-research-ingest > /dev/null
  done
  log "✓ enqueued"
else
  log "no pending raw, skipping ingest"
fi

# ──────────────────────────────────────────────────────────
# 4. 等队列 drain（含下游 embed/signals/enrich）
# ──────────────────────────────────────────────────────────
log "waiting for queue to drain..."
EMPTY_TICKS=0
TICK=0
while true; do
  TICK=$((TICK + 1))
  COUNTS=$(read_counts)
  WAITING=$(extract_int "$COUNTS" queueWaiting)
  ACTIVE=$(extract_int "$COUNTS" queueActive)
  TOTAL=$((WAITING + ACTIVE))

  if [ "$TOTAL" = "0" ]; then
    EMPTY_TICKS=$((EMPTY_TICKS + 1))
    if [ "$EMPTY_TICKS" -ge 3 ]; then
      log "queue empty for 3 consecutive ticks ✓"
      break
    fi
  else
    EMPTY_TICKS=0
    if [ $((TICK % 6)) = 1 ]; then
      log "queue: waiting=$WAITING active=$ACTIVE (tick=$TICK)"
    fi
  fi

  # 兜底：60min 没 drain 也跳出，避免无限挂
  if [ "$TICK" -gt 360 ]; then
    log "⚠ queue still busy after 60min, moving on (waiting=$WAITING active=$ACTIVE)"
    break
  fi

  sleep 10
done

# ──────────────────────────────────────────────────────────
# 5. daily-review + daily-summarize（也走 agent_run 队列，worker 跑）
# ──────────────────────────────────────────────────────────
log "running daily-review (follow)"
bun src/cli.ts agent:run --skill ae-daily-review --follow > "$LOG_DIR/daily-review-$(date +%Y%m%d).json" || \
  log "⚠ daily-review failed, see $LOG_DIR/daily-review-$(date +%Y%m%d).json"

log "running daily-summarize (follow)"
bun src/cli.ts agent:run --skill ae-daily-summarize --follow > "$LOG_DIR/daily-summarize-$(date +%Y%m%d).json" || \
  log "⚠ daily-summarize failed, see $LOG_DIR/daily-summarize-$(date +%Y%m%d).json"

log "all done — cleanup will drain workers"
