#!/usr/bin/env node
/**
 * 恒市值助手 · 进行中月份进度快照
 *
 * 用途：每周 / 每个交易日跑一次，取「当前未完成月」的月至今(MTD)收益，
 *       把最新完整月(2026-08)的组合持仓往前推一步，给出本月至今（MTD）的组合进度。
 *
 * 关键约束：本脚本【绝不写】js/data.js / js/real_returns.json，不污染主回测口径。
 *           它只读取最新完整月的组合状态 + 实时行情，输出一份「进行中」标记的报告。
 *           真正的月度定稿仍由 monthly_update.js（每月 3 号）负责。
 *
 * 数据来源：新浪财经前复权日K线（与 fetch_returns.py 同源），MTD = 本月至今收盘 / 上月末收盘 - 1。
 *
 * 用法：
 *   node scripts/monthly_progress.js               实时取数 + 输出进度快照（默认打印到 stdout）
 *   node scripts/monthly_progress.js --out 报告.md 同时把报告写入文件
 *   node scripts/monthly_progress.js --no-fetch    不联网（离线/测试），MTD 记为 0，仅展示结构
 *   node scripts/monthly_progress.js --self-test   只跑内置回归自检（18 项）后退出，不取数、不写文件
 *
 * 降级闸门（重要，2026-09-29 加）：
 *   progress.json 的 MTD 会被前端 live overlay 叠加成全站「本月至今」口径（Hero / 三档卡 / 指标卡 / 滚动汇总表与明细块），
 *   所以【任何】风险资产取数失败都判定为 degraded，此时：
 *     - 所有随行情变化的字段写成 null（不是 0）→ null = 无数据，0 = 伪造的「当月持平」；
 *     - 现有快照身份仍有效（进行中月未定稿 + 基准月 = 主数据末月）→ 完全不写、不推送，保留上一版真实快照；
 *     - 身份已失效（月末定稿把该月写进了 months）→ 写 null 占位把身份推进，避免卡住定稿流程；
 *     - 前端识别 degraded 后一律不展示本月至今数据，自动回退到已定稿口径。
 *   绝不允许把「MTD=0」当作本月至今数据发布到线上（项目铁律：不凭空造月收益）。
 *
 * 退出码：0 正常（含 --no-fetch 的离线结构自检）；2 降级（本次未发布任何本月至今数据，需重跑）。
 */
'use strict';

// ---------------------------------------------------------------- TZ-GUARD（时区归一）
// 本脚本里的「今天 / 当前月」必须按**北京时间**算（A 股月历就是北京时间）。
// 若部署在 UTC 的云服务器上又没归一，「今天」会在凌晨算成前一天 → MTD 日期与所属月份错位。
// 与 crontab/run_job.js 同源：改这里请一并改（全仓搜 TZ-GUARD）。
process.env.TZ = process.env.HDSZF_TZ || 'Asia/Shanghai';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (n) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const NO_FETCH = has('--no-fetch');
const OUT = arg('out');
const NO_JSON = has('--no-json');
const JSON_OUT = arg('json') || 'js/progress.json';
const PUSH = has('--push');

// 推送（发布）是否失败：push 被拒时置位，让退出码带上「数据已生成但未上线」的语义。
// 为什么必须置位：push 失败若只打警告、不影响退出码，运行器会把本次记成「成功」并关掉当天的
// 重试闸门 —— 数据永远上不了线却毫无告警，是完全静默的卡死（2026-09-30 实测踩到）。
let PUBLISH_FAILED = false;

