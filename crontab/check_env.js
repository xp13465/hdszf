#!/usr/bin/env node
'use strict';

// TZ-GUARD：与 run_job.js / monthly_progress.js / monthly_update.js 同一口径。
// 必须在任何 new Date() 之前（Node 16+ 赋值即时生效）。全仓搜 TZ-GUARD 定位这几处。
process.env.TZ = process.env.HDSZF_TZ || 'Asia/Shanghai';

/**
 * 恒市值助手 · 环境体检（跨平台 · 深度检查）
 *
 * 回答一个问题：**这台机器现在能不能跑自动化？** 只读脚本 —— 不写任何文件、
 * 不改 crontab / 计划任务、不 commit、不 push。
 *
 * 平台引导各有一层薄壳（本文件不做平台专属的依赖安装）：
 *   Linux  ：crontab/check_env.sh  —— OS / apt 依赖 / cron 服务 / sudo，支持 --fix 自动装
 *   Windows：crontab/check_env.cmd —— 找 node，缺依赖时提示 winget
 * 两边都把深层检查交给本文件。对照表见 crontab/README.md 第 11 节。
 *
 * 用法：
 *   node crontab/check_env.js                  # 完整体检（含联网）
 *   node crontab/check_env.js --no-network     # 跳过联网与 ls-remote（离线/受限网络）
 *   node crontab/check_env.js --no-runtime     # 跳过「运行时」段（check_env.sh 已报过）
 *   node crontab/check_env.js --quiet          # 只打印 ⚠ ✗ 与汇总
 *   node crontab/check_env.js --json           # 机器可读输出（供脚本消费）
 *   node crontab/check_env.js --print-node     # 只输出当前 node 的绝对路径
 *
 * 退出码：0 = 无阻塞项（可能仍有警告）；1 = 有阻塞项（现在装上去会白跑）；2 = 参数错误。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const RUNNER = path.join(ROOT, 'crontab', 'run_job.js');
const IS_WIN = process.platform === 'win32';
const LOG_DIR = path.resolve(process.env.HDSZF_LOG_DIR || path.join(ROOT, '..', '_hdszf_logs'));
const FALLBACK_LOG_DIR = path.resolve(ROOT, '..', '_hdszf_logs');

// ---------------------------------------------------------------- 参数
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const NO_NET = has('--no-network');
const NO_RUNTIME = has('--no-runtime');
const QUIET = has('--quiet') || has('-q');
const AS_JSON = has('--json');
const PRINT_NODE = has('--print-node');
const KNOWN = ['--no-network', '--no-runtime', '--quiet', '-q', '--json', '--print-node', '-h', '--help'];

if (has('-h') || has('--help')) {
  const src = fs.readFileSync(__filename, 'utf8');
  const body = src.slice(src.indexOf('/**'), src.indexOf('*/')).split('\n')
    .slice(1).map((l) => l.replace(/^\s*\*? ?/, '')).join('\n');
  process.stdout.write(body + '\n');
  process.exit(0);
}
for (const a of argv) {
  if (!KNOWN.includes(a)) { console.error(`未知参数：${a}（--help 看用法）`); process.exit(2); }
}
if (PRINT_NODE) { console.log(process.execPath); process.exit(0); }

// ---------------------------------------------------------------- 输出
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const C = COLOR
  ? { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', b: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' }
  : { g: '', y: '', r: '', b: '', d: '', x: '' };

const ITEMS = [];
let N_OK = 0, N_WARN = 0, N_FAIL = 0;

// 引导层（check_env.sh：Linux 系统 / apt 依赖 / cron 服务）已自行报过的阻塞与警告数，
// 由它通过环境变量带进来 —— 目的是**只出一份合并汇总**，不让用户看两遍「阻塞 N 项」。
const UP_FAIL = Math.max(0, Number(process.env.HDSZF_ENV_UPSTREAM_FAIL || 0) || 0);
const UP_WARN = Math.max(0, Number(process.env.HDSZF_ENV_UPSTREAM_WARN || 0) || 0);

const wlen = (s) => { let w = 0; for (const ch of String(s)) w += /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 2 : 1; return w; };
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - wlen(s)));

function emit(level, name, detail, hint) {
  ITEMS.push({ level, name, detail, hint: hint || '' });
  if (level === 'ok') N_OK++; else if (level === 'warn') N_WARN++; else if (level === 'fail') N_FAIL++;
  if (AS_JSON) return;
  if (level === 'ok' || level === 'note') { if (QUIET) return; }
  const mark = level === 'ok' ? `${C.g}✅${C.x}` : level === 'warn' ? `${C.y}⚠ ${C.x}`
    : level === 'fail' ? `${C.r}✗ ${C.x}` : `${C.d}· ${C.x}`;
  console.log(`  ${mark} ${pad(name, 13)} ${detail}`);
  if (hint && level !== 'note') console.log(`      → ${hint}`);
}
const ok = (n, d, h) => emit('ok', n, d, h);
const warn = (n, d, h) => emit('warn', n, d, h);
const fail = (n, d, h) => emit('fail', n, d, h);
const note = (n, d) => emit('note', n, d);
const grp = (t) => { if (!QUIET && !AS_JSON) console.log(`\n${C.b}${t}${C.x}`); };

