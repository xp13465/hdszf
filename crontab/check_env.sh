#!/usr/bin/env bash
#
# 恒市值助手 · 环境体检（Linux 引导层）
#
# 装 cron 之前先跑这一遍：确认「这台机器到底能不能跑自动化」，并把缺的依赖一次装齐。
# 除 --fix / --fix-node 外**只读**（不写 crontab、不 commit、不 push）。
#
# 本脚本只做「node 之前」的检查与依赖安装，深层检查交给跨平台核心 crontab/check_env.js：
#   引导层（本文件） 系统 / apt 依赖 / cron 服务 / sudo / 时区 / 时钟同步
#   深度层（check_env.js） 运行时版本 / 仓库 / 工作区 / 推送凭据 / 网络 / 日志目录 / 磁盘 / 调度器条目
# 两部分会合成一份输出与一次汇总，退出码统一：0 = 无阻塞项，1 = 有阻塞项。
#
# 用法：
#   bash crontab/check_env.sh                # 完整体检（含联网）
#   bash crontab/check_env.sh --fix          # 缺依赖就用 apt 装上（git / python3 / cron / curl / openssh-client / ca-certificates）
#   bash crontab/check_env.sh --fix-node     # node 缺失或低于 18 时用 NodeSource 装 22.x（隐含 --fix）
#   bash crontab/check_env.sh --no-network   # 跳过联网检查（离线 / 网络受限）
#   bash crontab/check_env.sh --quiet        # 只打印 ⚠ 与 ✗
#   bash crontab/check_env.sh --print-node   # 只输出可用的 node 绝对路径（供 install.sh 取用）
#
# ⚠️ 检查项与 Windows 版 crontab/check_env.cmd 保持对齐（对照表见 README 第 11 节）—— 改一处请一起改。
#
set -uo pipefail   # 刻意不加 -e：这里的检查天生会「失败」，不能让脚本自己退出

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