// ---------------------------------------------------------------- --self-test（回归守卫）
// 2026-10-02 的真实 bug：现金 MTD 的**分子用了「今天在日历上的日号」，分母却用「进行中月」的天数**。
// 数据末月常年落后日历 1 个月（日历 10-02、数据末月 2026-08 → 进行中月 2026-09 已走完），
// 于是 9 月的现金 MTD 被算成 2/30 → 凭空缩水 ~560 元、组合 MTD 被压低 ~0.11pp。
// 下面把「跨月窗口内必须恒为满月」钉死，防止回归。
// 2026-10-03 补：同时钉死 computeMTD 的**诊断文案**（长假"无交易日"必须与真故障分开），
// 起因是国庆首日 5 个资产全报「daily is not iterable」，把真实原因盖成了假故障。
if (has('--self-test')) {
  const cases = [];
  const eq = (name, got, want) => {
    const ok = (typeof want === 'number' && typeof got === 'number')
      ? Math.abs(got - want) < 1e-12
      : JSON.stringify(got) === JSON.stringify(want);
    cases.push({ name, ok, got, want });
  };
  const frac = (mon, day) => cashFraction(mon, new Date(day + 'T18:00:00'));

  eq('月内进行中：9/15 → 15/30', frac('2026-09', '2026-09-15'), 15 / 30);
  eq('月末最后一天：9/30 → 满月', frac('2026-09', '2026-09-30'), 1);
  // ↓ 三条是旧 bug 的钉子：进行中月已走完，无论日历走到哪都必须恒为满月
  eq('跨月：10/01 仍是满月', frac('2026-09', '2026-10-01'), 1);
  eq('跨月：10/02 仍是满月', frac('2026-09', '2026-10-02'), 1);
  eq('跨月：10/09 仍是满月', frac('2026-09', '2026-10-09'), 1);
  eq('新进行中月：10/15 → 15/31', frac('2026-10', '2026-10-15'), 15 / 31);
  eq('非闰年二月：2/14 → 14/28', frac('2026-02', '2026-02-14'), 14 / 28);
  eq('闰年二月：2/29 → 满月', frac('2028-02', '2028-02-29'), 1);

  let mono = true, prev = -1;
  for (const d of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']) {
    const v = frac('2026-09', d);
    if (v < prev - 1e-12) mono = false;
    prev = v;
  }
  eq('跨月窗口内占比单调不减（不倒退）', mono, true);

  // ---- computeMTD 的诊断契约 ----
  // 2026-10-03（国庆首日）的真实踩坑：5 个资产在日志里全报「daily is not iterable」
  // （JS TypeError 的文案），看起来像接口坏了，实际只是长假还没有 10 月行情。
  // 钉死：报错必须说人话，且「休市」与「真故障」要能被区分开。
  const D = (s) => s.split(',').map((x) => { const p = x.split('='); return { day: p[0], close: p[1] }; });
  const m1 = computeMTD(D('2026-08-29=4.100,2026-09-30=4.432'), '2026-10', '2026-09');
  eq('尚无交易日 → 打上 noTradingDay 标记', m1.noTradingDay, true);
  eq('尚无交易日 → 原因写「尚无交易日」', /尚无交易日/.test(m1.reason || ''), true);
  eq('尚无交易日 → 不再是 TypeError 文案', /iterable/.test(m1.reason || ''), false);
  const m2 = computeMTD(D('2026-08-29=4.100,2026-09-30=4.432,2026-10-09=4.500'), '2026-10', '2026-09');
  eq('正常取数 → ok', m2.ok, true);
  eq('正常取数 → MTD = 4.5/4.432-1', m2.mtd, 4.5 / 4.432 - 1);
  eq('正常取数 → lastDay 取本月最后一条', m2.lastDay, '2026-10-09');
  const m3 = computeMTD(null, '2026-10', '2026-09');
  eq('接口返回 null → 明说「未返回数组」', /未返回数组/.test(m3.reason || ''), true);
  eq('接口返回 null → 不算「尚无交易日」', !!m3.noTradingDay, false);
  const m4 = computeMTD(D('2026-10-09=4.500'), '2026-10', '2026-09');
  eq('缺基准月收盘 → 报出是哪个基准月', /找不到基准月 2026-09/.test(m4.reason || ''), true);

  const bad = cases.filter((c) => !c.ok);
  console.log(`monthly_progress.js --self-test：${cases.length - bad.length}/${cases.length} 通过`);
  cases.forEach((c) => console.log(`  ${c.ok ? '✅' : '❌'} ${c.name}` +
    (c.ok ? '' : `  得到 ${JSON.stringify(c.got)}，期望 ${JSON.stringify(c.want)}`)));
  if (bad.length) console.error('  ✗ 自检未通过 → 查 cashFraction 的「跨月取满月」保护、computeMTD 的诊断文案（两者都有回归钉子）');
  process.exit(bad.length ? 1 : 0);
}

