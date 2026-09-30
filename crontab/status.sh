#!/usr/bin/env bash
#
# 恒市值助手 · 健康检查（Linux / Ubuntu 便捷入口，等价于 node crontab/status.js）
#
# 用法：
#   bash crontab/status.sh                 # 完整报告（含 cron 注册情况）
#   bash crontab/status.sh --online        # 额外核对线上是否已部署最新版本
#   bash crontab/status.sh --tail=30       # 每个任务多打几行日志
#   bash crontab/status.sh --no-tasks      # 跳过 crontab 查询（手动模式 / 受限环境）
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="${NODE_BIN:-}"
if [ -z "$NODE" ]; then
  NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ]; then
  printf '✗ 找不到 node。用 NODE_BIN=/path/to/node bash crontab/status.sh 指定。\n' >&2
  exit 1
fi

exec "$NODE" "$HERE/status.js" "$@"
