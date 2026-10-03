#!/usr/bin/env node
/**
 * 恒市值助手 · 自动化健康检查（查看清单）
 *
 * 一条命令看清「计划任务/cron 有没有在跑、数据有没有跟上、线上有没有更新」。
 * Windows 与 Linux 通用：平台不同时第 2 段的取数方式自动切换（schtasks / crontab -l）。
 *
 * 用法：
 *   node crontab/status.js                # 完整报告
 *   node crontab/status.js --online       # additionally 核对线上版本号与数据截止月
 *   node crontab/status.js --tail=30      # 每个任务多打几行日志
 *   node crontab/status.js --no-tasks     # 不查调度器（沙箱/无权限/手动模式时用）
 *
 * 只读脚本：不修改任何文件、不执行任何写操作、不产生提交。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync, spawnSync } = require('child_process');

// ---------------------------------------------------------------- TZ-GUARD（时区归一）
// 与 run_job.js 同源：本报表里的时间、星期、日期必须和运行器闸门的判断口径一致（北京时间）。
// 否则云服务器是 UTC 时，你会看到「时间显示没到 18:00，但日志说已经跑了」这种自相矛盾的报表。
process.env.TZ = process.env.HDSZF_TZ || 'Asia/Shanghai';

const IS_WIN = process.platform === 'win32';
const ROOT = path.resolve(__dirname, '..');
// 日志与状态一律放在**仓库之外**：仓库目录是 Cloudflare Assets 的发布根，
// 放进去会被公开上传、还会污染 git。可用 HDSZF_LOG_DIR 覆盖（测试/迁移用）。
const LOG_DIR = process.env.HDSZF_LOG_DIR
  ? path.resolve(process.env.HDSZF_LOG_DIR)
  : path.resolve(ROOT, '..', '_hdszf_logs');
const STATUS_FILE = path.join(LOG_DIR, 'status.json');
const LOCK_FILE = path.join(LOG_DIR, 'automation.lock');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const num = (name, def) => {
  const m = argv.find((a) => a.startsWith(`--${name}=`));
  return m ? Number(m.split('=')[1]) : def;
};
const TAIL = num('tail', 12);
const ONLINE = has('--online');
const NO_TASKS = has('--no-tasks');

// 两条调度任务的「显示标签」与「run_job.js 子命令」。
// ⚠️ 两个平台的标识**不是同一个东西**，绝不能混用：
//   Windows → 计划任务名就是 `hdszf-mtd` / `hdszf-finalize`（`schtasks /tn` 用它）
//   Linux   → crontab 行里只有 `run_job.js mtd` / `run_job.js finalize`，**不含 hdszf-* 字样**
// 历史 bug（2026-10-01 修）：Linux 分支沿用 schtasks 的命名去匹配 crontab 行，永远匹配不到 →
// 恒报「crontab 里有 hdszf 条目，但没有 hdszf-mtd」，把真实故障淹没在假告警里。
const TASKS = [
  { label: 'hdszf-mtd', cmd: 'mtd' },
  { label: 'hdszf-finalize', cmd: 'finalize' },
];

const C = process.env.NO_COLOR
  ? { r: '', g: '', y: '', b: '', d: '', x: '' }
  : { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[90m', x: '\x1b[0m' };

const OK = `${C.g}✅${C.x}`;
const WARN = `${C.y}⚠️ ${C.x}`;
const BAD = `${C.r}❌${C.x}`;

function padEnd(s, n) { const w = [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0); return String(s) + ' '.repeat(Math.max(0, n - w)); }
function line(char = '─', n = 74) { return char.repeat(n); }
function h(t) { console.log(`\n${C.b}${t}${C.x}`); console.log(line()); }
function nowStamp() { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

function gitTry(args) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim() }; }
  catch (e) { return { ok: false, out: String((e.stdout || '') + (e.stderr || '') || e.message).trim() }; }
}
function readStatus() { try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch (_) { return null; } }
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }

/** 从 data.js 读出数据窗口（APP_DATA 是 const，必须用 vm 求值取回） */
function readDataWindow() {
  try {
    const ctx = { console, Math, Date, JSON, parseFloat, parseInt, isNaN, Number, String, Object, Array };
    vm.createContext(ctx);
    for (const f of ['js/data.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    const rr = vm.runInContext('APP_DATA.realReturns', ctx);
    return {
      months: rr.months.length,
      n: rr.asset_returns['沪深300'].length,
      start: rr.months[0],
      end: rr.months[rr.months.length - 1],
    };
  } catch (e) { return { err: String(e.message || e) }; }
}

// ---------------------------------------------------------------- 调度器查询
// Windows → schtasks；Linux/macOS → 当前用户的 crontab（crontab/install.sh 写入的条目）
function taskInfo(name) {
  return IS_WIN ? schtasksInfo(name) : crontabInfo(name);
}

function schtasksInfo(name) {
  // schtasks 的中文输出在 GBK 控制台下会乱码 → 用 cmd 先切 UTF-8 再取
  const r = spawnSync('cmd.exe', ['/c', `chcp 65001>nul && schtasks /query /tn "${name}" /fo LIST /v`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  // 区分「查不了」和「没注册」：前者是环境限制（如安全策略禁用 cmd.exe），不该计成故障
  if (r.error) return { soft: `无法执行 schtasks（${String(r.error.code || r.error.message).slice(0, 40)}）→ 跳过此项校验` };
  if (r.status !== 0) return { err: '任务未注册' };
  const txt = String(r.stdout || '');
  const pick = (re) => { const m = txt.match(re); return m ? m[1].trim() : '—'; };
  return {
    name,
    state: pick(/(?:Status|状态):\s*(.+)/),
    last: pick(/(?:Last Run Time|上次运行时间):\s*(.+)/),
    lastResult: pick(/(?:Last Result|上次运行结果):\s*(.+)/),
    next: pick(/(?:Next Run Time|下次运行时间):\s*(.+)/),
    raw: txt,
  };
}

function crontabRead() {
  const r = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (r.error) return { soft: `无法执行 crontab -l（${String(r.error.code || r.error.message).slice(0, 40)}）→ 跳过此项校验` };
  if (r.status !== 0) return { err: '当前用户没有 crontab（未注册该任务）' };
  return { lines: String(r.stdout || '').split(/\r?\n/) };
}

/** Ubuntu/Debian 的 cron 守护进程是否在跑；不是 systemd 的环境返回 null（不算错误） */
function cronServiceState() {
  const r = spawnSync('systemctl', ['is-active', 'cron'], { encoding: 'utf8' });
  if (r.error) return null;
  return String(r.stdout || '').trim() || null;
}

/** 从 crontab 行里挑出 hdszf 的任务行（纯函数，便于 --self-test 断言）
 *  cmd = run_job.js 的子命令（'mtd' / 'finalize'）；切记**不是** `hdszf-mtd` 那种计划任务名。 */
function pickCronJobs(lines, cmd) {
  const all = lines.filter((l) => !l.trim().startsWith('#') && /run_job\.js\s+(mtd|finalize)(\s|$)/.test(l));
  const mine = all.filter((l) => new RegExp(`run_job\\.js\\s+${cmd}(\\s|$)`).test(l));
  return { all, mine };
}

/** ⚠️ 入参是 run_job.js 的**子命令**（'mtd' / 'finalize'），不是 Windows 的计划任务名 */
function crontabInfo(cmd) {
  const ce = crontabRead();
  if (ce.soft) return { soft: ce.soft };
  if (ce.err) return { err: ce.err };
  const { all: jobs, mine } = pickCronJobs(ce.lines, cmd);
  if (!mine.length) {
    return { err: jobs.length ? `crontab 里有 hdszf 条目，但没有 ${cmd} 任务` : 'crontab 里没有 hdszf 条目（未注册）' };
  }
  return { name: cmd, state: '已注册', next: `${nextCronRun(mine[0])}（估算）`, raw: mine.join('\n') };
}

/** 只解析我们自己写的表达式（`*` / `a-b` / `a,b` / 数字），够用且不会误判 */
function nextCronRun(line) {
  const f = line.trim().split(/\s+/);
  if (f.length < 5) return '—';
  const parse = (s, max) => {
    if (s === '*') return null;                     // null = 通配
    const out = [];
    for (const part of s.split(',')) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return undefined;                     // undefined = 解析不了
      const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
      for (let i = a; i <= b; i++) if (i >= 0 && i <= max) out.push(i);
    }
    return out.sort((x, y) => x - y);
  };
  const mins = parse(f[0], 59); const hrs = parse(f[1], 23);
  if (mins === undefined || hrs === undefined) return '—';
  const now = new Date();
  const p2 = (x) => String(x).padStart(2, '0');
  for (let d = 0; d < 2; d++) {
    for (let h = (d === 0 ? now.getHours() : 0); h < 24; h++) {
      if (hrs && !hrs.includes(h)) continue;
      for (const m of mins) {
        const t = new Date(now);
        t.setDate(now.getDate() + d);
        t.setHours(h, m, 0, 0);
        if (t.getTime() > now.getTime()) {
          return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())} ${p2(t.getHours())}:${p2(t.getMinutes())}`;
        }
      }
    }
  }
  return '—';
}

function tailLog(job, n) {
  const d = new Date();
  const f = path.join(LOG_DIR, `${job}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.log`);
  if (!fs.existsSync(f)) return { file: f, lines: [], exists: false };
  const all = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean);
  return { file: f, lines: all.slice(-n), exists: true, total: all.length };
}

// ---------------------------------------------------------------- --self-test（回归守卫）
// 2026-10-01 的真实 bug：Linux 分支沿用 Windows 的计划任务名（`hdszf-mtd`）去匹配 crontab 行 →
// 永远匹配不到 → 恒报「crontab 里有 hdszf 条目，但没有 hdszf-mtd」，把真故障淹没在假告警里。
// 下面用 install.sh 真实写出的 crontab 片段把行为钉死，防止回归。
if (has('--self-test')) {
  const SAMPLE = [
    'PATH=/usr/local/bin:/usr/bin:/bin',
    'MAILTO=""',
    '### hdszf automation (managed by crontab/install.sh) >>>',
    '# mtd      → 本月至今（MTD）快照：每交易日 18:00 后',
    '7 * * * * /usr/bin/node /home/ubuntu/code/hdszf/crontab/run_job.js mtd >> /home/ubuntu/code/_hdszf_logs/cron.log 2>&1',
    '37 * * * * /usr/bin/node /home/ubuntu/code/hdszf/crontab/run_job.js finalize >> /home/ubuntu/code/_hdszf_logs/cron.log 2>&1',
    '### <<< hdszf automation <<<',
  ];
  const cases = [];
  const eq = (name, got, want) => cases.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  eq('TASKS 的子命令名', TASKS.map((t) => t.cmd), ['mtd', 'finalize']);
  eq('TASKS 的计划任务名', TASKS.map((t) => t.label), ['hdszf-mtd', 'hdszf-finalize']);

  const m = pickCronJobs(SAMPLE, 'mtd');
  const f = pickCronJobs(SAMPLE, 'finalize');
  eq('两条任务都被识别', m.all.length, 2);
  eq('mtd 命中 1 条', m.mine.length, 1);
  eq('mtd 命中的确实是 mtd 那行', /run_job\.js\s+mtd\b/.test(m.mine[0]), true);
  eq('finalize 命中 1 条', f.mine.length, 1);
  eq('mtd 不会误吃 finalize 那行', /finalize/.test(m.mine.join('\n')), false);

  // 回归钉子：拿计划任务名当子命令匹配 → 必然 0 命中。这正是旧 bug 的成因。
  eq('旧 bug 复现：hdszf-mtd 匹配不到', pickCronJobs(SAMPLE, 'hdszf-mtd').mine.length, 0);
  // 注释行必须被忽略（否则文档里的示例行会被当成"已注册"）
  eq('注释行被忽略', pickCronJobs(['# 7 * * * * node run_job.js mtd'], 'mtd').all.length, 0);

  const bad = cases.filter((c) => !c.ok);
  console.log(`status.js --self-test：${cases.length - bad.length}/${cases.length} 通过`);
  cases.forEach((c) => console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}` +
    (c.ok ? '' : `  得到 ${JSON.stringify(c.got)}，期望 ${JSON.stringify(c.want)}`)));
  if (bad.length) console.log(`${BAD}自检未通过 → 检查 TASKS 与 pickCronJobs 的两平台标识是否被混用`);
  process.exit(bad.length ? 1 : 0);
}

(async () => {
  console.log(`${C.b}恒市值助手 · 自动化健康检查${C.x}   ${C.d}${nowStamp()}${C.x}`);
  console.log(`${C.d}仓库 ${ROOT}   ${process.platform} · node ${process.version} · TZ=${process.env.TZ}${C.x}`);

  // ---------------------------------------------------------------- 1. 运行器状态
  h('1. 计划任务运行状态（本运行器自己的记录）');
  const st = readStatus();
  if (!st) {
    console.log(`${WARN}还没有 ${STATUS_FILE}`);
    console.log('   说明运行器从未成功执行过 → 请先确认计划任务已注册并至少跑过一次：');
    console.log(`   node crontab/run_job.js mtd --no-status   ${C.d}（手工试跑，不改状态）${C.x}`);
  } else {
    console.log(`记录文件：${STATUS_FILE}   最后更新：${st.updated_at}`);
    for (const job of ['mtd', 'finalize']) {
      const s = st[job];
      if (!s) { console.log(`\n${WARN}${job}：无记录`); continue; }
      const exit = s.last_exit;
      const flag = exit === 0 ? OK : exit === 2 ? WARN : BAD;
      const streak = s.fail_streak || 0;
      console.log('');
      const dur = s.last_duration_s != null ? s.last_duration_s + 's' : '—';
      console.log(`${flag} ${padEnd(job, 10)} 最近一次 exit=${exit}   ${s.last_attempt_at}   ${C.d}${dur}${C.x}`);
      if (s.last_ok_at) {
        const d = job === 'mtd' ? s.last_ok_date : s.last_ok_month;
        const gap = job === 'mtd' ? daysBetween(s.last_ok_date, nowStamp().slice(0, 10)) : null;
        console.log(`   ${padEnd('最近成功', 12)} ${s.last_ok_at}  ${C.d}(${d})${C.x}` +
          (gap !== null && gap > 3 ? `  ${C.y}← 已 ${gap} 天没成功更新${C.x}` : ''));
      } else {
        console.log(`   ${padEnd('最近成功', 12)} ${C.y}从未成功${C.x}`);
      }
      if (streak > 0) console.log(`   ${padEnd('连续失败', 12)} ${C.r}${streak} 次 ← 需要人工介入${C.x}`);
      if (s.last_msg) console.log(`   ${padEnd('摘要', 12)} ${C.d}${s.last_msg.slice(0, 96)}${C.x}`);
    }
  }

  // 单实例锁：存在且持有进程仍活着 = 当前真有一个任务在跑（另一个任务本次会按设计跳过）
  if (fs.existsSync(LOCK_FILE)) {
    let info = {};
    try { info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch (_) {}
    const ageS = Math.round((Date.now() - fs.statSync(LOCK_FILE).mtimeMs) / 1000);
    let alive = false;
    if (info.pid) { try { process.kill(info.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } }
    if (alive) console.log(`\n${OK} 正在运行：${info.job}（pid=${info.pid}，已 ${ageS}s）`);
    else console.log(`\n${WARN}发现僵尸锁：${info.job || '?'} pid=${info.pid} 已 ${Math.round(ageS / 60)} 分钟 → 下次唤醒会自动接管；也可直接删 ${LOCK_FILE}`);
  }

  // ---------------------------------------------------------------- 2. 调度器注册情况
  const regIssues = []; // 确认为「未注册」的任务标签 → 结论区汇总
  h(IS_WIN ? '2. Windows 计划任务注册情况' : '2. Linux cron 注册情况');
  if (NO_TASKS) {
    console.log(`${C.d}（--no-tasks：已跳过）${C.x}`);
  } else {
    if (!IS_WIN) {
      const cs = cronServiceState();
      if (!cs) console.log(`${C.d}cron 服务状态未知（没有 systemctl，或不适用）${C.x}`);
      else if (cs === 'active') console.log(`${OK} cron 服务：active`);
      else console.log(`${WARN}cron 服务状态 = ${cs} → 修：sudo systemctl enable --now cron`);
    }
    for (const { label, cmd } of TASKS) {
      // 两平台标识不同，见文件顶部 TASKS 注释：Windows 用计划任务名，Linux 用子命令名
      const t = taskInfo(IS_WIN ? label : cmd);
      if (t.soft) {
        console.log(`${WARN}${padEnd(label, 16)} ${t.soft}`);
      } else if (t.err) {
        regIssues.push(label);
        console.log(`${BAD} ${padEnd(label, 16)} ${t.err}`);
        console.log(`   ${C.d}注册命令见 crontab/${IS_WIN ? 'install.cmd' : 'install.sh'}${C.x}`);
      } else if (IS_WIN) {
        console.log(`${OK} ${padEnd(label, 16)} 状态=${t.state}  上次=${t.last}  结果=${t.lastResult}  下次=${t.next}`);
        if (t.state === 'Disabled' || t.state === '已禁用') console.log(`   ${WARN}任务被禁用 → 用 schtasks /change /tn ${label} /enable 重新启用`);
      } else {
        console.log(`${OK} ${padEnd(label, 16)} ${t.state}  下次≈${t.next}`);
        t.raw.split('\n').forEach((l) => console.log(`   ${C.d}${l}${C.x}`));
      }
    }
    console.log(`${C.d}  提示：上次运行结果 0=成功或按设计跳过；2=降级（无数据可发布，正常）；其它=失败${C.x}`);
  }

  // ---------------------------------------------------------------- 3. 数据与仓库
  h('3. 数据窗口与仓库状态');
  const dw = readDataWindow();
  if (dw.err) console.log(`${BAD} 读取 js/data.js 失败：${dw.err}`);
  else console.log(`数据窗口：${dw.start} ~ ${dw.end}（末端标签 ${dw.months} 个 / 收益 ${dw.n} 条）`);

  const pg = readJSON(path.join(ROOT, 'js/progress.json'));
  if (!pg) console.log(`${BAD} 读取 js/progress.json 失败`);
  else {
    // 降级时把原因一起打出来（progress.json#degraded_reason）：
    // 只写 degraded 会让人分不清「长假休市（正常）」与「取数真坏了（要看）」。
    const dg = pg.degraded
      ? `${C.y}degraded（${pg.degraded_reason || '本次无数据，站点回退已定稿口径'}）${C.x}`
      : `${C.g}正常${C.x}`;
    const fc = pg.fetch ? `  取数 ${pg.fetch.ok}成功/${pg.fetch.fail}失败` : '';
    console.log(`进行中快照：${pg.in_progress_month}  基准月 ${pg.base_month}  数据截至 ${pg.data_as_of || '—'}${fc}  ${dg}`);
    console.log(`           生成于 ${pg.generated_at || '—'}`);
    if (!pg.degraded && pg.est_total != null) {
      console.log(`           组合最新市值 ¥${Number(pg.est_total).toFixed(2)}  本月至今 ${Number(pg.est_change_pct_base).toFixed(2)}%（÷固定基准 50 万）`);
    }
    // 快照是否已过期（进行中月应等于数据末月 + 1）
    if (pg.in_progress_month && dw.end && pg.in_progress_month <= dw.end) {
      console.log(`${WARN}快照身份已过期：进行中月 ${pg.in_progress_month} 不晚于数据末月 ${dw.end} → 需重跑 monthly_progress.js`);
    }
    if (pg.generated_at) {
      const gapD = daysBetween(String(pg.generated_at).slice(0, 10), nowStamp().slice(0, 10));
      if (gapD > 4) console.log(`${WARN}快照已 ${gapD} 天未更新（交易日应在每天 18:00 后刷新）`);
    }
  }

  const branch = gitTry(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = gitTry(['rev-parse', 'HEAD']);
  const tip = gitTry(['ls-remote', 'origin', 'main']);
  const porcelain = gitTry(['status', '--porcelain']);
  const remoteSha = tip.ok ? tip.out.split(/\s+/)[0] : '';
  console.log(`git：分支 ${branch.out}  HEAD ${head.out.slice(0, 7)}  远程 ${remoteSha ? remoteSha.slice(0, 7) : C.r + '(取不到)' + C.x}`);
  if (remoteSha && head.ok && remoteSha === head.out) console.log(`${OK} 本地与远程一致`);
  else if (remoteSha) console.log(`${WARN}本地与远程不一致 → 用 git ls-remote origin main 复核后再决定是否 push`);
  if (porcelain.ok && porcelain.out) {
    const files = porcelain.out.split('\n').filter(Boolean);
    console.log(`${WARN}工作区有 ${files.length} 个未提交改动（月度定稿要求工作区干净，否则会被运行器跳过）：`);
    files.slice(0, 8).forEach((f) => console.log(`     ${f}`));
    if (files.length > 8) console.log(`     …另有 ${files.length - 8} 个`);
  } else if (porcelain.ok) {
    console.log(`${OK} 工作区干净`);
  }

  // ---------------------------------------------------------------- 4. 日志尾部
  h('4. 最近日志');
  for (const job of ['mtd', 'finalize']) {
    const t = tailLog(job, TAIL);
    if (!t.exists) { console.log(`${C.d}${job}: 本月还没有日志文件（${t.file}）${C.x}`); continue; }
    console.log(`${C.d}${job}: ${t.file}（共 ${t.total} 行，显示最后 ${Math.min(TAIL, t.total)} 行）${C.x}`);
    t.lines.forEach((l) => console.log('   ' + l.replace(/^\s+/, '')));
    console.log('');
  }

  // ---------------------------------------------------------------- 5. 线上核对（可选）
  if (ONLINE) {
    h('5. 线上核对');
    try {
      const res = await fetch('https://h.sugas.site/?cb=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
      const html = await res.text();
      const vers = [...html.matchAll(/js\/(data|engine|rolling|main)\.js\?v=(\d+)/g)].map((m) => `${m[1]}=v${m[2]}`);
      console.log(`站点 HTTP ${res.status}  版本号：${vers.join('  ')}`);
      const localVers = {};
      const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      [...idx.matchAll(/js\/(data|engine|rolling|main)\.js\?v=(\d+)/g)].forEach((m) => { localVers[m[1]] = `v${m[2]}`; });
      const drift = vers.filter((v) => { const [k, n] = v.split('='); return localVers[k] !== n; });
      if (drift.length) console.log(`${WARN}线上版本与本地不一致：${drift.join('  ')} → 可能尚未部署完成，或本次改动没推上去`);
      else console.log(`${OK} 线上版本号与本地一致（说明最近一次推送已部署完成）`);
      try {
        const pj = await (await fetch('https://h.sugas.site/js/progress.json?t=' + Date.now(), { cache: 'no-store' })).json();
        console.log(`线上快照：进行中月 ${pj.in_progress_month}  数据截至 ${pj.data_as_of || '—'}  生成于 ${pj.generated_at}${pj.degraded ? '  ' + C.y + 'degraded（' + (pj.degraded_reason || '本次无数据') + '）' + C.x : ''}`);
      } catch (e) { console.log(`${C.d}线上 progress.json 读取失败：${String(e.message || e).slice(0, 80)}${C.x}`); }
    } catch (e) {
      console.log(`${BAD} 无法访问站点：${String(e.message || e).slice(0, 120)}`);
    }
  }

  // ---------------------------------------------------------------- 结论
  h('结论');
  const problems = [];
  if (!st) problems.push(`运行器从未执行 → 检查调度器是否注册（crontab/${IS_WIN ? 'install.cmd' : 'install.sh'}）`);
  else {
    for (const job of ['mtd', 'finalize']) {
      const s = st[job] || {};
      if (s.fail_streak > 0) problems.push(`${job} 连续失败 ${s.fail_streak} 次`);
      if (!s.last_ok_at) problems.push(`${job} 从未成功执行过`);
    }
    if (st.mtd && st.mtd.last_ok_date) {
      const gap = daysBetween(st.mtd.last_ok_date, nowStamp().slice(0, 10));
      if (gap > 4) problems.push(`MTD 快照已 ${gap} 天未成功更新`);
    }
  }
  if (remoteSha && head.ok && remoteSha !== head.out) problems.push('本地提交未推送到远程');
  // 第 2 段查出的「未注册」必须进结论 —— 否则会出现「上半屏 ❌、结论 ✅ 一切正常」的自相矛盾
  if (regIssues.length) problems.push(`调度未注册：${regIssues.join('、')} → 跑 crontab/${IS_WIN ? 'install.cmd' : 'install.sh'}`);
  if (problems.length === 0) {
    console.log(`${OK} 一切正常：任务在跑、数据不过期、仓库与远程一致`);
    console.log(`${C.d}提示：加 --online 可一并核对线上是否已部署最新版本${C.x}`);
  } else {
    problems.forEach((p) => console.log(`${WARN}${p}`));
    console.log(`${C.d}处置方法见 crontab/README.md 的「故障处置」一节${C.x}`);
  }
})();
