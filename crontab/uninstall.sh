#!/usr/bin/env bash
#
# 恒市值助手 · Linux / Ubuntu 计划任务卸载
#
# 只删除 crontab/install.sh 写入的那一段（以 BEGIN/END 标记界定），**不动**你 crontab 里的其它条目。
# 若删完 crontab 里什么都不剩，则整体删除（crontab -r）。
#
# 用法：bash crontab/uninstall.sh
#
set -euo pipefail

MARK_BEGIN="### hdszf automation (managed by crontab/install.sh) >>>"
MARK_END="### <<< hdszf automation <<<"

say() { printf '%s\n' "$*"; }

CURRENT="$(crontab -l 2>/dev/null || true)"
if [ -z "$CURRENT" ]; then
  say "当前用户没有 crontab，无需卸载。"
  exit 0
fi
if ! printf '%s\n' "$CURRENT" | grep -qF "$MARK_BEGIN"; then
  say "crontab 里没有 hdszf 的条目（可能是手工写的，本脚本只删 install.sh 写入的那段）。"
  say "当前 crontab："
  printf '%s\n' "$CURRENT" | sed 's/^/  /'
  exit 0
fi

NEW="$(printf '%s\n' "$CURRENT" | awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
  index($0, b) > 0 { skip = 1; next }
  index($0, e) > 0 { skip = 0; next }
  !skip { print }
' | awk '{ l[n++] = $0 } END { while (n > 0 && l[n-1] ~ /^[[:space:]]*$/) n--; for (i = 0; i < n; i++) print l[i] }')"

if [ -z "$NEW" ]; then
  crontab -r
  say "✅ 已删除 hdszf 的 cron 条目；crontab 里已无其它内容，整体移除（crontab -r）。"
else
  TMP="$(mktemp)"
  trap 'rm -f "$TMP"' EXIT
  printf '%s\n' "$NEW" > "$TMP"
  crontab "$TMP"
  say "✅ 已删除 hdszf 的 cron 条目，其余条目保留："
  crontab -l | sed 's/^/  /'
fi

say ""
say "卸载后若还想继续更新数据，改用手动模式（频率见 crontab/README.md 第 3 节）："
say "  node crontab/run_job.js mtd --force        # 每交易日 18:00 后一次"
say "  node crontab/run_job.js finalize --force   # 每月 3 日后一次"
exit 0