// Node 18+ 才有全局 fetch（实时取数用它直连新浪）。Ubuntu 22.04 用 apt 装到的 nodejs 只有 12.x，
// 届时报错会是「fetch is not defined」这种看不出所以然的形式 —— 这里提前拦住并给出装法。
if (!NO_FETCH && typeof fetch !== 'function') {
  console.error(`  ✗ 实时取数需要 Node 18+（用到全局 fetch），当前是 ${process.version}。`);
  console.error('     Ubuntu 22.04 的 apt nodejs 是 12.x，请装新版：');
  console.error('       curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs');
  console.error('     （或 nvm：curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install --lts）');
  process.exit(1);
}

// ---------------- 加载数据与滚动引擎 ----------------
const ctx = {};
vm.createContext(ctx);
vm.runInContext(read('js/data.js') + '; this.APP_DATA = APP_DATA;', ctx);
vm.runInContext(read('js/rolling.js') + '; this.RollingBacktest = RollingBacktest;', ctx);
const rr = ctx.APP_DATA.realReturns;
const RB = ctx.RollingBacktest;
const CAP = RB.CONFIG.totalCapital; // 固定基准本金 50 万（与站内各收益列同口径）

// 最新完整月 = months 末位；进行中月 = 其下一月
const lastCompleteMonth = rr.months[rr.months.length - 1];
const inProgressMonth = nextMonthLabel(lastCompleteMonth);
const prevMonth = lastCompleteMonth;

// 取「全量回测(数据最早月·一次建仓)」组合在最新完整月的持仓与市值，作为本月至今推算的基准
const rollingResults = RB.runAll();
const base = rollingResults.find((r) => r.startPoint.isEarliest);
const baseSnap = base.monthlySnapshots[base.monthlySnapshots.length - 1];
const baseHoldings = baseSnap.holdings;
const baseTotal = baseSnap.totalValue;
const CASH = '现金·货币基金';
const cashMonthly = rr.cash_monthly || 0.00083;

// ---------------- 实时取数（月至今 MTD） ----------------
const FM = JSON.parse(read('scripts/fund_map.json'));
const ASSETS = FM.assets; // {资产: {sina, backup, ...}}

// 解析日线数组 → 进行中月 MTD。返回 {ok:true,mtd,lastDay} 或 {ok:false,reason,noTradingDay?}
// ⚠️ reason 是给人看的诊断信息，**必须把两种完全不同的情况分开**：
//    ① noTradingDay：进行中月还没有任何交易日（长假/休市）——市场状态，**属正常**，不是故障；
//    ② 其余：行情拿不到 / 结构不对（接口异常、代码无效、缺基准月）——真故障，要看。
//    旧实现两者都只抛一句「无 xxx 数据」，而且这句还会被兜底代码的 TypeError 覆盖（见下），
//    真实原因被彻底埋掉 —— 2026-10-03 国庆首日就只看到 5 行「daily is not iterable」。
function computeMTD(daily, inProg, prev) {
  if (!Array.isArray(daily)) {
    return { ok: false, reason: `行情接口未返回数组（拿到 ${daily === null ? 'null' : typeof daily}，多为此代码在新浪无行情，需带 sh/sz 前缀）` };
  }
  let prevClose = null;
  let lastProgClose = null;
  let lastDay = null;
  let latest = null;
  for (const k of daily) {
    if (!k || typeof k.day !== 'string') continue;
    const ym = k.day.slice(0, 7);
    const c = parseFloat(k.close);
    if (latest === null || k.day > latest) latest = k.day;          // 行情里最新的一天
    if (ym === prev) prevClose = c;                                 // 升序，后者覆盖 → 上月末收盘
    else if (ym === inProg) { lastProgClose = c; lastDay = k.day; }  // 本月至今最后交易日收盘
  }
  if (lastProgClose === null) {
    return { ok: false, noTradingDay: true,
      reason: `进行中月 ${inProg} 尚无交易日（行情最新 ${latest || '—'}；休市或长假，属正常）` };
  }
  if (prevClose === null) {
    return { ok: false, reason: `行情里找不到基准月 ${prev} 的收盘（行情最新 ${latest || '—'}）` };
  }
  return { ok: true, mtd: lastProgClose / prevClose - 1, lastDay };
}

