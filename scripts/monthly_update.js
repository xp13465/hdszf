#!/usr/bin/env node
/**
 * 恒市值助手 · 月度数据一键更新
 *
 * 把 RELEASE_CHECKLIST 的全流程串成一条命令：
 *   取数 → 重算派生 → 收口月 → 版本号 bump → 静态文案 → 文档 → 差异报告
 *   → 刷新进行中快照(progress.json) → 自检 → commit → push
 *
 * 用法：
 *   node scripts/monthly_update.js --dry-run            只打印将要执行的替换，不改任何文件
 *   node scripts/monthly_update.js --no-push            改文件 + commit，但不 push（人工复核后再推）
 *   node scripts/monthly_update.js                      全自动：改文件 + commit + push
 *   node scripts/monthly_update.js --target 2026-09     指定目标日历月（默认自动推断 = 当前末位 + 1）
 *   node scripts/monthly_update.js --strict             任一条替换规则未命中即视为失败
 *
 * 安全边界（防呆）：
 *   - 目标月未走完（数据源最后交易日仍在该月内、或今天还没进入次月）→ 直接退出，绝不写入
 *   - smoke_check.js / recompute_derived.js --check 任一失败 → 不 commit、不 push
 *   - 取数脚本返回任何 NaN / 缺失资产 → 中止
 *
 * 设计原则：所有替换正则都与「具体数字」无关，只匹配数字形态，
 *           替换值全部来自引擎实时计算，因此下个月再跑依然有效。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const P = (s = '') => console.log(s);

// ---------------- 参数 ----------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const DRY = has('--dry-run');
const NO_PUSH = has('--no-push');
const STRICT = has('--strict');
const TARGET_ARG = arg('target', null);

let missCount = 0; // 未命中的替换规则数

// ---------------- 工具 ----------------
function read(f) {
  return fs.readFileSync(path.join(ROOT, f), 'utf8');
}
function write(f, s) {
  if (DRY) return;
  fs.writeFileSync(path.join(ROOT, f), s, 'utf8');
}

/**
 * 通用替换：用正则匹配，命中则替换，未命中则警告。
 * @param {string} file   相对 ROOT 的路径
 * @param {RegExp} re     必须与具体数字无关
 * @param {string|Function} to  替换串或 (match)=>string
 * @param {string} desc   人类可读说明
 */
function sub(file, re, to, desc) {
  const before = read(file);
  // 先判断「正则是否命中」，而不是「替换后是否变化」——
  // 值恰好没变时（如 dry-run 演练）也应算命中，否则会全量误报
  const m = before.match(re);
  if (!m) {
    missCount++;
    P(`  ⚠ 未命中 [${file}] ${desc}`);
    return false;
  }
  const after = before.replace(re, to);
  write(file, after);
  const old = m[0].replace(/\s+/g, ' ').slice(0, 60);
  const neu = (typeof to === 'function' ? to(...m) : m[0].replace(re, to)).replace(/\s+/g, ' ').slice(0, 60);
  P(`  ✓ [${file}] ${desc}${old !== neu ? `\n       ${old}  →  ${neu}` : '  (值未变)'}`);
  return true;
}

function bumpVer(file, asset) {
  const re = new RegExp(`(${asset.replace('.', '\\.')}\\?v=)(\\d+)`);
  const src = read(file);
  const m = re.exec(src);
  if (!m) {
    missCount++;
    P(`  ⚠ 未命中 [${file}] 版本号 ${asset}`);
    return;
  }
  const next = parseInt(m[2], 10) + 1;
  write(file, src.replace(re, `$1${next}`));
  P(`  ✓ [${file}] 版本号 ${asset} v${m[2]} → v${next}`);
}

function must(cmd, args, desc) {
  P(`  → ${desc}`);
  if (DRY) {
    P(`     [dry-run] ${cmd} ${args.join(' ')}`);
    return '';
  }
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
}

