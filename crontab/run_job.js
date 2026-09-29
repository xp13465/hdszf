#!/usr/bin/env node
/**
 * 恒市值助手 · 无人值守运行器（零 AI 依赖，纯 Node）
 *
 * 由 Windows 计划任务按小时唤醒，内部自带「每日/每月只成功一次」的闸门，
 * 因此计划任务可以放心地高频触发（错过就补跑），不会重复提交、不会重复部署。
 *
 * 用法：
 *   node crontab/run_job.js mtd                     # 本月至今（MTD）快照 → progress.json
 *   node crontab/run_job.js finalize                # 月度定稿固化 → data.js 等全流程
 *   node crontab/run_job.js finalize --force        # 手动补跑：忽略全部软闸门（含时间窗口），并逐条打印警告
 *   node crontab/run_job.js mtd --no-status         # 诊断用：不写 status.json（不污染真实状态）
 *   node crontab/run_job.js mtd -- --no-fetch       # 「--」后的参数原样透传给子脚本
 *
 * 退出码：0 = 成功或按设计跳过；2 = 取数降级（无数据可发布，属正常告警）；其它 = 真失败
 *
 * 设计要点（与项目铁律一一对应）：
 *   1. 绝不自造数据 —— 所有数值都由 scripts/ 下的既有脚本产出，本运行器只负责「何时跑、跑了记什么」。
 *   2. 项目铁律「月未走完不更新」由 monthly_update.js 自己把住（未走完 → exit 0），本运行器不重复实现。
 *   3. 日志写在**仓库外**（<工作区>/_hdszf_logs/），否则会被 wrangler 当成 Assets 公开上传、还会污染 git。
 *   4. finalize 失败即自动回滚 tracked 改动（git checkout -- .），把「半成品」变回「什么都没发生」，
 *      避免下一天的运行在脏工作区上继续替换（这是无人值守最危险的场景）。
 *   5. 每次运行前做一次「自愈推送」：本地领先远程就先推掉，防止上次 push 失败后静默卡住。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// 日志与状态一律放在**仓库之外**：仓库目录是 Cloudflare Assets 的发布根，
// 放进去会被公开上传、还会污染 git。可用 HDSZF_LOG_DIR 覆盖（测试/迁移用）。
const LOG_DIR = process.env.HDSZF_LOG_DIR
  ? path.resolve(process.env.HDSZF_LOG_DIR)
  : path.resolve(ROOT, '..', '_hdszf_logs');
const STATUS_FILE = path.join(LOG_DIR, 'status.json');
const NODE = process.execPath;

// ---------------------------------------------------------------- 任务定义
const JOBS = {
  mtd: {
    label: '本月至今（MTD）进度快照',
    script: 'scripts/monthly_progress.js',
    args: ['--push'],
    windowFromHour: 18,     // A 股 15:00 收盘，新浪日 K 傍晚更新，18:00 后可取到当日收盘
    weekdaysOnly: true,     // 周末不跑（休市日跑了也会因「数据无变化」自动跳过）
    attemptsPerDay: 3,      // 当晚最多尝试 3 次（网络抖动时自动重试）
    oncePer: 'day',         // 当天成功一次即不再跑
    revertOnFailure: false, // 只写单个 json，失败无需回滚
  },
  finalize: {
    label: '月度定稿固化',
    script: 'scripts/monthly_update.js',
    args: ['--strict'],     // 任一条静态文案替换规则未命中即中止：宁可不动，也不要半成品上线
    windowFromHour: 0,
    minDayOfMonth: 3,       // 月初前 2 天不跑：给「上月末最后一个交易日」的行情留出发布余量
    weekdaysOnly: false,
    attemptsPerDay: 1,      // 每天只试一次，失败次日自动重试（整月循环，直到成功）
    oncePer: 'month',       // 当月成功一次即不再跑
    revertOnFailure: true,
    // 定稿内部是 `git add -A` + commit：工作区脏会把**人工改动一起裹进「数据更新」提交并上线**。
    // 所以定稿前置条件 = 工作区干净（mtd 只 `git add -- js/progress.json`，无需此约束）。
    requireCleanTree: true,
  },
};

// ---------------------------------------------------------------- 环境补全
// 计划任务的 PATH 极干净：必须自己补 git / python，否则脚本内的 execFileSync('git'|'python') 会 ENOENT。
const EXTRA_PATH = [
  'C:\\Program Files\\Git\\cmd',
  'C:\\Users\\23405\\.workbuddy\\binaries\\python\\versions\\3.13.12',
];
process.env.PATH = EXTRA_PATH.concat(process.env.PATH ? [process.env.PATH] : []).join(';');
// Git for Windows 的 ssh 靠 HOME/USERPROFILE 找 ~/.ssh；计划任务下显式兜底，避免推不上去。
if (!process.env.HOME) process.env.HOME = process.env.USERPROFILE || 'C:\\Users\\23405';

// ---------------------------------------------------------------- 小工具
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const passthroughIdx = argv.indexOf('--');
const PASSTHROUGH = passthroughIdx >= 0 ? argv.slice(passthroughIdx + 1) : [];
const JOB_NAME = argv.find((a) => !a.startsWith('-') && !PASSTHROUGH.includes(a)) || '';
const FORCE = has('--force');
const NO_STATUS = has('--no-status');
const QUIET = has('--quiet');

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function dayKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }

function ensureLogDir() { fs.mkdirSync(LOG_DIR, { recursive: true }); }
function logFile(job) { return path.join(LOG_DIR, `${job}_${monthKey()}.log`); }

const buffer = [];
function log(line = '') {
  const s = line.endsWith('\n') ? line.slice(0, -1) : line;
  buffer.push(s);
  if (!QUIET) process.stdout.write(s + '\n');
}
function flush(job) {
  if (!buffer.length) return;
  ensureLogDir();
  fs.appendFileSync(logFile(job), buffer.join('\n') + '\n', 'utf8');
  buffer.length = 0;
}

function readStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch (_) { return {}; }
}
function writeStatus(obj) {
  if (NO_STATUS) return;
  ensureLogDir();
  obj.updated_at = stamp();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------- git 助手
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
}
function gitTry(args) {
  try { return { ok: true, out: git(args) }; } catch (e) { return { ok: false, out: String((e.stdout || '') + (e.stderr || '') || e.message).trim() }; }
}
function headShort() { try { return git(['rev-parse', '--short', 'HEAD']); } catch (_) { return '(未知)'; } }

/** 工作区是否干净（只看 tracked 文件的改动；未跟踪的产物不算脏） */
function treeClean() {
  const r = gitTry(['status', '--porcelain', '--untracked-files=no']);
  return r.ok && r.out === '';
}

