#!/usr/bin/env bash
# 日批喂任务（假设 worker 池已常驻，比如 jobs:supervisor 起的）。
# 不起 / 不关 worker，只负责 fetch → 排 ingest → 等 drain → daily-review/summarize。
#
# 用法: scripts/run-daily-batch.sh [ingest_cap]
#   ingest_cap   最多 ingest 多少篇 raw（默认 = 当前 pending 总数）
#
# cron 示例：
#   30 0 * * * cd /path/to/ae-wiki-agent && ./scripts/run-daily-batch.sh \
#              >> logs/run-daily.log 2>&1
#
# 超时：
#   ingest drain   默认 6h，超时也直接进入 daily-review

set -euo pipefail

INGEST_CAP_ARG="${1:-}"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

INGEST_DRAIN_TIMEOUT_SEC=$((6 * 3600))
TICK_INTERVAL_SEC=10

ts() { date +"%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*"; }

read_counts() { bun scripts/_ops-counts.ts 2>/dev/null; }
extract_int() {
  local json="$1" key="$2"
  echo "$json" | grep -o "\"$key\":[0-9]*" | grep -o "[0-9]*" | head -1
}

# ──────────────────────────────────────────────────────────
# 0. 预检：确认有 worker 在跑
# ──────────────────────────────────────────────────────────
ALIVE_WORKERS=$(ps -ef | grep -E "jobs:worker|jobs:supervisor" | grep -v grep | wc -l | tr -d ' ')
if [ "$ALIVE_WORKERS" = "0" ]; then
  log "⚠ 未检测到运行中的 worker / supervisor 进程"
  log "   排队的 ingest job 不会被消费！请先起 worker 池："
  log "     bun src/cli.ts jobs:supervisor start --pid-file .runtime/supervisor-1.pid &"
  log "   或用 scripts/run-daily.sh（自带启停 worker）替代本脚本"
  exit 1
fi
log "detected $ALIVE_WORKERS worker/supervisor process(es) alive"

# ──────────────────────────────────────────────────────────
# 1. fetch-reports
# ──────────────────────────────────────────────────────────
log "fetch-reports"
bun src/cli.ts fetch-reports

# ──────────────────────────────────────────────────────────
# 2. 排 ingest 任务
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
# 3. 等 ingest drain（不等下游 cascade）
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

  if [ "$RAW_PEND" = "0" ] && [ "$ING_TOTAL" = "0" ]; then
    EMPTY_TICKS=$((EMPTY_TICKS + 1))
    if [ "$EMPTY_TICKS" -ge 3 ]; then
      log "ingest drained ✓ (queue still has waiting=$Q_W active=$Q_A — 下游 cascade 后台跑)"
      break
    fi
  else
    EMPTY_TICKS=0
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
# 4. daily-review + daily-summarize
# ──────────────────────────────────────────────────────────
log "running daily-review (follow)"
bun src/cli.ts agent:run --skill ae-daily-review --follow \
  > "$LOG_DIR/daily-review-$(date +%Y%m%d).json" 2>&1 \
  || log "⚠ daily-review failed, see $LOG_DIR/daily-review-$(date +%Y%m%d).json"

log "running daily-summarize (follow)"
bun src/cli.ts agent:run --skill ae-daily-summarize --follow \
  > "$LOG_DIR/daily-summarize-$(date +%Y%m%d).json" 2>&1 \
  || log "⚠ daily-summarize failed, see $LOG_DIR/daily-summarize-$(date +%Y%m%d).json"

log "all done — worker 池继续运行（本脚本不管 worker 生命周期）"
