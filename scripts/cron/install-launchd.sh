#!/usr/bin/env bash
# 把 launchd plists 安装进 ~/Library/LaunchAgents 并启动
# 已安装时再跑一次 = 升级（重新替换路径占位符 + 重 load）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAUNCHD_SRC="$(cd "$PROJECT_DIR/infra/launchd" && pwd)"
LAUNCHD_DST="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/ae-wiki"

mkdir -p "$LAUNCHD_DST" "$LOG_DIR"

UID_NUM=$(id -u)
DOMAIN="gui/$UID_NUM"

JOBS=(
  "com.ae-wiki.fetch-reports"
  "com.ae-wiki.worker"
)

for label in "${JOBS[@]}"; do
  src="$LAUNCHD_SRC/$label.plist"
  dst="$LAUNCHD_DST/$label.plist"

  if [[ ! -f "$src" ]]; then
    echo "✗ 未找到 $src，跳过"
    continue
  fi

  # 卸载旧的（如果在跑）
  if launchctl print "$DOMAIN/$label" >/dev/null 2>&1; then
    echo "→ bootout 旧版 $label"
    launchctl bootout "$DOMAIN" "$dst" 2>/dev/null || true
  fi

  # 替换占位符 → dst
  sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" \
      -e "s|__HOME__|$HOME|g" \
      "$src" > "$dst"

  echo "→ bootstrap $label"
  launchctl bootstrap "$DOMAIN" "$dst"
done

echo ""
echo "✓ 安装完成。日志：$LOG_DIR/"
echo ""
echo "查看：  launchctl print $DOMAIN/com.ae-wiki.fetch-reports"
echo "        launchctl print $DOMAIN/com.ae-wiki.worker"
echo ""
echo "立刻跑一次 fetch-reports（测试）："
echo "        launchctl kickstart -p $DOMAIN/com.ae-wiki.fetch-reports"
echo ""
echo "查看日志："
echo "        tail -f $LOG_DIR/fetch-reports.log"
echo "        tail -f $LOG_DIR/worker.log"
