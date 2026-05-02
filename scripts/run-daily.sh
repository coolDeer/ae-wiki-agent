#!/usr/bin/env bash
# 全自动日循环：起 N worker → fetch-reports → 排 ingest → 等 ingest drain
# → daily-review → daily-summarize → 关 worker（可选）。
#
# 关键设计：drain 标准 = ingest 队列空（不等下游 embed/signals/enrich
# cascade）。daily-review/summarize 只读 pages 表，下游让 worker 后台慢慢跑。
#
# 用法: scripts/run-daily.sh [worker_count] [ingest_cap] [--keep-workers]
#   worker_count    并发 worker 数（默认 3）
#   ingest_cap      最多 ingest 多少篇 raw（默认 = 当前 pending 总数）
#   --keep-workers  daily-review/summarize 后不关 worker（让下游 cascade
#                   继续跑；用户自己 jobs:supervisor stop / kill）
#
# 状态文件：
#   logs/workers.log         worker 池 stdout
#   logs/run-daily.log       本脚本 stdout（如果你 nohup 包了）
#
# 超时：
#   ingest drain     默认 6h，超时直接进入 daily-review
#   cleanup drain    默认 600s（agent_run 单 turn 可能跑分钟级，宽松些）

set -euo pipefail

WORKER_COUNT="${1:-3}"
INGEST_CAP_ARG="${2:-}"
KEEP_WORKERS=0
for arg in "$@"; do
  case "$arg" in
    --keep-workers) KEEP_WORKERS=1 ;;
  esac
done

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

# 兜底超时（秒）—— ingest drain
INGEST_DRAIN_TIMEOUT_SEC=$((6 * 3600))
# cleanup 给 worker drain 的最大时间
CLEANUP_DRAIN_TIMEOUT_SEC=600
# 轮询周期
TICK_INTERVAL_SEC=10

ts() { date +"%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*"; }

# ──────────────────────────────────────────────────────────
# 状态查询 helper
# ──────────────────────────────────────────────────────────
read_counts() {
  bun scripts/_ops-counts.ts 2>/dev/null
}
extract_int() {
  local json="$1" key="$2"
  echo "$json" | grep -o "\"$key\":[0-9]*" | grep -o "[0-9]*" | head -1
}

# ──────────────────────────────────────────────────────────
# 1. 起 worker 池
# ──────────────────────────────────────────────────────────
log "starting $WORKER_COUNT worker(s) (keep_workers=$KEEP_WORKERS)"
bash "$PROJECT_DIR/scripts/run-workers.sh" "$WORKER_COUNT" \
  > "$LOG_DIR/workers.log" 2>&1 &
WORKER_PID=$!
log "worker pool pid=$WORKER_PID, log=$LOG_DIR/workers.log"

cleanup() {
  if [ "$KEEP_WORKERS" = "1" ]; then
    log "--keep-workers set, leaving worker pool running (pid=$WORKER_PID)"
    log "stop manually: bun src/cli.ts jobs:supervisor stop --pid-file .runtime/supervisor-N.pid"
    return
  fi
  log "shutting down worker pool (pid=$WORKER_PID, drain timeout=${CLEANUP_DRAIN_TIMEOUT_SEC}s)"
  kill -TERM "$WORKER_PID" 2>/dev/null || true
  for _ in $(seq 1 "$CLEANUP_DRAIN_TIMEOUT_SEC"); do
    if ! kill -0 "$WORKER_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$WORKER_PID" 2>/dev/null; then
    log "⚠ worker pool still alive after ${CLEANUP_DRAIN_TIMEOUT_SEC}s — force killing (active jobs may end up zombie)"
    kill -KILL "$WORKER_PID" 2>/dev/null || true
  fi
  log "done"
}
trap cleanup EXIT INT TERM

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

if [ -n "$INGEST_CAP_ARG" ] && [[ "$INGEST_CAP_ARG" =~ ^[0-9]+$ ]]; then
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
  log "no pending raw, skipping ingest enqueue"
fi

# ──────────────────────────────────────────────────────────
# 4. 等 ingest drain（不等下游 cascade）
# ──────────────────────────────────────────────────────────
log "waiting for ingest drain (rawPending=0 && ingestActive+Waiting=0)..."
EMPTY_TICKS=0
TICK=0
MAX_TICKS=$((INGEST_DRAIN_TIMEOUT_SEC / TICK_INTERVAL_SEC))
LAST_RAW_PENDING=-1
LAST_INGEST_TOTAL=-1

while true; do
  TICK=$((TICK + 1))
  COUNTS=$(read_counts)
  RAW_PEND=$(extract_int "$COUNTS" rawPending)
  ING_W=$(extract_int "$COUNTS" ingestWaiting)
  ING_A=$(extract_int "$COUNTS" ingestActive)
  Q_W=$(extract_int "$COUNTS" queueWaiting)
  Q_A=$(extract_int "$COUNTS" queueActive)
  ING_TOTAL=$((ING_W + ING_A))

  # drain 判定：本批 ingest 全做完 + 没有遗留 pending raw
  if [ "$RAW_PEND" = "0" ] && [ "$ING_TOTAL" = "0" ]; then
    EMPTY_TICKS=$((EMPTY_TICKS + 1))
    if [ "$EMPTY_TICKS" -ge 3 ]; then
      log "ingest drained ✓ (queue still has waiting=$Q_W active=$Q_A — 下游 cascade 后台跑)"
      break
    fi
  else
    EMPTY_TICKS=0
    # 有变化或每分钟才打一次进度，避免刷屏
    if [ "$RAW_PEND" != "$LAST_RAW_PENDING" ] || [ "$ING_TOTAL" != "$LAST_INGEST_TOTAL" ] || [ $((TICK % 6)) = 1 ]; then
      log "ingest: rawPending=$RAW_PEND ingest=(w=$ING_W,a=$ING_A) | queue=(w=$Q_W,a=$Q_A) tick=$TICK"
      LAST_RAW_PENDING="$RAW_PEND"
      LAST_INGEST_TOTAL="$ING_TOTAL"
    fi
  fi

  if [ "$TICK" -gt "$MAX_TICKS" ]; then
    log "⚠ ingest drain timed out after $((INGEST_DRAIN_TIMEOUT_SEC / 3600))h (rawPending=$RAW_PEND ingest=(w=$ING_W,a=$ING_A))"
    log "  proceeding to daily-review anyway; worker pool 继续跑"
    break
  fi

  sleep "$TICK_INTERVAL_SEC"
done

# ──────────────────────────────────────────────────────────
# 5. daily-review + daily-summarize（也走 agent_run 队列，worker 跑）
# ──────────────────────────────────────────────────────────
log "running daily-review (follow)"
bun src/cli.ts agent:run --skill ae-daily-review --follow \
  > "$LOG_DIR/daily-review-$(date +%Y%m%d).json" 2>&1 \
  || log "⚠ daily-review failed, see $LOG_DIR/daily-review-$(date +%Y%m%d).json"

log "running daily-summarize (follow)"
bun src/cli.ts agent:run --skill ae-daily-summarize --follow \
  > "$LOG_DIR/daily-summarize-$(date +%Y%m%d).json" 2>&1 \
  || log "⚠ daily-summarize failed, see $LOG_DIR/daily-summarize-$(date +%Y%m%d).json"

log "all done — cleanup 阶段处理 worker"