// ---------------------------------------------------------------- 工具
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout || 12000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
  });
  return {
    ok: !r.error && r.status === 0,
    out: String(r.stdout || '').trim(),
    err: String(r.stderr || '').trim(),
    status: r.status,
    errCode: r.error && r.error.code,
  };
}
function which(bin) {
  const r = IS_WIN ? run('where', [bin], { timeout: 6000 }) : run('sh', ['-c', `command -v ${bin}`], { timeout: 6000 });
  if (!r.ok) return '';
  return r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
}
const git = (...args) => run('git', ['-C', ROOT, ...args]);
const dequote = (s) => String(s || '').replace(/^"(.*)"$/, '$1');

// ================================================================ 主流程
async function main() {
  if (!AS_JSON && !QUIET) {
    console.log(`${C.b}恒市值助手 · 环境体检${C.x}`);
    console.log(`${C.d}仓库 ${ROOT}${C.x}`);
    console.log(`${C.d}平台 ${process.platform} ${process.arch} · node ${process.version}${C.x}`);
  }

  const gitBin = which('git');

  // ---------------------------------------------------------------- 1. 运行时
  if (!NO_RUNTIME) {
    grp('1. 运行时（node / git / python3）');
    const major = Number(process.versions.node.split('.')[0]);
    if (major >= 18) ok('node', `${process.version} ≥ 18 · ${process.execPath}`);
    else fail('node', `${process.version} 过低（需要 18+）· ${process.execPath}`,
      '时区归一要 Node 16+，实时取数用全局 fetch 要 Node 18+ → 升到 18/20/22 LTS');

    if (gitBin) ok('git', dequote(run(gitBin, ['--version']).out));
    else fail('git', '找不到 git → 无法 commit/push，自动化全白跑',
      IS_WIN ? 'winget install --id Git.Git -e' : 'sudo apt-get install -y git');

    let py = '';
    for (const c of ['python3', 'python', 'py']) { if (which(c)) { py = c; break; } }
    if (py) ok('python', `${dequote(run(py, ['--version']).out || py)} · 仅月度定稿（finalize）取数用`);
    else warn('python', '找不到 python → 月度定稿取不到数（每交易日 MTD 不受影响）',
      IS_WIN ? 'winget install --id Python.Python.3.12 -e' : 'sudo apt-get install -y python3');
  }

  // ---------------------------------------------------------------- 2. 仓库
  grp('2. 仓库');
  if (!gitBin) {
    warn('仓库', '没有 git 命令，跳过仓库检查');
  } else if (!fs.existsSync(path.join(ROOT, '.git'))) {
    fail('仓库', `${ROOT} 不是 git 仓库`, '确认 clone 到了正确目录，或重新 clone');
  } else {
    const br = git('rev-parse', '--abbrev-ref', 'HEAD').out;
    if (br === 'main') ok('git 仓库', '分支 main');
    else warn('git 仓库', `当前分支 = ${br || '?'}（自动化推送的是 origin main）`, `git -C ${ROOT} switch main`);

    const origin = git('remote', 'get-url', 'origin').out;
    if (!origin) fail('origin', '没有配置 origin → 无法 push');
    else {
      ok('origin', origin);
      if (/^https:\/\//i.test(origin)) {
        warn('协议', 'HTTPS —— 无头服务器没有密码交互，push 必然失败',
          '改 SSH：git remote set-url origin git@github.com:xp13465/hdszf.git');
      } else if (/^(git@|ssh:\/\/)/i.test(origin)) {
        note('协议', 'SSH（需要免密 key，见下一节）');
      }
    }

    const email = git('config', 'user.email').out;
    const name = git('config', 'user.name').out;
    if (email && name) ok('git 身份', `${name} / ${email}`);
    else fail('git 身份', 'user.name / user.email 未配置 → commit 会被拒',
      'git config --global user.email sugas13465@gmail.com（user.name 同理）');

    const dirty = git('status', '--porcelain').out;
    if (!dirty) ok('工作区', '干净（定稿硬闸门通过）');
    else warn('工作区', `有未提交改动（${dirty.split(/\r?\n/).length} 项）→ finalize 会按硬闸门跳过`,
      `先 commit/stash：git -C ${ROOT} status --short`);

    if (fs.existsSync(RUNNER)) ok('运行器', 'crontab/run_job.js 存在');
    else fail('运行器', `找不到 ${RUNNER}`, '确认仓库完整（git pull）');
  }

  // ---------------------------------------------------------------- 3. 推送凭据
  grp('3. 推送凭据（无人值守最容易翻车的一步）');
  const originUrl = gitBin ? dequote(git('remote', 'get-url', 'origin').out) : '';
  if (/^(git@|ssh:\/\/)/i.test(originUrl)) {
    const ssh = which('ssh');
    if (!ssh) {
      fail('ssh 客户端', 'origin 是 SSH 但没有 ssh 命令 → 推送必然失败',
        IS_WIN ? '装 Git for Windows（自带 ssh）或 OpenSSH 客户端' : 'sudo apt-get install -y openssh-client');
    } else {
      ok('ssh 客户端', (run(ssh, ['-V']).err.split('\n')[0] || ssh).replace(/^"|"$/g, ''));
      const sshDir = path.join(os.homedir(), '.ssh');
      let keys = [];
      try { keys = fs.readdirSync(sshDir).filter((f) => /^id_/.test(f) && !f.endsWith('.pub')); } catch (e) { keys = []; }
      if (keys.length) ok('私钥', path.join(sshDir, keys[0]));
      else if (process.env.SSH_AUTH_SOCK) note('私钥', '走 ssh-agent（SSH_AUTH_SOCK 已设置）');
      else warn('私钥', '~/.ssh 下没有私钥 → SSH 认证会失败',
        'ssh-keygen -t ed25519 生成后把公钥加到 GitHub 仓库 Deploy keys（勾 Allow write access）');

      const kh = path.join(sshDir, 'known_hosts');
      let known = false;
      try { known = fs.readFileSync(kh, 'utf8').includes('github'); } catch (e) { known = false; }
      if (known) ok('known_hosts', '含 github.com 指纹');
      else warn('known_hosts', '没有 github.com 指纹 → 首次连接会卡在交互确认，cron 里直接失败',
        `ssh-keyscan github.com >> ${kh} 然后 ssh -T git@github.com 自测`);
    }
  }
  if (NO_NET) note('远程可达', '跳过（--no-network）');
  else if (gitBin) {
    const r = run(gitBin, ['-C', ROOT, 'ls-remote', 'origin', 'main'], { timeout: 30000 });
    if (r.ok) ok('远程可达', 'git ls-remote origin main 成功（推送凭据可用）');
    else fail('远程可达', 'git ls-remote origin main 失败 → 取数能成功但 push 失败，自动化白跑',
      '自测：ssh -T git@github.com（应返回 successfully authenticated）');
  }

  // ---------------------------------------------------------------- 4. 网络
  grp('4. 网络（数据源 + GitHub）');
  if (NO_NET) {
    note('联网检查', '跳过（--no-network）');
  } else if (typeof fetch !== 'function') {
    warn('联网检查', '当前 node 没有全局 fetch（需要 18+），跳过');
  } else {
    const probe = async (url, referer) => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', ...(referer ? { Referer: referer } : {}) },
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });
        return res.status;
      } catch (e) { return 0; }
    };
    const SINA = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData'
      + '?symbol=sh510300&scale=240&ma=no&datalen=5&adj=qfq';
    const sinaCode = await probe(SINA, 'https://finance.sina.com.cn');
    if (sinaCode === 200) ok('新浪行情', 'HTTP 200（取数接口可达）');
    else fail('新浪行情', `HTTP ${sinaCode || '连接失败'}`,
      '取不到数会走降级：不发布任何本月数据，站点回退已定稿口径');

    const ghCode = await probe('https://github.com');
    if (ghCode >= 200 && ghCode < 400) ok('GitHub', `HTTP ${ghCode}（HTTPS 可达）`);
    else note('GitHub', `HTTPS ${ghCode || '超时/失败'}（仅供参考：推送走 SSH 22 端口，与 HTTPS 不同链路，以「远程可达」为准）`);
  }

  // ---------------------------------------------------------------- 5. 时间与时区
  grp('5. 时间与时区（闸门按北京时间判断）');
  const sysTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || '?';
  const offH = -new Date().getTimezoneOffset() / 60;
  note('系统时区', `${sysTZ} · UTC${offH >= 0 ? '+' : ''}${offH}`);
  if (offH === 8) ok('偏移', 'UTC+8，与北京时间一致');
  else warn('偏移', `UTC${offH >= 0 ? '+' : ''}${offH} ≠ UTC+0800（云服务器常见 UTC）`,
    '不用改系统设置：run_job.js / status.js / 业务脚本都有 TZ-GUARD，会强制按 Asia/Shanghai 判断「18:00 后 / 每月 3 日后」');
  note('当前北京时间', new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' '));

  // ---------------------------------------------------------------- 6. 日志目录与磁盘
  grp('6. 日志目录与磁盘');
  const rel = path.relative(ROOT, LOG_DIR);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    fail('日志目录', `在仓库里（${LOG_DIR}）`,
      `仓库根是 Cloudflare Assets 的发布目录，日志会被公开上传并污染 git；换到仓库外，例如 ${FALLBACK_LOG_DIR}`);
  } else {
    const probeDir = fs.existsSync(LOG_DIR) ? LOG_DIR : path.dirname(LOG_DIR);
    let writable = true;
    try { fs.accessSync(probeDir, fs.constants.W_OK); } catch (e) { writable = false; }
    if (writable) {
      ok('日志目录', fs.existsSync(LOG_DIR)
        ? `${LOG_DIR}（已存在、可写）`
        : `${LOG_DIR}（尚不存在，父目录可写 → 会自动创建）`);
    } else {
      fail('日志目录', `${probeDir} 不可写`, 'chown/chmod 一下，或用 HDSZF_LOG_DIR 指到别处');
    }
  }
  if (typeof fs.statfsSync === 'function') {
    try {
      const st = fs.statfsSync(ROOT);
      const freeMB = Math.round((st.bavail * st.bsize) / 1048576);
      if (freeMB < 200) warn('磁盘可用', `仅 ${freeMB} MB（低于 200MB）`, 'git 全量 + 日志可能写不下，先清理');
      else ok('磁盘可用', `${freeMB} MB`);
    } catch (e) { /* 某些挂载点不支持 statfs，忽略 */ }
  }

  // ---------------------------------------------------------------- 7. 调度器条目
  grp('7. 调度器条目');
  if (IS_WIN) {
    const r1 = run('schtasks', ['/query', '/tn', 'hdszf-mtd', '/fo', 'LIST'], { timeout: 10000 });
    const r2 = run('schtasks', ['/query', '/tn', 'hdszf-finalize', '/fo', 'LIST'], { timeout: 10000 });
    if (r1.errCode === 'ENOENT') {
      note('计划任务', '本机没有 schtasks 命令，无法查询');
    } else if (r1.ok && r2.ok) {
      ok('计划任务', 'hdszf-mtd + hdszf-finalize 都已注册');
    } else if (!r1.ok && !r2.ok) {
      if (/拒绝|denied|禁止|策略|block/i.test(r1.err + r1.out)) {
        warn('计划任务', 'schtasks 被安全策略拦截，查询不到（不代表没注册）',
          '用「任务计划程序」图形界面确认；或直接把自动化放到 Linux 云服务器');
      } else {
        note('计划任务', '尚未注册 → 跑 crontab\\install.cmd');
      }
    } else {
      note('计划任务', `只注册了一个（mtd=${r1.ok ? '有' : '无'} finalize=${r2.ok ? '有' : '无'}）`);
    }
  } else {
    const r = run('crontab', ['-l'], { timeout: 8000 });
    if (r.ok && r.out.includes('hdszf automation')) ok('cron 条目', 'crontab 里已有 hdszf 段（重复跑 install.sh 会幂等覆盖）');
    else if (r.errCode === 'ENOENT') fail('cron 条目', '找不到 crontab 命令 → 定时任务无法注册', 'sudo apt-get install -y cron');
    else note('cron 条目', '还没有 hdszf 段 → 跑 crontab/install.sh 写入');
  }

  // ---------------------------------------------------------------- 汇总（含引导层）
  const totFail = N_FAIL + UP_FAIL;
  const totWarn = N_WARN + UP_WARN;
  const upNote = UP_FAIL + UP_WARN > 0 ? `（含引导层 ${UP_FAIL} 阻塞 / ${UP_WARN} 警告）` : '';
  if (AS_JSON) {
    process.stdout.write(JSON.stringify({
      ok: totFail === 0,
      counts: { ok: N_OK, warn: totWarn, fail: totFail, upstream: { fail: UP_FAIL, warn: UP_WARN } },
      items: ITEMS,
    }, null, 2) + '\n');
  } else {
    console.log(`\n${C.b}──────────────────────────────────────────${C.x}`);
    if (totFail > 0) {
      console.log(`${C.r}✗ 阻塞 ${totFail} 项 / ⚠ 警告 ${totWarn} 项 → 先修阻塞项，再装调度器${upNote}${C.x}`);
      if (!QUIET && !IS_WIN) console.log('\n  · 有 sudo 的话可以直接：bash crontab/check_env.sh --fix');
    } else if (totWarn > 0) {
      console.log(`${C.y}⚠ 无阻塞项，但有 ${totWarn} 条警告值得看一眼${upNote}${C.x}`);
    } else {
      console.log(`${C.g}✅ 全部通过（${N_OK} 项）${C.x}`);
    }
  }
  process.exit(totFail > 0 ? 1 : 0);
}

main();