async function fetchMTDForAsset(asset, cfg) {
  const candidates = [cfg.sina, ...(cfg.backup || [])];
  const tried = [];          // [{sym, err, noTradingDay}] —— 主标的在最前
  for (const sym of candidates) {
    try {
      const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=900&adj=qfq`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.sina.com.cn' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const daily = await res.json();
      const m = computeMTD(daily, inProgressMonth, prevMonth);
      if (!m.ok) { tried.push({ sym, err: m.reason, noTradingDay: !!m.noTradingDay }); continue; }
      return { ok: true, mtd: m.mtd, lastDay: m.lastDay, sym, asset };
    } catch (e) {
      tried.push({ sym, err: String((e && e.message) || e) });
    }
  }
  // ⚠️ 对外只报**主标的**的失败原因（tried[0]）。兜底代码是 fund_map 里的裸 6 位代码
  //    （如 160706 / 518880），新浪对它们一律返回字面量 null → 报错恒为同一句
  //    「行情接口未返回数组」，若沿用「最后一个错误胜出」就会把主标的的真实原因盖掉。
  const errs = tried.map((t) => `${t.sym}: ${t.err}`);
  return {
    ok: false,
    err: tried.length ? tried[0].err : 'unknown',
    errs,                                                // 全量明细（写进报告/排查用）
    noTradingDay: tried.some((t) => t.noTradingDay),      // 有任一候选说「本月还没交易日」→ 市场状态
    asset
  };
}

// 现金 MTD：按「进行中月」已过天数占比折算（现金月收益 cashMonthly）
// ⚠️ 分子与分母必须**同为进行中月**的进度：分母是该月总天数，分子是「该月已过几天」，
//    绝不能用「今天在日历上的日号」——数据末月常年落后日历 1 个月
//    （日历 10-02、数据末月 2026-08 → 进行中月 2026-09 **其实已经走完**），
//    此时用 today.getDate()=2 会把它算成 2/30，现金凭空缩水约 560 元、组合 MTD 被压低约 0.11pp。
//    2026-10-02 实测：09-30 显示 -1.39%，10-02 变成 -1.50%，差额 561.61 元。
//    既然进行中月已经结束 → 直接取满月（这是「该月已全部发生」的正确表达）。
function cashFraction(inProgressMonth, now = new Date()) {
  const [y, m] = inProgressMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();   // m 是 1-based → 该月最后一天
  const endOfMonth = new Date(y, m, 1);              // 该月结束后的第一刻（即下月 1 日）
  if (now >= endOfMonth) return 1;                   // 进行中月已走完 → 满月
  return Math.min(now.getDate(), daysInMonth) / daysInMonth;
}
function cashMTD() {
  return cashMonthly * cashFraction(inProgressMonth);
}

// 现有 js/progress.json 的「身份」是否仍然有效：
//   进行中月尚未定稿（不在 months 里）且 = 数据末月的下一个月，基准月 = 数据末月。
// 有效 → 降级时保留它（真实但滞后一天/一周，前端会照实显示其数据截至日）；
// 无效 → 必须写入 null 占位把身份推进，否则 smoke_check 第 7 项会拦、定稿流程被卡住。
function existingIdentityValid() {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(ROOT, JSON_OUT), 'utf8'));
    return !!o.in_progress
      && o.base_month === lastCompleteMonth
      && o.in_progress_month === inProgressMonth
      && !rr.months.includes(o.in_progress_month);
  } catch (e) { return false; }
}

// 现有 js/progress.json 本身是否已经是「降级占位」（估算字段全 null）。
// 占位里没有任何可保护的信息 → 不必像「含真实 MTD 的快照」那样被 keepExisting 挡住，
// 应当允许刷新（把降级原因/时间戳更新掉），否则 status.js 只能看到干巴巴的 degraded。
// 2026-10-03 长假首日实测：磁盘上已是 00:37 写下的 null 占位，日志却仍说「保留上一版真实快照」。
function existingSnapshotIsDegraded() {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(ROOT, JSON_OUT), 'utf8'));
    return !!o.in_progress && o.degraded === true;
  } catch (e) { return false; }
}

// ---------------- 主流程 ----------------
(async () => {
  const mtdMap = {};
  let fetchOk = 0;
  let fetchFail = 0;
  let holidayOnly = false;   // 降级仅因「进行中月尚无交易日（休市/长假）」—— 措辞要与真故障区分

  if (NO_FETCH) {
    for (const asset of Object.keys(ASSETS)) mtdMap[asset] = { ok: true, mtd: 0, sym: '(offline)', asset };
    console.error('[--no-fetch] 已跳过实时取数，MTD 记为 0（仅展示结构）');
  } else {
    const results = await Promise.all(
      Object.entries(ASSETS).map(([asset, cfg]) => fetchMTDForAsset(asset, cfg))
    );
    for (const r of results) {
      mtdMap[r.asset] = r;
      if (r.ok) fetchOk++; else { fetchFail++; console.error(`  ✗ ${r.asset} 取数失败: ${r.err}`); }
    }
    if (fetchFail > 0) {
      const fails = results.filter((r) => !r.ok);
      // 全部失败都只是「进行中月还没有交易日」→ 这是市场状态（休市/长假），不是故障。
      // 例：国庆长假 A 股 10-01~10-08 休市，整个窗口内 MTD 无数据是**正确**的。
      // 必须与真故障分开措辞，否则每年长假都刷一屏红字，把真故障淹没（告警疲劳）。
      holidayOnly = fails.length > 0 && fails.every((r) => r.noTradingDay);
      if (holidayOnly) {
        console.error(`  · 进行中月 ${inProgressMonth} 尚无交易日（休市/长假）→ 本次不提供本月至今数据；属正常，开市后自动恢复`);
      } else {
        console.error(`  ⚠ ${fetchFail} 个风险资产取数失败 → 本快照判为降级（不会写入/推送任何本月至今数据）`);
      }
      for (const asset of Object.keys(ASSETS)) {
        if (!mtdMap[asset].ok) mtdMap[asset] = { ok: false, mtd: null, lastDay: null, sym: '(失败)', asset };
      }
    }
  }
  // 降级判定：任一风险资产取数失败（或 --no-fetch 离线）→ 组合 MTD 不完整，
  // 不能作为「本月至今数据」对外展示（宁可不显示，也不给一个由 0 拼出来的假数字）。
  const DEGRADED = NO_FETCH || fetchFail > 0;
  // 降级原因（人话）——同时写进报告与 progress.json：只写 degraded 会让人分不清
  // 「长假休市（正常）」和「取数真坏了（要看）」，这正是这套值守最怕的告警疲劳。
  const degradedReason = !DEGRADED ? null
    : NO_FETCH ? '离线模式（--no-fetch）：本次不取数'
      : holidayOnly ? `进行中月 ${inProgressMonth} 尚无交易日（休市/长假），属正常，开市后自动恢复`
        : `${fetchFail} 个风险资产取数失败（详见 cron 日志）`;
  mtdMap[CASH] = { ok: true, mtd: cashMTD(), lastDay: null, sym: 'cash', asset: CASH };

  // 本月至今最新市值：基准持仓 × (1 + MTD)
  let estTotal = 0;
  const rows = [];
  for (const asset of Object.keys(ASSETS).concat([CASH])) {
    const baseH = baseHoldings[asset] || 0;
    const mtdKnown = !!mtdMap[asset].ok;                  // 该资产是否拿到了真实 MTD
    const mtd = mtdKnown ? mtdMap[asset].mtd : 0;         // 仅用于报告排版，降级时不对外输出
    const est = baseH * (1 + mtd);
    estTotal += est;
    rows.push({ asset, mtd, mtdKnown, baseH, est, lastDay: mtdMap[asset].lastDay || null, pct: baseTotal > 0 ? baseH / baseTotal : 0 });
  }
  const delta = estTotal - baseTotal;
  // 口径：与站内「月收益/年度收益率/累计收益」一致 → 一律 ÷ 固定基准本金 50 万（各分段可加）
  const deltaPctBase = CAP > 0 ? (delta / CAP) * 100 : 0;       // 本月至今（主指标）
  const deltaPctPrev = baseTotal > 0 ? (delta / baseTotal) * 100 : 0; // 相对上月末总市值（参考值）
  const cumPctBase = CAP > 0 ? (estTotal / CAP - 1) * 100 : 0;  // 累计（本月至今口径，÷50万）
  const dataAsOf = rows.map((r) => r.lastDay).filter(Boolean).sort().pop() || null;

  // ---------------- 渲染报告 ----------------
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const fmtMoney = (v) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(2) + '万' : v.toFixed(0));
  const sign = (v) => (v >= 0 ? '+' : '');

  let md = '';
  md += `# 恒市值组合 · 进行中月份进度快照\n\n`;
  md += `- 生成时间：${ts}\n`;
  md += `- 数据截至：${dataAsOf || '—'}（本月最后交易日收盘）\n`;
  md += `- 基准月（最新完整月）：${lastCompleteMonth}，组合市值 ¥${fmtMoney(baseTotal)}\n`;
  md += `- 固定基准本金：¥${fmtMoney(CAP)}（所有收益比例的统一分母，与站内各收益列同口径）\n`;
  md += `- 进行中月：**${inProgressMonth}（本月至今 MTD，由每日真实行情累积得出，是已发生数据而非预测；该月尚未定稿，待月末收盘后由 monthly_update.js 写入正式回测）**\n`;
  md += `- 取数状态：${fetchOk}/${Object.keys(ASSETS).length} 个风险资产实时成功` +
        (fetchFail > 0 ? `（${fetchFail} 个失败）` : '') + `\n`;
  if (DEGRADED) {
    md += `- ⚠️ **本快照已降级：不含任何本月至今数据**（所有 MTD / 最新市值字段为 null）。` +
          `站点会自动回退到「已定稿（${lastCompleteMonth}）」口径，不展示任何当月数字。` +
          `原因：取数不完整时用 0 填补会伪造出「当月持平」的假收益（项目铁律禁止）。\n`;
    md += `- 降级原因：${degradedReason}\n\n`;
  } else {
    md += `\n`;
  }

  md += `## 各资产月至今(MTD)收益\n\n`;
  md += `| 资产 | 本月至今 MTD | 基准持仓(${lastCompleteMonth}) | 最新市值 |\n`;
  md += `| --- | --- | --- | --- |\n`;
  for (const r of rows) {
    const mtdCell = (!DEGRADED && r.mtdKnown) ? `${sign(r.mtd * 100)}${(r.mtd * 100).toFixed(2)}%` : '—';
    const estCell = (!DEGRADED && r.mtdKnown) ? `¥${fmtMoney(r.est)}` : '—';
    md += `| ${r.asset} | ${mtdCell} | ¥${fmtMoney(r.baseH)} | ${estCell} |\n`;
  }
  md += `\n`;

  md += `## 组合最新市值（进行中）\n\n`;
  if (DEGRADED) {
    md += `- ⚠️ 取数不完整，**本次不提供本月至今数据**（不写入 js/progress.json 的相关字段）。` +
          (holidayOnly ? `进行中月尚无交易日，开市后下一次运行自动恢复（无需重跑）。\n`
            : `重跑本脚本即可。\n`);
  } else {
    md += `- 最新市值：**¥${fmtMoney(estTotal)}**（对固定基准 ¥${fmtMoney(CAP)} → 累计 ${sign(cumPctBase)}${cumPctBase.toFixed(2)}%）\n`;
    md += `- 本月至今收益：**${sign(deltaPctBase)}${deltaPctBase.toFixed(2)}%**（${sign(delta)}¥${fmtMoney(Math.abs(delta))} 变更，即 ${sign(delta)}${Math.abs(delta).toFixed(0)} 元）— ÷固定基准50万\n`;
    md += `  - 参考：同一变更金额若按上月末总市值 ¥${fmtMoney(baseTotal)} 计，为 ${sign(deltaPctPrev)}${deltaPctPrev.toFixed(2)}%（站内各收益列统一采用 ÷固定基准50万，故以 ${sign(deltaPctBase)}${deltaPctBase.toFixed(2)}% 为准）\n`;
  }
  md += `- 状态：${DEGRADED ? '⚠️ **降级（无本月至今数据）**' : '🟡 **进行中（本月至今 MTD）**'} — 本快照不写入主回测数据，仅作进度参考\n`;

  console.log(md);
  if (OUT) {
    fs.writeFileSync(path.join(ROOT, OUT), md, 'utf8');
    console.error(`[ok] 报告已写入 ${OUT}`);
  }

  // ---------------- 写前端数据源 js/progress.json ----------------
  if (!NO_JSON) {
    // 降级时所有随行情变化的字段一律写 null（不是 0）：
    // null = 「本次没有数据」，0 = 伪造出来的「当月持平」，后者会被 live overlay 当成真的估算发到全站。
    const n2 = (v) => (DEGRADED ? null : Number(v.toFixed(2)));
    const payload = {
      generated_at: ts,
      in_progress: true,
      in_progress_month: inProgressMonth,
      base_month: lastCompleteMonth,
      data_as_of: DEGRADED ? null : dataAsOf,
      base_capital: CAP,
      base_total: Number(baseTotal.toFixed(2)),   // 基准月持仓，与本月行情无关 → 始终有效
      est_total: n2(estTotal),
      est_change_amount: n2(delta),
      est_change_pct_base: n2(deltaPctBase),      // ÷固定基准50万（站内统一口径）
      est_change_pct_prev: n2(deltaPctPrev),      // ÷上月末总市值（参考）
      cum_return_pct_base: n2(cumPctBase),
      fetch: { ok: fetchOk, fail: fetchFail, offline: NO_FETCH },   // offline=true 表示本次为 --no-fetch 离线结构自检
      degraded: DEGRADED,
      degraded_reason: degradedReason,   // 供 status.js / 排查用：区分「休市（正常）」与「取数故障」
      assets: rows.map((r) => ({
        name: r.asset,
        ok: DEGRADED ? false : r.mtdKnown,          // 该资产本次是否取到可用 MTD（降级时一律 false）
        mtd: (DEGRADED || !r.mtdKnown) ? null : Number((r.mtd * 100).toFixed(2)),  // 百分比，展示用（2 位）
        mtd_raw: (DEGRADED || !r.mtdKnown) ? null : Number(r.mtd.toFixed(8)),      // 小数收益率（引擎叠加层用，避免 ±3 元漂移）
        base_holding: Number(r.baseH.toFixed(2)),
        est_value: (DEGRADED || !r.mtdKnown) ? null : Number(r.est.toFixed(2)),
        last_day: r.lastDay || null
      })),
      note: DEGRADED
        ? '⚠ 降级快照：本月行情取数不完整，本文件不含任何本月至今数据（相关字段为 null）。前端与引擎必须忽略这些字段，站点回退到「已定稿（基准月）」口径；重跑 scripts/monthly_progress.js 即可恢复。'
        : '本月至今（MTD）为真实已发生的每日行情累积，但该月尚未定稿（恒市值法仅在月末调仓），故不计入官方回测；月末收盘后由月度定稿流程写入正式数据。收益比例统一按固定基准 50 万口径。'
    };
    const jpath = path.join(ROOT, JSON_OUT);
    // 仅当"数据内容"变化才重写（时间戳单独比较），避免每周无意义地产生 diff 与部署
    payload.generated_at = '__TS__';
    const nextBody = JSON.stringify(payload, null, 2) + '\n';
    let unchanged = false;
    if (fs.existsSync(jpath)) {
      try {
        const prevObj = JSON.parse(fs.readFileSync(jpath, 'utf8'));
        prevObj.generated_at = '__TS__';
        unchanged = (JSON.stringify(prevObj, null, 2) + '\n') === nextBody;
      } catch (_) { unchanged = false; }
    }
    // 降级 + 现有快照身份仍有效 + 现有快照**含真实数据** → 保留它，不用一份 null 占位去覆盖真数据。
    // 若现有快照本身就是降级占位（无信息可保护），则放行刷新。
    const keepExisting = DEGRADED && existingIdentityValid() && !existingSnapshotIsDegraded();
    if (keepExisting) {
      console.error('[skip] 取数降级且现有快照仍有效（含真实 MTD）→ 保留上一版真实快照（未写入、未推送）');
    } else if (unchanged) {
      console.error(`[skip] ${JSON_OUT} 数据无变化，未重写（保留原快照时间）`);
    } else {
      payload.generated_at = ts;
      fs.writeFileSync(jpath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
      console.error(DEGRADED
        ? `[ok] ${JSON_OUT} 已写入降级占位（${inProgressMonth} 无本月至今数据，相关字段全为 null）`
        : `[ok] ${JSON_OUT} 已更新（${inProgressMonth} 最新市值 ¥${fmtMoney(estTotal)}，${sign(deltaPctBase)}${deltaPctBase.toFixed(2)}%）`);
    }
    // 推送闸门：只为「含真实 MTD 的快照」或「明确标记 degraded、估算字段全为 null 的占位」推送。
    // 绝不允许把用 0 填补出来的估算推上线（keepExisting 时文件根本没动，也无需推送）。
    if (PUSH && !keepExisting) PUBLISH_FAILED = !gitPushJson(JSON_OUT);
  }

  // 退出码：2 = 降级（本次未发布任何本月至今数据）；3 = 数据已生成但推送失败（未上线，需重跑）。
  // 3 的意义：push 被拒（远程有新提交）时不能让运行器误判为「成功」—— 那会关掉当天闸门，
  // 数据永远上不了线却毫无告警。运行器把 3 当「真失败」→ 记 fail_streak 并在当天继续重试。
  if (PUBLISH_FAILED) process.exit(3);
  process.exit(DEGRADED && !NO_FETCH ? 2 : 0);
})();

// 仅提交并推送进度 JSON（有变化才提交），推后核对远程 tip。
// 返回值：true = 已上线（或无需提交）；false = 本次未上线 —— 调用处据此设置退出码 3。
function gitPushJson(relPath) {
  const { execSync } = require('child_process');
  const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try {
    if (!run(`git status --porcelain -- ${relPath}`)) {
      console.error('[skip] git 无变更，跳过提交');
      return true;
    }
    run(`git add -- ${relPath}`);
    const msg = `chore(progress): 更新进行中月份进度快照 ${relPath}\n\n由 scripts/monthly_progress.js --push 自动生成（只读快照，不修改 data.js / real_returns.json）`;
    execSync('git commit -F -', { cwd: ROOT, input: msg, stdio: ['pipe', 'pipe', 'pipe'] });
    const branch = run('git rev-parse --abbrev-ref HEAD');
    run(`git push origin ${branch}`);
    const tip = execSync(`git ls-remote origin ${branch}`, { cwd: ROOT }).toString().trim().split(/\s+/)[0];
    const local = run('git rev-parse HEAD');
    if (tip === local) {
      console.error(`[ok] 已推送，远程 tip=${tip.slice(0, 7)}`);
      return true;
    }
    // push 命令没抛错、但远程 tip 没跟上 → 同样是「没上线」，必须按失败处理
    console.error(`[error] 推送后远程 tip=${tip.slice(0, 7)} ≠ 本地 HEAD=${local.slice(0, 7)} → 本次未上线（退出码 3）`);
    return false;
  } catch (e) {
    // 最常见：push 被「非快进」拒绝（远程有本地没有的提交）。
    // 运行器下次运行前会先与远程同步（crontab/run_job.js#syncWithRemote），届时自动恢复。
    console.error('[error] commit/push 失败：' + String(e.message || e).split('\n')[0]);
    console.error('   · 若为「非快进」拒绝：远程有本地没有的提交 → 运行器下次运行前会自动 pull --rebase 后重推');
    console.error('   · 手工处置：cd 到仓库 && git pull --rebase && node scripts/monthly_progress.js --push');
    return false;
  }
}

// 月份标签 +1（YYYY-MM 格式，跨年自动进位）
function nextMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const nm = m + 1;
  if (nm > 12) return `${y + 1}-01`;
  return `${y}-${String(nm).padStart(2, '0')}`;
}