FIX=0
FIX_NODE=0
NO_NET=0
QUIET=0
PRINT_NODE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --fix)        FIX=1; shift ;;
    --fix-node)   FIX=1; FIX_NODE=1; shift ;;
    --no-network) NO_NET=1; shift ;;
    --quiet|-q)   QUIET=1; shift ;;
    --print-node) PRINT_NODE=1; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：$1（--help 看用法）" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- 输出
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[1m'; C_D=$'\033[2m'; C_X=$'\033[0m'
else
  C_G=; C_Y=; C_R=; C_B=; C_D=; C_X=
fi

N_FAIL=0
N_WARN=0
FIX_PKGS=""

say()  { printf '%s\n' "$*"; return 0; }
grp()  { [ "$QUIET" = 1 ] && return 0; printf '\n%s%s%s\n' "$C_B" "$1" "$C_X"; return 0; }
ok()   { [ "$QUIET" = 1 ] && return 0; printf '  %s✅%s %-11s %s\n' "$C_G" "$C_X" "$1" "$2"
         [ -n "${3:-}" ] && printf '      %s%s%s\n' "$C_D" "$3" "$C_X"; return 0; }
warn() { N_WARN=$((N_WARN + 1)); printf '  %s⚠%s  %-11s %s\n' "$C_Y" "$C_X" "$1" "$2"
         [ -n "${3:-}" ] && printf '      → %s\n' "$3"; return 0; }
bad()  { N_FAIL=$((N_FAIL + 1)); printf '  %s✗%s  %-11s %s\n' "$C_R" "$C_X" "$1" "$2"
         [ -n "${3:-}" ] && printf '      → %s\n' "$3"; return 0; }
note() { [ "$QUIET" = 1 ] && return 0; printf '  %s·%s  %-11s %s\n' "$C_D" "$C_X" "$1" "$2"; return 0; }
need_pkg() { case " $FIX_PKGS " in *" $1 "*) ;; *) FIX_PKGS="$FIX_PKGS $1" ;; esac; }
has() { command -v "$1" >/dev/null 2>&1; }

find_node() {
  local c
  if has node; then command -v node; return 0; fi
  for c in /usr/local/bin/node /usr/bin/node /snap/bin/node "$HOME"/.nvm/versions/node/*/bin/node /opt/node*/bin/node; do
    [ -x "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

NODE_BIN="$(find_node || true)"

# ---------------------------------------------------------------- 只取 node 路径
if [ "$PRINT_NODE" = 1 ]; then
  [ -n "$NODE_BIN" ] || exit 1
  printf '%s\n' "$NODE_BIN"
  exit 0
fi

if [ "$QUIET" != 1 ]; then
  printf '%s恒市值助手 · 环境体检（Linux）%s\n' "$C_B" "$C_X"
  printf '%s仓库 %s%s\n' "$C_D" "$ROOT" "$C_X"
  [ "$FIX" = 1 ] && printf '%s模式：--fix（缺依赖会自动安装）%s\n' "$C_Y" "$C_X"
fi

# ================================================================ 系统
grp "系统"
SYS="$(uname -s 2>/dev/null || echo unknown)"
if [ "$SYS" = "Linux" ]; then
  OS_NAME="unknown"
  if [ -r /etc/os-release ]; then
    OS_NAME="$(. /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-${ID:-unknown}}")"
  fi
  ok "系统" "$OS_NAME · $(uname -r) · $(uname -m)"
else
  warn "系统" "当前是 $SYS —— 本脚本面向 Linux（cron）" "Windows 请用 crontab\\check_env.cmd；下面结果仅供逻辑自检"
fi
SUDO=""
if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then
  note "权限" "root（--fix 可直接安装）"
elif has sudo; then
  ok "权限" "有 sudo（--fix 可自动安装依赖）"
else
  warn "权限" "既非 root 也没有 sudo，--fix 装不了东西" "用 root 跑，或手工执行下面给命令"
fi
has sudo && SUDO="sudo"
[ "$(id -u 2>/dev/null || echo 1)" = "0" ] && SUDO=""

# ================================================================ 调度器
grp "调度器（cron）"
if has crontab; then
  ok "crontab" "$(command -v crontab)"
else
  bad "crontab" "找不到 crontab 命令，定时任务无法注册" "sudo apt-get install -y cron"
  need_pkg cron
fi

CRON_STATE="unknown"; CRON_UNIT=""
if has systemctl; then
  for u in cron crond; do
    st="$(systemctl is-active "$u" 2>/dev/null || true)"
    if [ "$st" = "active" ]; then CRON_STATE="active"; CRON_UNIT="$u"; break; fi
    if [ "$CRON_STATE" = "unknown" ] && [ -n "$st" ] && [ "$st" != "unknown" ]; then CRON_STATE="$st"; fi
  done
elif [ -x /etc/init.d/cron ]; then
  if /etc/init.d/cron status >/dev/null 2>&1; then CRON_STATE="active"; CRON_UNIT="init.d/cron"; else CRON_STATE="inactive"; fi
fi
case "$CRON_STATE" in
  active)  ok "cron 服务" "active（$CRON_UNIT）" ;;
  unknown) warn "cron 服务" "查不到状态（没有 systemd？容器环境？）" "容器里通常要与宿主机/进程管理器配合；自行确认 cron 在跑" ;;
  *)       bad  "cron 服务" "状态=$CRON_STATE，定时任务永远不会触发" "sudo systemctl enable --now cron"
           need_pkg cron ;;
esac

# ================================================================ 依赖
grp "依赖（可用 --fix 自动安装）"
NODE_MAJOR=""; NODE_OK=0
if [ -n "$NODE_BIN" ]; then
  NODE_VER="$("$NODE_BIN" -v 2>/dev/null || echo '?')"
  NODE_MAJOR="$(printf '%s' "$NODE_VER" | sed 's/^v//; s/\..*//')"
  case "$NODE_MAJOR" in
    ''|*[!0-9]*) NODE_OK=0 ;;
    *) [ "$NODE_MAJOR" -ge 18 ] && NODE_OK=1 || NODE_OK=0 ;;
  esac
fi
if [ "$NODE_OK" = 1 ]; then
  ok "node" "$NODE_VER ≥ 18 · $NODE_BIN"
elif [ -n "$NODE_BIN" ]; then
  bad "node" "$NODE_VER 过低（需要 18+）· $NODE_BIN" "时区归一要 16+，实时取数用全局 fetch 要 18+；见下方 --fix-node"
