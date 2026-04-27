#!/usr/bin/env bash
# 反向操作：bootout + 删 plist。日志保留。
set -euo pipefail

LAUNCHD_DST="$HOME/Library/LaunchAgents"
UID_NUM=$(id -u)
DOMAIN="gui/$UID_NUM"

JOBS=(
  "com.ae-wiki.fetch-reports"
  "com.ae-wiki.worker"
)

for label in "${JOBS[@]}"; do
  dst="$LAUNCHD_DST/$label.plist"
  if launchctl print "$DOMAIN/$label" >/dev/null 2>&1; then
    echo "→ bootout $label"
    launchctl bootout "$DOMAIN" "$dst" 2>/dev/null || true
  fi
  if [[ -f "$dst" ]]; then
    rm -f "$dst"
    echo "→ removed $dst"
  fi
done

echo "✓ 卸载完成（日志保留在 ~/Library/Logs/ae-wiki/）"
