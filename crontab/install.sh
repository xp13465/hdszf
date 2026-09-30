#!/usr/bin/env bash
#
# 恒市值助手 · Linux / Ubuntu 计划任务一键安装（零 AI 依赖，纯脚本自动化）
#
# 做的事：把两条「每小时唤醒」的 cron 条目写进**当前用户**的 crontab。
#         运行器 crontab/run_job.js 自带闸门（当天 / 当月成功一次即停），
#         所以高频唤醒不会重复提交、重复部署，还能自动补跑（错过就下一小时再来）。
#
# 用法：
#   bash crontab/install.sh                 # 安装（自动探测 node 绝对路径）
#   bash crontab/install.sh --node /usr/bin/node
#   bash crontab/install.sh --dry-run       # 只打印将要写入的 crontab，不真的写
#   bash crontab/install.sh --show          # 打印当前 crontab 后退出
#   bash crontab/install.sh --hours 18-23   # 只在某几个钟点唤醒（服务器已是北京时间时可选）
#
# 幂等：重复执行只会覆盖自己那段（以 BEGIN/END 标记界定），不会动你 crontab 里的其它条目。
# 不需要 root。cron 服务本身要开着：sudo systemctl enable --now cron
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
RUNNER="$ROOT/crontab/run_job.js"

MARK_BEGIN="### hdszf automation (managed by crontab/install.sh) >>>"
MARK_END="### <<< hdszf automation <<<"

MTD_MIN=7      # 每小时的第 7 分钟跑 mtd
FIN_MIN=37     # 每小时的第 37 分钟跑 finalize（错开，减少同一时刻抢锁）
HOURS="*"      # 默认全天每小时都唤醒，由 run_job.js 的闸门决定"现在该不该跑"（时区安全，见下）

NODE_BIN=""
DRY_RUN=0
SHOW_ONLY=0

# ---------------------------------------------------------------- 参数
while [ $# -gt 0 ]; do
  case "$1" in
    --node)    NODE_BIN="${2:-}"; shift 2 ;;
    --node=*)  NODE_BIN="${1#*=}"; shift ;;
    --hours)   HOURS="${2:-}"; shift 2 ;;
    --hours=*) HOURS="${1#*=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --show)    SHOW_ONLY=1; shift ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：$1（--help 看用法）" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