/** 自愈推送：本地领先远程就先推上去，防止「上次 push 失败 → 此后一直静默卡住」 */
function selfHealPush() {
  const clean = treeClean();
  if (!clean) { log('  · 工作区有未提交改动，跳过自愈推送'); return; }
  const head = gitTry(['rev-parse', 'HEAD']);
  const tip = gitTry(['ls-remote', 'origin', 'main']);
  if (!head.ok || !tip.ok) { log('  · 无法比对远程 tip，跳过自愈推送'); return; }
  const remoteSha = tip.out.split(/\s+/)[0];
  if (remoteSha === head.out) { log('  · 本地与远程一致，无需自愈推送'); return; }
  log(`  ! 本地(${head.out.slice(0, 7)}) ≠ 远程(${remoteSha.slice(0, 7)}) → 尝试补推`);
  const p = gitTry(['push', 'origin', 'main']);
  if (!p.ok) log(`  ✗ 补推失败：${p.out.split('\n')[0]}`);
  else log('  ✓ 补推成功（上次失败的推送已恢复）');
}

// ---------------------------------------------------------------- 闸门
// 软闸门 = 可被人为忽略的「时机约束」（时间窗口 / 月初余量 / 周末 / 已成功 / 次数上限）。
// --force 会忽略**全部**软闸门（供手动补跑），但会逐条打印警告 —— 因为忽略时间窗意味着
// 可能取到上一交易日的收盘，读者必须知道自己在看什么。
// 计划任务注册的命令**不带 --force**，所以无人值守时的保护完全不受影响。
const SOFT_WARNINGS = [];
function gateReason(job, cfg, st) {
  const now = new Date();
  const s = st[job] || {};
  const hit = [];

  if (cfg.minDayOfMonth && now.getDate() < cfg.minDayOfMonth) {
    hit.push(`月初前 ${cfg.minDayOfMonth - 1} 天不跑（给上月末行情留发布余量），今天 ${now.getDate()} 号`);
  }
  if (cfg.weekdaysOnly && (now.getDay() === 0 || now.getDay() === 6)) {
    hit.push('周末休市，不跑');
  }
  if (cfg.windowFromHour && now.getHours() < cfg.windowFromHour) {
    const hh = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    hit.push(
      `未到时间窗口（${cfg.windowFromHour}:00 之后才跑；当前 ${hh}，` +
      `新浪日 K 尚未更新，取到的可能是上一交易日收盘）`
    );
  }
  if (!FORCE) {
    if (cfg.oncePer === 'day' && s.last_ok_date === dayKey(now)) hit.push('今天已成功更新过，无需重跑');
    if (cfg.oncePer === 'month' && s.last_ok_month === monthKey(now)) hit.push('本月已成功定稿过，无需重跑');
    if (s.attempt_date === dayKey(now) && (s.attempts_today || 0) >= cfg.attemptsPerDay) {
      hit.push(`今日尝试次数用尽（${s.attempts_today}/${cfg.attemptsPerDay}），明天再试`);
    }
  }

  if (!hit.length) return null;
  if (!FORCE) return hit[0];
  SOFT_WARNINGS.length = 0;
  hit.forEach((h) => SOFT_WARNINGS.push(h));
  return null;
}