// ---------------- 加载引擎取动态值 ----------------
function loadCtx() {
  const ctx = { console, Math, Date, JSON, parseFloat, parseInt, isNaN, Number, String, Object, Array };
  vm.createContext(ctx);
  for (const f of ['js/data.js', 'js/engine.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return ctx;
}
const peek = (ctx, expr) => vm.runInContext(expr, ctx);

// ---------------- 1. 当前状态与目标月 ----------------
P('\n=== 阶段 1 · 确定目标月 ===');
const ctx0 = loadCtx();
const rr0 = peek(ctx0, 'APP_DATA.realReturns');
const lastLabel = rr0.months[rr0.months.length - 1];
const nBefore = rr0.asset_returns['沪深300'].length;
P(`  当前末位标签 : ${lastLabel}`);
P(`  当前收益条数 : ${nBefore}`);

function addMonth(ym, k) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const TARGET = TARGET_ARG || addMonth(lastLabel, 1);
P(`  目标日历月   : ${TARGET}${TARGET_ARG ? '（命令行指定）' : '（自动推断）'}`);

// ---------------- 2. 数据源完整性校验 ----------------
P('\n=== 阶段 2 · 校验目标月是否已结束 ===');
const PY = findPython();
function findPython() {
  for (const c of ['python', 'py', 'python3']) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch (e) { /* try next */ }
  }
  return 'C:/Users/23405/.workbuddy/binaries/python/versions/3.13.12/python.exe';
}

const probe = `
import json, urllib.request
url=('https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/'
     'CN_MarketData.getKLineData?symbol=sh510300&scale=240&ma=no&datalen=5&adj=qfq')
req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0','Referer':'https://finance.sina.com.cn'})
d=json.load(urllib.request.urlopen(req, timeout=40))
print(d[-1]['day'])
`;
let lastTradeDay;
try {
  lastTradeDay = execFileSync(PY, ['-c', probe], { encoding: 'utf8', stdio: 'pipe' }).trim();
} catch (e) {
  P('  ✗ 无法访问数据源，中止。');
  process.exit(1);
}
const today = new Date();
const todayYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
P(`  今天         : ${todayYM}`);
P(`  数据源最后交易日: ${lastTradeDay}`);

const monthDone = todayYM > TARGET && lastTradeDay.slice(0, 7) >= TARGET;
if (!monthDone) {
  P(`\n  ✗ 目标月 ${TARGET} 尚未走完。`);
  P(`    判据：今天(${todayYM}) 需晚于目标月，且数据源最后交易日(${lastTradeDay.slice(0, 7)}) 需已覆盖目标月。`);
  if (!DRY) {
    P('    → 不更新，正常退出（自动化周期性调用时不应报警）。');
    process.exit(0);
  }
  P('    → [dry-run] 仅演练后续替换逻辑，不会写任何文件。');
} else {
  P('  ✓ 目标月已结束，可以更新');
}

// ---------------- 3. 取数 ----------------
P('\n=== 阶段 3 · 取数（fetch_returns.py --write） ===');
const fetchOut = must(PY, ['scripts/fetch_returns.py', '--target', TARGET, '--write'], '取数并写入双数据源');
if (!DRY) {
  P(fetchOut.split('\n').filter(Boolean).map((l) => '    ' + l).join('\n'));
  // 防呆：校验确实新增了一条，且无 NaN
  const c1 = loadCtx();
  const rr1 = peek(c1, 'APP_DATA.realReturns');
  const nAfter = rr1.asset_returns['沪深300'].length;
  if (nAfter !== nBefore + 1) {
    P(`  ✗ 收益条数未从 ${nBefore} 增至 ${nBefore + 1}（实为 ${nAfter}），中止。`);
    process.exit(1);
  }
  if (rr1.months[rr1.months.length - 1] !== TARGET) {
    P(`  ✗ 末位标签应为 ${TARGET}，实为 ${rr1.months[rr1.months.length - 1]}，中止。`);
    process.exit(1);
  }
  for (const a of Object.keys(rr1.asset_returns)) {
    const v = rr1.asset_returns[a][rr1.asset_returns[a].length - 1];
    if (typeof v !== 'number' || Number.isNaN(v)) {
      P(`  ✗ ${a} 新增值为 NaN，中止。`);
      process.exit(1);
    }
  }
  P(`  ✓ 收益条数 ${nBefore} → ${nAfter}，末位标签 ${TARGET}，五资产数值均有效`);
}

// ---------------- 4. 重算派生字段 ----------------
P('\n=== 阶段 4 · 重算写死的派生字段 ===');
must(process.execPath, ['scripts/recompute_derived.js'], '重算 comparisons + finalConfig.backtest');

// ---------------- 5. 取更新后的动态值 ----------------
const ctx = loadCtx();
const rr = peek(ctx, 'APP_DATA.realReturns');
const BE = peek(ctx, 'BacktestEngine');
const N = rr.asset_returns['沪深300'].length;
const END_LABEL = rr.months[rr.months.length - 1];
const START_LABEL = rr.months[0];
const [sY, sM] = START_LABEL.split('-').map(Number);
const [eY, eM] = END_LABEL.split('-').map(Number);

const R = {};
for (const id of ['conservative', 'balanced', 'aggressive']) {
  R[id] = BE.simulateCMV(BE.PLANS[id]);
}
const B = R.balanced;
const N_AFTER = N;

// 各资产独立年化（供 PROJECT_SPEC 1.4）
const assetCagr = {};
for (const a of Object.keys(rr.asset_returns)) {
  const arr = rr.asset_returns[a];
  const cum = arr.reduce((s, v) => s * (1 + v), 1);
  assetCagr[a] = ((Math.pow(cum, 12 / arr.length) - 1) * 100);
}

const V = {
  n: N_AFTER,
  // 累计月序（1-based，含入场月）—— 用户 2026-09-29 拍板的口径，必须与 js/main.js
  // 的 totalMonths（Hero「90 / N月」、指标卡「总收益（N个月）」）一致 = 收益条数 + 1。
  // 注意与 V.n 区分：V.n 是「数据窗口 / 收益条数」（用在数据范围文案里），
  // V.nCum 是「累计月序」（用在月胜率分母、总收益标签里）。两者相差 1，别混用。
  nCum: N_AFTER + 1,
  endCN: `${eY}年${eM}月`,
  startCN: `${sY}年${sM}月`,
  startLabel: START_LABEL,
  endLabel: END_LABEL,
  finalWan: (B.finalValue / 10000).toFixed(1),
  annual1: B.annual.toFixed(1),
  annual2: B.annual.toFixed(2),
  dd1: Math.abs(B.maxDd).toFixed(1),
  dd2: B.maxDd.toFixed(2),
  sharpe2: B.sharpe.toFixed(2),
  wr1: (B.monthlyWinRate * 100).toFixed(1),
  wr2: (B.monthlyWinRate * 100).toFixed(2),
  posMonths: B.positiveMonths,
  todayCN: `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`,
  todayISO: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
};
P(`\n  动态基准值：年化 ${V.annual2}% / 终值 ${V.finalWan}万 / 回撤 ${V.dd2}% / 夏普 ${V.sharpe2} / 月胜率 ${V.wr2}%（${V.posMonths}/${V.n}）`);

// ---------------- 6. 收口月 ----------------
P('\n=== 阶段 5 · 滚动表收口月 ===');
sub('js/rolling.js', /endYear:\s*\d+/, `endYear: ${eY}`, 'CONFIG.endYear');
sub('js/rolling.js', /endMonth:\s*\d+/, `endMonth: ${eM}`, 'CONFIG.endMonth');
sub('js/main.js', /(actualEndDate\s*[:=]\s*['"])\d{4}-\d{2}(['"])/, `$1${END_LABEL}$2`, 'actualEndDate');

// ---------------- 7. 版本号 bump ----------------
P('\n=== 阶段 6 · 版本号 bump（绕过 CDN 缓存）===');
bumpVer('index.html', 'data.js');
bumpVer('index.html', 'rolling.js');
bumpVer('index.html', 'main.js');

// ---------------- 8. 静态文案 ----------------
P('\n=== 阶段 7 · index.html 静态文案 ===');
sub('index.html', /(id="hero-final-value">)[\d.]+万(<)/, `$1${V.finalWan}万$2`, 'Hero 终值');
sub('index.html', /(11年(?:翻倍|增长|亏损) · 年化)[\d.]+(%)/, `$1${V.annual1}$2`, 'Hero 年化');
sub('index.html', /(id="hero-winrate-label">[^<]*?月胜率\s*)[\d.]+(%)/, `$1${V.wr1}$2`, 'Hero 月胜率');
sub('index.html', /(id="hero-winrate-value">)\s*\d+\s*\/\s*\d+月(<)/, `$1${V.posMonths} / ${V.nCum}月$2`, 'Hero 月胜率 x/y（累计月序=收益条数+1）');
sub('index.html', /(id="hero-dd-value">)-?[\d.]+(%<)/, `$1${B.maxDd.toFixed(1)}$2`, 'Hero 最大回撤');
sub('index.html', /(og:description" content="[^"]*?年化)[\d.]+(%[^"]*?最大回撤仅)[\d.]+(%)/, `$1${V.annual1}$2${V.dd1}$3`, 'og:description');
sub('index.html', /(og:image:alt" content="[^"]*?年化)[\d.]+(%\s*回撤)[\d.]+(%)/, `$1${V.annual1}$2${V.dd1}$3`, 'og:image:alt');
sub('index.html', /\d+个月真实数据验证/, `${V.n}个月真实数据验证`, 'Hero 月数');
sub('index.html', /\d+个月（约11年）历史回测数据/, `${V.n}个月（约11年）历史回测数据`, 'section-subtitle 月数');
sub('index.html', /(\d{4})年(\d{1,2})月\s*—\s*(\d{4})年(\d{1,2})月，共\s*<strong>\d+个月<\/strong>/,
  `${V.startCN} — ${V.endCN}，共 <strong>${V.n}个月</strong>`, '回测时间跨度');
sub('index.html', /总收益（\d+个月）/, `总收益（${V.nCum}个月）`, '总收益标签（累计月序=收益条数+1）');
sub('index.html', /(\d{4})年(\d{1,2})月\s*~\s*(\d{4})年(\d{1,2})月（\d+个月）真实市场数据回测/,
  `${V.startCN} ~ ${V.endCN}（${V.n}个月）真实市场数据回测`, 'insight-box 数据说明');
sub('index.html', /保守型年化\s*[\d.]+%（回撤\s*-?[\d.]+%）/,
  `保守型年化 ${R.conservative.annual.toFixed(2)}%（回撤 ${R.conservative.maxDd.toFixed(2)}%）`, 'insight-box 保守型');
sub('index.html', /稳健型年化\s*[\d.]+%（回撤\s*-?[\d.]+%）/,
  `稳健型年化 ${R.balanced.annual.toFixed(2)}%（回撤 ${R.balanced.maxDd.toFixed(2)}%）`, 'insight-box 稳健型');
sub('index.html', /进取型年化\s*[\d.]+%（回撤\s*-?[\d.]+%）/,
  `进取型年化 ${R.aggressive.annual.toFixed(2)}%（回撤 ${R.aggressive.maxDd.toFixed(2)}%）`, 'insight-box 进取型');
sub('index.html', /与\d+个月回测验证的推荐配置\s*·\s*年化[\d.]+%\s*·\s*回撤-?[\d.]+%\s*·\s*夏普[\d.]+/,
  `与${V.n}个月回测验证的推荐配置 · 年化${V.annual2}% · 回撤${V.dd2}% · 夏普${V.sharpe2}`, '最终方案副标题');
sub('index.html', /(\d{4})年(\d{1,2})月至(\d{4})年(\d{1,2})月共\d+个月/,
  `${V.startCN}至${V.endCN}共${V.n}个月`, 'SEO 数据范围');
sub('index.html', /(11年回测年化收益)[\d.]+(%[^<]*?最大回撤仅)[\d.]+(%)/, `$1${V.annual1}$2${V.dd1}$3`, 'SEO 隐藏段');
sub('index.html', /(<strong>最后更新日期：<\/strong>)\d{4}年\d{1,2}月\d{1,2}日/, `$1${V.todayCN}`, '隐私政策/用户协议日期戳');

// ---------------- 9. 文档 ----------------
P('\n=== 阶段 8 · 文档同步 ===');
// README 数据范围（两种写法：中文带空格 / 短横线带逗号）
sub('README.md', /(\d{4})\s*年\s*(\d{1,2})\s*月至\s*(\d{4})\s*年\s*(\d{1,2})\s*月共\s*\d+\s*个月/,
  `${sY} 年 ${sM} 月至 ${eY} 年 ${eM} 月共 ${V.n} 个月`, 'README 数据范围（正文）');
sub('README.md', /\d+\s*个月的真实收益数据/, `${V.n} 个月的真实收益数据`, 'README 数据范围（副句）');
sub('README.md', /（\d+\s*个月收益、基金净值、三档对比）/, `（${V.n} 个月收益、基金净值、三档对比）`, 'README 文件树月数');
sub('README.md', /(\d{4})-(\d{2})\s*至\s*(\d{4})-(\d{2})，共\s*\d+\s*个月/,
  `${V.startLabel} 至 ${V.endLabel}，共 ${V.n} 个月`, 'README 数据源月数');
// README 三档表：整行重建（列序 方案|年化|回撤|Sharpe|Sortino|终值|月胜率；稳健型带 ** 加粗）
for (const [id, cn] of [['conservative', '保守'], ['balanced', '稳健'], ['aggressive', '进取']]) {
  const r = R[id];
  const bold = id === 'balanced';
  const w = (s) => (bold ? `**${s}**` : s);
  const cells = [
    w(`${r.annual.toFixed(2)}%`),
    w(`${r.maxDd.toFixed(2)}%`),
    w(r.sharpe.toFixed(2)),
    w(r.sortino.toFixed(2)),
    w(`${(r.finalValue / 10000).toFixed(1)} 万`),
    w(`${(r.monthlyWinRate * 100).toFixed(1)}%`)
  ].join(' | ');
  sub('README.md',
    new RegExp(`\\|(\\s*\\*{0,2}${cn}型\\*{0,2}\\s*\\|)[^|\\n]*\\|[^|\\n]*\\|[^|\\n]*\\|[^|\\n]*\\|[^|\\n]*\\|[^|\\n]*\\|`),
    `|$1 ${cells} |`,
    `README 三档表 ${cn}型`);
}
sub('PROJECT_SPEC.md', /\|\s*月度数据范围\s*\|\s*[\d-]+\s*~\s*[\d-]+（\d+个完整月[^）]*）\s*\|/,
  `| 月度数据范围 | ${V.startLabel} ~ ${V.endLabel}（${V.n}个完整月，日历覆盖 ${rr.months[1]} ~ ${V.endLabel}） |`,
  'PROJECT_SPEC 1.1 数据范围');
for (const a of Object.keys(assetCagr)) {
  sub('PROJECT_SPEC.md',
    new RegExp(`\\|\\s*${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*[\\d.]+%`),
    `| ${a} | ${assetCagr[a].toFixed(2)}%`, `PROJECT_SPEC 1.4 ${a} 年化`);
}
sub('sitemap.xml', /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, `<lastmod>${V.todayISO}</lastmod>`, 'sitemap lastmod');
sub('CODEBUDDY.md', /最后更新:\s*[\d-]+（[^）]*）/, `最后更新: ${V.todayISO}（数据刷新至日历 ${V.endLabel}，${V.n} 个月）`, 'CODEBUDDY 头部日期');
sub('CODEBUDDY.md', /(\|\s*data\.js\s*\|\s*v=)\d+/, `$1${verOf('data.js')}`, 'CODEBUDDY 版本表 data.js');
sub('CODEBUDDY.md', /(\|\s*rolling\.js\s*\|\s*v=)\d+/, `$1${verOf('rolling.js')}`, 'CODEBUDDY 版本表 rolling.js');
sub('CODEBUDDY.md', /(\|\s*main\.js\s*\|\s*v=)\d+/, `$1${verOf('main.js')}`, 'CODEBUDDY 版本表 main.js');

function verOf(asset) {
  const m = new RegExp(`${asset.replace('.', '\\.')}\\?v=(\\d+)`).exec(read('index.html'));
  return m ? m[1] : '?';
}

// ---------------- 10. 差异报告 ----------------
P('\n=== 阶段 9 · 生成新旧差异报告 ===');
const reportPath = `scripts/data_update_report_${TARGET}.md`;
must(process.execPath, ['scripts/diff_data_update.js', '--md', reportPath], `输出 ${reportPath}`);

// ---------------- 10.5 刷新进行中快照 ----------------
// 为什么必须在这里做（踩坑记录，改动前必读）：
//   progress.json 的 base_month 原来指向「上一个完整月」，status 为 in_progress:true。
//   本次定稿把 TARGET 月写进 data.js 后，progress.json 立刻变成「过期快照」——
//   它的月份已经出现在 months 里、base_month 也不再等于主数据末月。
//   smoke_check.js 第 7 项会因此 FAIL，而下面阶段 10 遇 FAIL 会「不 commit、不 push」，
//   于是整个月度定稿在自检阶段被自己的旧快照卡死（2026-10-03 起必然触发）。
//   所以定稿后必须立刻把快照滚到「新的进行中月」= nextMonthLabel(新末月)。
// 容错：取数降级（任一风险资产失败或全部失败）时 monthly_progress.js 退出码为 2，
//       写入的是「估算字段全为 null」的降级占位（绝不写 MTD=0，那会伪造「当月持平」），
//       此时 JSON 结构仍合法（in_progress:true / base_month==末月 / 月份不在 months 里 /
//       degraded:true），故按「成功但降级」处理，只告警不中断；前端会自动回退到固化口径。
P('\n=== 阶段 9.5 · 刷新进行中月份快照 (js/progress.json) ===');
if (DRY) {
  P('  [dry-run] 跳过 monthly_progress.js');
} else {
  let snapOk = true;
  try {
    execFileSync(process.execPath, ['scripts/monthly_progress.js'], { cwd: ROOT, stdio: 'pipe' });
    P('  ✓ progress.json 已滚动到新的进行中月份（实时取数成功）');
  } catch (e) {
    const code = typeof e.status === 'number' ? e.status : -1;
    if (code === 2) {
      P('  ⚠ progress.json 降级：取数不完整 → 已写「估算字段全为 null」的占位（站点回退到固化口径，不会显示假数字）');
      P('     建议稍后手工重跑 node scripts/monthly_progress.js --push 恢复当月估算。');
    } else {
      snapOk = false;
      P(`  ✗ monthly_progress.js 异常退出 (code=${code})`);
      P((e.stderr || e.stdout || '').toString().split('\n').slice(-10).join('\n'));
    }
  }
  if (!snapOk) {
    P('  → 快照刷新失败会导致 smoke_check 第 7 项 FAIL。请先修好 progress.json 再定稿：');
    P('     node scripts/monthly_progress.js');
    process.exit(1);
  }
}

// ---------------- 11. 自检 ----------------
P('\n=== 阶段 10 · 自检 ===');if (DRY) {
  P('  [dry-run] 跳过 smoke_check / recompute --check / git');
} else {
  let ok = true;
  try {
    execFileSync(process.execPath, ['scripts/smoke_check.js'], { cwd: ROOT, stdio: 'pipe' });
    P('  ✓ smoke_check.js 通过');
  } catch (e) {
    ok = false;
    P('  ✗ smoke_check.js 失败 → 不 commit、不 push');
    P((e.stdout || '').toString().split('\n').slice(-15).join('\n'));
  }
  try {
    execFileSync(process.execPath, ['scripts/recompute_derived.js', '--check'], { cwd: ROOT, stdio: 'pipe' });
    P('  ✓ recompute_derived.js --check 通过');
  } catch (e) {
    ok = false;
    P('  ✗ recompute_derived.js --check 失败 → 不 commit、不 push');
  }
  if (STRICT && missCount > 0) {
    ok = false;
    P(`  ✗ 有 ${missCount} 条替换规则未命中（--strict 视为失败）`);
  }
  if (!ok) process.exit(1);

  // ---------------- 12. git ----------------
  P('\n=== 阶段 11 · 提交 ===');
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  git(['add', '-A']);
  const msg = [
    `data: 滚动回测更新至 ${TARGET}（${V.n} 个月）`,
    '',
    `由 scripts/monthly_update.js 自动生成`,
    `新增日历 ${TARGET} 真实月收益，数据窗口 ${V.n} 个月（${V.startLabel} ~ ${V.endLabel}）`,
    `稳健型：年化 ${V.annual2}% / 终值 ${V.finalWan}万 / 夏普 ${V.sharpe2} / 回撤 ${V.dd2}% / 月胜率 ${V.wr2}%（${V.posMonths}/${V.n}）`,
    `三档：保守 ${R.conservative.annual.toFixed(2)}% / 稳健 ${R.balanced.annual.toFixed(2)}% / 进取 ${R.aggressive.annual.toFixed(2)}%`,
    `差异报告：${reportPath}`,
    `进行中快照：js/progress.json 已滚动至新进行中月（同 commit 一起上线，避免旧快照让回测口径自相矛盾）`,
    '',
    `验证：smoke_check 全 PASS；recompute_derived --check 静态≈动态`
  ].join('\n');
  try {
    git(['commit', '-m', msg]);
    P('  ✓ 已 commit');
  } catch (e) {
    P('  · 无改动可提交（git commit 返回非零）');
  }
  if (NO_PUSH) {
    P('  · --no-push：跳过推送');
  } else {
    git(['push', 'origin', 'main']);
    const tip = git(['ls-remote', 'origin', 'main']).trim().split('\t')[0];
    const local = git(['rev-parse', 'HEAD']).trim();
    if (tip === local) {
      P(`  ✓ 已 push，远程 tip 已核对 ${tip.slice(0, 7)}`);
    } else {
      P(`  ✗ push 后远程 tip(${tip.slice(0, 7)}) ≠ 本地 HEAD(${local.slice(0, 7)})，请人工核查`);
      process.exit(1);
    }
  }
}

P(`\n完成。${DRY ? '[dry-run 未改任何文件]' : ''}${missCount ? ` 未命中规则 ${missCount} 条（见上方 ⚠）` : ' 全部规则命中'}`);
