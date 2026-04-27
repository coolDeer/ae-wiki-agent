#!/usr/bin/env bash
# launchd 入口：跑 fetch-reports，输出 stdout/stderr 给 launchd 重定向到 log 文件
# 设计为 idempotent：fetch-reports 自己有 research_id 去重，重复跑不会重复写
set -euo pipefail

# 让 bun 在 launchd 环境下能找到（launchd 不继承 shell PATH）
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"

# 项目根目录（脚本相对路径）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

# 限流：每次最多拉 50 篇（避免 mongo 一次拉太多）
LIMIT="${FETCH_LIMIT:-50}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] fetch-reports --limit $LIMIT"
exec bun src/cli.ts fetch-reports --limit "$LIMIT"