else
  bad "node" "找不到 node，一切都跑不起来" "装 22.x LTS（⚠️ 别用 apt 的 nodejs，Ubuntu 22.04 只给 12.x）：见下方 --fix-node"
fi
[ "$NODE_OK" = 1 ] || { warn "" "装法：curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"; }

if has git; then
  ok "git" "$(git --version 2>/dev/null)"
else
  bad "git" "找不到 git，无法 commit/push，自动化全白跑" "sudo apt-get install -y git"
  need_pkg git
fi
if has python3; then
  ok "python3" "$(python3 -V 2>&1) · 仅月度定稿（finalize）取数用"
else
  warn "python3" "找不到 python3，月度定稿取不到数（每交易日 MTD 不受影响）" "sudo apt-get install -y python3"
  need_pkg python3
fi
if has ssh && has ssh-keyscan; then
  ok "openssh" "$(ssh -V 2>&1)"
else
  warn "openssh" "缺少 ssh / ssh-keyscan（推送 remote 是 SSH 时必须）" "sudo apt-get install -y openssh-client"
  need_pkg openssh-client
fi
if has curl; then
  ok "curl" "$(curl --version 2>/dev/null | head -1 | cut -d' ' -f1-2)"
elif has wget; then
  note "curl" "只有 wget（能用；但装 node 的 NodeSource 方式需要 curl）"
  need_pkg curl
else
  warn "curl" "curl / wget 都没有" "sudo apt-get install -y curl"
  need_pkg curl
fi
if [ -r /etc/ssl/certs/ca-certificates.crt ]; then
  ok "CA 证书" "HTTPS 取数正常"
else
  warn "CA 证书" "找不到 ca-certificates，https 请求可能报证书错误" "sudo apt-get install -y ca-certificates"
  need_pkg ca-certificates
fi

# ================================================================ 时间与时区
grp "时间与时区（闸门按北京时间判断）"
OFF="$(date +%z 2>/dev/null || echo '?')"
TZNAME="?"
if has timedatectl; then TZNAME="$(timedatectl show -p Timezone --value 2>/dev/null || echo '?')"; fi
if [ "$TZNAME" = "?" ] && [ -r /etc/timezone ]; then TZNAME="$(cat /etc/timezone 2>/dev/null || echo '?')"; fi
note "系统时区" "$TZNAME · UTC$OFF"
if [ "$OFF" = "+0800" ]; then
  ok "偏移" "UTC+8，与北京时间一致"
else
  warn "偏移" "UTC$OFF ≠ UTC+0800（云服务器常见 UTC）" "不用改系统设置：run_job.js / status.js / 业务脚本都有 TZ-GUARD，会强制按 Asia/Shanghai 判断「18:00 后 / 每月 3 日后」"
fi
note "当前北京时间" "$(TZ=Asia/Shanghai date '+%F %T %a' 2>/dev/null || echo '?')"

NTP=""
if has timedatectl; then NTP="$(timedatectl show -p NTPSynchronized --value 2>/dev/null || true)"; fi
case "$NTP" in
  yes) ok "时钟同步" "NTP 已同步" ;;
  no)  warn "时钟同步" "NTP 未同步，时间漂移会让「18:00 后 / 每月 3 日后」判断出错" "sudo timedatectl set-ntp true" ;;
  *)   if has systemctl; then
         for u in systemd-timesyncd chronyd ntpd; do
           [ "$(systemctl is-active "$u" 2>/dev/null || true)" = "active" ] && { NTP="$u"; break; }
         done
       fi
       if [ -n "$NTP" ] && [ "$NTP" != "no" ]; then ok "时钟同步" "$NTP active"
       else note "时钟同步" "无法确认（没有 timedatectl），容器里通常与宿主机同步"; fi ;;
esac

