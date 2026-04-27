#!/usr/bin/env bash
# launchd 入口：跑 minion-worker daemon
# launchd 配 KeepAlive=true 后，进程退出会自动重启
set -euo pipefail

export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] worker starting"
exec bun src/cli.ts worker