warn() { printf '⚠  %s\n' "$*"; }
die()  { printf '✗  %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 0. 只看现状
if [ "$SHOW_ONLY" = "1" ]; then
  say "当前 crontab（crontab -l）："
  crontab -l 2>/dev/null || say "（当前用户没有 crontab）"
  exit 0
fi

# ---------------------------------------------------------------- 1. 找 node（必须绝对路径）
if [ -z "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  else
    for c in /usr/local/bin/node /usr/bin/node /snap/bin/node "$HOME/.nvm/versions/node"/*/bin/node; do
      [ -x "$c" ] && { NODE_BIN="$c"; break; }
    done
  fi
fi
[ -n "$NODE_BIN" ] || die "找不到 node。先装（sudo apt install -y nodejs，或 nvm install --lts），或用 --node /path/to/node 指定。"
[ -x "$NODE_BIN" ] || die "node 不可执行：$NODE_BIN"
case "$NODE_BIN" in /*) ;; *) NODE_BIN="$(command -v "$NODE_BIN")" ;; esac   # crontab 里必须是绝对路径

NODE_VER="$("$NODE_BIN" -v 2>/dev/null || echo '?')"
NODE_MAJOR="$(printf '%s' "$NODE_VER" | sed 's/^v//' | cut -d. -f1)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) ;;
  *) [ "$NODE_MAJOR" -ge 18 ] || die "node 版本过低（$NODE_VER），需要 18+：
     · 时区归一（TZ-GUARD）要 Node 16+；实时取数用全局 fetch，要 Node 18+。
     · ⚠️ Ubuntu 22.04 用 apt 装到的 nodejs 是 12.x，必须换装：
         curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
         sudo apt install -y nodejs
       或 nvm：curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install --lts
     · 装好后重跑本脚本（会自动探测新的 node 路径）。" ;;
esac

# ---------------------------------------------------------------- 2. 前置自检
[ -f "$RUNNER" ] || die "找不到运行器：$RUNNER"

LOG_DIR="${HDSZF_LOG_DIR:-$ROOT/../_hdszf_logs}"
# 路径先规范化（去掉 .. 与相对形式）再判断"是否在仓库内"，否则 $ROOT/../x 会被误判为仓库内。
# 判定交给 node（跨平台分隔符一致），不要在 shell 里用 case 做前缀匹配 —— 反斜杠会被当转义。
NORM='const p=require("path");process.stdout.write(p.resolve(process.argv[1]))'
LOG_DIR="$("$NODE_BIN" -e "$NORM" "$LOG_DIR")" || die "日志目录无法解析：$LOG_DIR"
if "$NODE_BIN" -e 'const p=require("path");const r=p.resolve(process.argv[1]),l=p.resolve(process.argv[2]);process.exit(l===r||l.startsWith(r+p.sep)?0:1)' "$ROOT" "$LOG_DIR"; then
  die "日志目录不能放在仓库里（$LOG_DIR）—— 仓库根是 Cloudflare Assets 的发布目录，日志会被公开上传并污染 git。请换到仓库外，例如 $ROOT/../_hdszf_logs"
fi

# --hours 只在服务器时区确实等于北京时间时才对得上（见下文 CRON_TZ 说明）
CRON_TZ_LINE=""
if [ "$HOURS" != "*" ]; then
  SRV_OFF="$("$NODE_BIN" -e 'process.stdout.write(String(-new Date().getTimezoneOffset()/60))' 2>/dev/null || echo '?')"
  CRON_TZ_LINE="CRON_TZ=Asia/Shanghai"
  warn "--hours $HOURS 会被 cron 按**服务器本地时间**解释（本机偏移 UTC$SRV_OFF），"
  warn "   而运行器的闸门按北京时间判断；两者错位会让任务全被静默跳过。"
  warn "   已自动在本段加上 CRON_TZ=Asia/Shanghai 让两边对齐（若你的 cron 不支持该行，请改用默认的全天每小时唤醒）。"
fi

PROBLEMS=0
if [ "$(uname -s 2>/dev/null || echo unknown)" != "Linux" ]; then
  warn "本脚本面向 Linux（cron）。当前系统是 $(uname -s 2>/dev/null || echo unknown) —— Windows 请用 crontab\\install.cmd。"
  warn "   继续跑只为语法/逻辑自检，写入的 crontab 在本机不可用。"
fi
command -v git >/dev/null 2>&1 || { warn "找不到 git：sudo apt install -y git"; PROBLEMS=1; }
command -v python3 >/dev/null 2>&1 || warn "找不到 python3：月度定稿（finalize）需要它取数 → sudo apt install -y python3"
# ⚠ 不要用 `git -C "$ROOT"`：$ROOT 在 Git Bash 下是 /c/… 形式，原生 git.exe 认不出来（Linux 无此问题）。
#   统一用子 shell cd 进去，两种环境都稳。
if ! (cd "$ROOT" && git rev-parse --abbrev-ref HEAD >/dev/null 2>&1); then
  warn "这里不是 git 仓库：$ROOT"
  PROBLEMS=1
elif [ -z "$(cd "$ROOT" && git config user.email 2>/dev/null || true)" ]; then
  warn "git 身份未配置，commit 会被拒："
  warn "   git config --global user.email \"you@example.com\" && git config --global user.name \"yourname\""
  PROBLEMS=1
fi

say ""
say "目标仓库 ：$ROOT"
say "node     ：$NODE_BIN  ($NODE_VER)"
say "运行器   ：$RUNNER"
say "日志目录 ：$LOG_DIR"
say "cron 时段：每小时第 $MTD_MIN 分钟 mtd ／ 第 $FIN_MIN 分钟 finalize（小时=$HOURS）"

# 云服务器最容易翻车的地方：仓库 clone 下来了，但没有推送凭据 → 自动化全流程白跑。
# 这里提前验一次，别等到"每个月 3 号定稿失败"才发现。
if (cd "$ROOT" && git remote get-url origin >/dev/null 2>&1); then
  REMOTE_URL="$(cd "$ROOT" && git remote get-url origin)"
  say "远程 origin：$REMOTE_URL"
  if (cd "$ROOT" && GIT_TERMINAL_PROMPT=0 timeout 25 git ls-remote origin main >/dev/null 2>&1); then
    say "推送凭据  ：✅ 可以访问远程（ls-remote 成功）"
  else
    warn "推送凭据  ：✗ 无法访问远程（git ls-remote origin main 失败）→ 自动化会白跑！"
    warn "   ① SSH key：ssh-keygen -t ed25519 生成后把公钥加到 GitHub 仓库 Deploy keys（勾 Allow write access）"
    warn "   ② 主机指纹：ssh-keyscan github.com >> ~/.ssh/known_hosts"
    warn "   ③ 自测：ssh -T git@github.com  应返回 \"successfully authenticated\""
    PROBLEMS=1
  fi
fi
say ""

# ---------------------------------------------------------------- 3. 生成 crontab 片段
if [ "$HOURS" = "*" ]; then
  MTD_SPEC="$MTD_MIN * * * *"
  FIN_SPEC="$FIN_MIN * * * *"
else
  MTD_SPEC="$MTD_MIN $HOURS * * *"
  FIN_SPEC="$FIN_MIN $HOURS * * *"
fi

BLOCK="$(cat <<EOF
PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/bin
MAILTO=""
${CRON_TZ_LINE}
${HDSZF_LOG_DIR:+HDSZF_LOG_DIR=$LOG_DIR}
$MARK_BEGIN
# mtd      → 本月至今（MTD）快照：每交易日 18:00 后（北京时间，由 run_job.js 判断）
# finalize → 月度定稿固化：每月 3 日起，当月成功一次即停（由 run_job.js 判断）
# 为什么是"每小时唤醒"而不是写死 18-23：服务器时区可能是 UTC，写死小时数会整体错 8 小时；
# 时段判断一律交给 run_job.js 的闸门（它内部把时区归一为 Asia/Shanghai）。
$MTD_SPEC $NODE_BIN $RUNNER mtd >> $LOG_DIR/cron.log 2>&1
$FIN_SPEC $NODE_BIN $RUNNER finalize >> $LOG_DIR/cron.log 2>&1
$MARK_END
EOF
)"

# 空行（HDSZF_LOG_DIR 未设置时）会让 crontab 里多一行空白，去掉更干净
BLOCK="$(printf '%s\n' "$BLOCK" | sed '/^[[:space:]]*$/d')"

if [ "$DRY_RUN" = "1" ]; then
  say "— dry-run：以下内容会追加到 crontab（不动已有条目）—"
  printf '%s\n' "$BLOCK"
  say "— dry-run 结束，未做任何修改 —"
  exit 0
fi

# ---------------------------------------------------------------- 4. 写 crontab（保留其它条目）
mkdir -p "$LOG_DIR" || die "无法创建日志目录：$LOG_DIR"
touch "$LOG_DIR/cron.log" 2>/dev/null || true

CURRENT="$(crontab -l 2>/dev/null || true)"
KEPT="$(printf '%s\n' "$CURRENT" | awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
  index($0, b) > 0 { skip = 1; next }
  index($0, e) > 0 { skip = 0; next }
  !skip { print }
' | awk '{ l[n++] = $0 } END { while (n > 0 && l[n-1] ~ /^[[:space:]]*$/) n--; for (i = 0; i < n; i++) print l[i] }')"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if [ -n "$KEPT" ]; then
  printf '%s\n' "$KEPT" >> "$TMP"
  printf '\n' >> "$TMP"
fi
printf '%s\n' "$BLOCK" >> "$TMP"

crontab "$TMP" || die "写入 crontab 失败（检查 cron 是否安装：sudo apt install -y cron）"

say "✅ 已写入 crontab。当前内容："
say "────────────────────────────────────────"
crontab -l | sed 's/^/  /'
say "────────────────────────────────────────"

# ---------------------------------------------------------------- 5. 服务与后续提示
CRON_STATE="$(systemctl is-active cron 2>/dev/null || echo 'unknown')"
if [ "$CRON_STATE" = "active" ]; then
  say "✅ cron 服务：active（下次触发见上表，每小时的第 $MTD_MIN / $FIN_MIN 分钟）"
elif [ "$CRON_STATE" = "unknown" ]; then
  warn "cron 服务状态未知（没有 systemctl 或权限不足）—— 自行确认 cron 在跑"
else
  warn "cron 服务状态 = $CRON_STATE → 修：sudo systemctl enable --now cron"
fi

say ""
say "下一步（建议按顺序做一遍）："
say "  1) 手工试跑一次（真实取数、不写盘、不推送）："
say "     $NODE_BIN $RUNNER mtd --no-status -- --no-json"
say "  1b) 想让今天的数据真实上线（会更新并推送）："
say "     $NODE_BIN $RUNNER mtd --force"
say "  2) 查看健康报告："
say "     bash $ROOT/crontab/status.sh --online"
say "  3) 日志：$LOG_DIR（mtd_YYYY-MM.log / finalize_YYYY-MM.log / status.json / cron.log）"
say "  4) 卸载：bash $ROOT/crontab/uninstall.sh"
say "  5) 手动跑法与频率、时区与凭据等注意事项见 $ROOT/crontab/README.md"
if [ "$PROBLEMS" = "1" ]; then
  say ""
  warn "上面有未解决的 ⚠ 项，建议先处理再依赖自动化。"
fi
exit 0