# ================================================================ 安装依赖
if [ "$FIX" = 1 ]; then
  grp "安装缺失依赖（--fix）"
  if [ "$SYS" != "Linux" ]; then
    warn "跳过安装" "自动安装只面向 Debian/Ubuntu（当前 $SYS）" "Windows 请用 crontab\\check_env.cmd --fix（winget）"
  elif [ -n "$FIX_PKGS" ]; then
    say "  待安装：$FIX_PKGS"
    if [ -z "$SUDO" ] && [ "$(id -u 2>/dev/null || echo 1)" != "0" ]; then
      warn "无法安装" "没有 root/sudo" "手工执行：sudo apt-get install -y$FIX_PKGS"
    elif command -v apt-get >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      if $SUDO apt-get install -y $FIX_PKGS; then
        ok "apt 安装" "完成：$FIX_PKGS"
      else
        warn "apt 安装" "失败（软件源索引过期？）" "先 sudo apt-get update，再重跑本脚本 --fix"
      fi
    else
      warn "apt 不可用" "非 Debian/Ubuntu 系请用本机包管理器手工装：$FIX_PKGS"
    fi
  else
    note "无需安装" "apt 可装的依赖都齐了"
  fi

  # node 单独处理：apt 的 nodejs 在 Ubuntu 22.04 只有 12.x，必须走 NodeSource
  if [ "$NODE_OK" = 0 ] && [ "$SYS" = "Linux" ]; then
    if [ "$FIX_NODE" != 1 ]; then
      note "node 未自动装" "它不该走 apt。要自动装请加 --fix-node，或手工执行上面给的 NodeSource 命令"
    elif ! has curl; then
      warn "无法安装 node" "需要 curl" "先 sudo apt-get install -y curl，再重跑 --fix-node"
    elif [ -z "$SUDO" ] && [ "$(id -u 2>/dev/null || echo 1)" != "0" ]; then
      warn "无法安装 node" "需要 root/sudo"
    else
      say "  用 NodeSource 安装 Node 22.x（需要 sudo + 联网）…"
      if curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - && $SUDO apt-get install -y nodejs; then
        ok "NodeSource" "node 已安装 → 重新探测：$(find_node || echo '仍未找到')"
      else
        warn "NodeSource" "安装失败" "手工执行：curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
      fi
    fi
  fi
fi

# ================================================================ 交给深度层
if [ -z "$NODE_BIN" ]; then
  printf '\n%s' "$C_B"
  printf '──────────────────────────────────────────\n'
  printf '%s✗ 阻塞 %d 项 / ⚠ 警告 %d 项 → 先装 node，再跑本脚本%s\n' "$C_R" "$N_FAIL" "$N_WARN" "$C_X"
  printf '%s' "$C_X"
  say ""
  say "  装 node（22.x LTS，⚠️ 别用 apt 的 12.x）："
  say "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
  say "  或一键：bash $HERE/check_env.sh --fix --fix-node"
  exit 1
fi

DEEP_ARGS=(--no-runtime)     # 运行时段已由本文件报过，避免重复
[ "$NO_NET" = 1 ] && DEEP_ARGS+=(--no-network)
[ "$QUIET" = 1 ] && DEEP_ARGS+=(--quiet)

# Git Bash / MSYS 下 node.exe **不认** `/c/…` 形式（会当成 C:\c\…）→ 调用前转成原生路径。
# Linux 上 cygpath 不存在，这段不生效；加它只是为了让本机自检也能跑通。
HERE_NATIVE="$HERE"
case "$SYS" in
  MINGW*|MSYS*|CYGWIN*)
    if has cygpath; then
      NODE_BIN="$(cygpath -w "$NODE_BIN")"
      HERE_NATIVE="$(cygpath -w "$HERE")"
    fi ;;
esac

grp "深度检查（仓库 / 凭据 / 网络 / 目录）"
# 把引导层的阻塞项数带下去，让 check_env.js 出一份合并汇总（它自己会加上去）
HDSZF_ENV_UPSTREAM_FAIL="$N_FAIL" HDSZF_ENV_UPSTREAM_WARN="$N_WARN" \
  "$NODE_BIN" "$HERE_NATIVE/check_env.js" "${DEEP_ARGS[@]}"
RC=$?

if [ "$RC" != 0 ] && [ "$N_FAIL" = 0 ]; then
  say ""
  say "  提示：上面 ✗ 的项修好后重跑：bash $HERE/check_env.sh"
fi
exit "$RC"