// ---------------------------------------------------------------- 摘要提取
function summarize(out) {
  const lines = out.split(/\r?\n/).filter(Boolean);
  const pick = (re) => { const l = lines.filter((x) => re.test(x)); return l.length ? l[l.length - 1].trim() : ''; };
  return (
    pick(/\[ok\]|已 push|✓.*运行|完成。/) ||
    pick(/\[skip\]/) ||
    pick(/已定稿|未走完|降级/) ||
    lines[lines.length - 1] || ''
  ).replace(/^\[[^\]]*\]\s*/, '').slice(0, 160);
}

// ---------------------------------------------------------------- 主流程
function main() {
  if (has('--help') || has('-h') || !JOB_NAME) {
    console.log(`
恒市值助手 · 无人值守运行器

  node crontab/run_job.js mtd                 本月至今（MTD）快照（每交易日 18:00 后）
  node crontab/run_job.js finalize            月度定稿固化（每月 3 日起，成功一次即停）
  node crontab/run_job.js <job> --force       手动补跑：忽略**全部**软闸门（时间窗口 / 已成功 / 次数上限），并逐条打印警告
  node crontab/run_job.js <job> --no-status   诊断用：不改动 status.json
  node crontab/run_job.js <job> -- <args...>  透传参数给子脚本（如 -- --no-fetch）

  手动模式：不装计划任务时，自己按频率跑这两条命令即可（--force 会连时间窗口一起忽略，
  所以可以在任何时间点手动补跑；但早于 18:00 跑 mtd 取到的可能是上一交易日收盘）。
  手动模式下没有「已成功即跳过」之外的兜底，失败也不会有人通知你 —— 跑完请看上面的 exit。

  健康检查：node crontab/status.js
  日志目录：${LOG_DIR}
`);
    return 0;
  }
  const cfg = JOBS[JOB_NAME];
  if (!cfg) {
    console.error(`未知任务：${JOB_NAME}（可选：${Object.keys(JOBS).join(' | ')}）`);
    return 1;
  }

  const now = new Date();
  let st = readStatus();
  st[JOB_NAME] = st[JOB_NAME] || {};
  const s = st[JOB_NAME];

  log('');
  log(`[${stamp(now)}] ==== ${JOB_NAME} · ${cfg.label} ====`);

  const reason = gateReason(JOB_NAME, cfg, st);
  if (reason) {
    log(`[${stamp()}] 按设计跳过：${reason}`);
    flush(JOB_NAME);
    return 0; // 跳过不是失败：计划任务每小时都会唤醒，静默跳过即可
  }
  if (SOFT_WARNINGS.length) {
    log(`[${stamp()}] ⚠ --force 手动补跑：已忽略以下软闸门（自动化的默认保护本次不生效）`);
    SOFT_WARNINGS.forEach((h) => log(`    ⚠ ${h}`));
  }

  // 硬闸门（--force 也不绕过）：定稿用 git add -A 提交，脏工作区会把人工改动裹进「数据更新」一起上线。
  // 这是安全性约束，不是时机约束 —— 手动补跑同样必须先 commit / stash。
  if (cfg.requireCleanTree && !treeClean()) {
    log(`[${stamp()}] 按设计跳过：工作区有未提交改动`);
    log('    · 原因：定稿内部用 git add -A 提交，脏工作区会把你的改动一起裹进「数据更新」提交并上线');
    log('    · 处置：先 git commit 或 git stash 你的改动，再重跑本任务');
    flush(JOB_NAME);
    return 0;
  }

  // 记录尝试次数（先写盘，防止运行中途被强制结束导致计数丢失）
  const today = dayKey(now);
  s.attempts_today = s.attempt_date === today ? (s.attempts_today || 0) + 1 : 1;
  s.attempt_date = today;
  s.last_attempt_at = stamp(now);
  writeStatus(st);

  log(`[${stamp()}] 尝试 ${s.attempts_today}/${cfg.attemptsPerDay}${FORCE ? '（--force）' : ''}`);
  selfHealPush();

  const beforeClean = cfg.revertOnFailure ? treeClean() : true;
  const childArgs = [path.join(ROOT, cfg.script)].concat(cfg.args, PASSTHROUGH);
  log(`[${stamp()}] 执行：node ${[cfg.script].concat(cfg.args, PASSTHROUGH).join(' ')}`);

  const t0 = Date.now();
  const simExit = (() => {
    const m = argv.find((a) => a.startsWith('--simulate-exit='));
    return m ? Number(m.split('=')[1]) : null;
  })();
  // --simulate-exit=N：诊断用，跳过真实执行，直接按设定的退出码走完后续流程
  // （用于验证「失败告警 / 状态记录 / 自动回滚」这条链路是通的）
  const r = simExit === null
    ? spawnSync(NODE, childArgs, { cwd: ROOT, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : { status: simExit, stdout: `[诊断] --simulate-exit=${simExit}：已跳过实际执行\n`, stderr: '' };
  if (simExit !== null) log(`  ⚠ 诊断模式：跳过实际执行，模拟退出码 ${simExit}`);
  const code = typeof r.status === 'number' ? r.status : -1;
  const out = String(r.stdout || '');
  const err = String(r.stderr || '');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (out.trim()) out.trimEnd().split('\n').forEach((l) => log('  │ ' + l));
  if (err.trim()) err.trimEnd().split('\n').forEach((l) => log('  │ ' + l));

  const raw = out + '\n' + err;
  // 把子脚本的「按设计不更新」翻译成人话，避免状态报表里出现看似失败的 ✗ 行
  const msg = /尚未走完/.test(raw)
    ? '按设计不更新：目标月尚未走完（下月初自动重试）'
    : summarize(raw);
  s.last_exit = code;
  s.last_msg = msg;
  s.last_duration_s = Number(secs);

  if (code === 0) {
    s.fail_streak = 0;
    s.last_ok_date = dayKey(now);
    s.last_ok_month = monthKey(now);
    s.last_ok_at = stamp();
    log(`[${stamp()}] exit=0 → 成功（${secs}s）${msg ? '：' + msg : ''}`);
    writeStatus(st);
    flush(JOB_NAME);
    return 0;
  }

  if (code === 2) {
    // 降级：取数不完整 → 脚本已按铁律「不写不推」，站点回退到已定稿口径。属正常告警，不是失败。
    s.fail_streak = 0;
    log(`[${stamp()}] exit=2 → 降级（取数不完整，未写入/未推送任何本月至今数据；站点已回退已定稿口径）`);
    log(`  · 这是设计内的安全行为：宁可不显示，也不用 0 拼出假的「当月持平」`);
    writeStatus(st);
    flush(JOB_NAME);
    return 2;
  }

  s.fail_streak = (s.fail_streak || 0) + 1;
  s.last_fail_at = stamp();
  log(`[${stamp()}] exit=${code} → 失败（连续 ${s.fail_streak} 次，耗时 ${secs}s）${msg ? '：' + msg : ''}`);

  if (cfg.revertOnFailure) {
    const dirtyNow = !treeClean();
    if (dirtyNow && beforeClean) {
      log('  · 检测到本次运行留下未提交改动 → 自动回滚 tracked 文件，保持「什么都没发生」');
      const rv = gitTry(['checkout', '--', '.']);
      log(rv.ok ? '  ✓ 已回滚（git checkout -- .）' : `  ✗ 回滚失败：${rv.out.split('\n')[0]}`);
    } else if (dirtyNow) {
      log('  · 工作区原本就不干净 → 不做自动回滚（避免误伤人工改动），请手工处理');
    }
  }

  writeStatus(st);
  flush(JOB_NAME);
  return code;
}

let exitCode = 1;
try {
  exitCode = main();
} catch (e) {
  log(`[${stamp()}] 运行器自身异常：${e && e.stack ? e.stack : e}`);
  exitCode = 1;
}
process.exit(exitCode);
