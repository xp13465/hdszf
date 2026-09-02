#!/usr/bin/env node
/**
 * 数据更新前后差异对比（滚动回测汇总表口径）
 *
 * 目的：每次给 data.js 追加一个月真实收益后，量化「新数据 vs 旧数据」的差异，
 *      输出与站点「滚动回测汇总」表格同构的对比表（12 列），并标注正向/负向。
 *
 * 原理：
 *   - 旧数据 = 当前 data.js 截掉最后 1 个月的收益（months 与 asset_returns 同步截尾）
 *   - 新数据 = 当前 data.js 全量
 *   - 两者用同一套 rolling.js 引擎、同一组起点跑 runAll()，逐起点比对
 *
 * 用法：
 *   node scripts/diff_data_update.js                  # 默认：截掉最后 1 个月
 *   node scripts/diff_data_update.js --drop 2         # 截掉最后 2 个月（跨月补更时用）
 *   node scripts/diff_data_update.js --md out.md      # 同时输出 markdown 报告文件
 *
 * 输出：滚动回测汇总表同构列
 *   起点 | 回测月数 | 最终市值(元) | 总收益率(%) | 年化收益(%) | 最大回撤(%) |
 *   Sharpe | Sortino | 月胜率(%) | 年化波动(%) | 操作次数 | 数据状态
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const DROP = parseInt(arg('drop', '1'), 10);
const MD_OUT = arg('md', '');

// ---------- 载入前端脚本 ----------
function loadInto(ctx, files) {
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
}

function makeCtx() {
  const ctx = { console, Math, Date, JSON, parseFloat, parseInt, isNaN, Number, String, Object, Array };
  vm.createContext(ctx);
  return ctx;
}

/**
 * 在 vm 上下文里取顶层 const 声明的值。
 * ⚠️ `const X = ...` 在 vm 中进入「全局词法环境」，不会挂到 context 对象上，
 *    所以 ctx.X 是 undefined，必须用 runInContext 求值表达式来取。
 */
function peek(ctx, expr) {
  try {
    return vm.runInContext(expr, ctx);
  } catch (e) {
    throw new Error('无法在上下文中求值 ' + expr + '：' + e.message);
  }
}

function buildRolling(dropN) {
  const ctx = makeCtx();
  loadInto(ctx, ['js/data.js']);
  // 截尾：构造「更新前」的数据
  if (dropN > 0) {
    const rr = peek(ctx, 'APP_DATA.realReturns');
    const n = rr.months.length;
    rr.month_count = rr.month_count - dropN;
    rr.months = rr.months.slice(0, n - dropN);
    for (const k of Object.keys(rr.asset_returns)) {
      rr.asset_returns[k] = rr.asset_returns[k].slice(0, rr.asset_returns[k].length - dropN);
    }
  }
  loadInto(ctx, ['js/rolling.js']);
  return ctx;
}

// ---------- 取终点年月 ----------
function endOf(dropN) {
  const ctx = makeCtx();
  loadInto(ctx, ['js/data.js']);
  const rr = peek(ctx, 'APP_DATA.realReturns');
  if (dropN > 0) {
    const n = rr.months.length;
    // 旧口径终点 = 截尾后最后一个标签
    return rr.months[n - dropN - 1];
  }
  return rr.months[rr.months.length - 1];
}

const OLD_END = endOf(DROP);            // 如 "2026-07"
const NEW_END = endOf(0);               // 如 "2026-08"

function setEnd(ctx, ym) {
  const [y, m] = ym.split('-').map(Number);
  peek(ctx, 'RollingBacktest').CONFIG.endYear = y;
  peek(ctx, 'RollingBacktest').CONFIG.endMonth = m;
}

const ctxOld = buildRolling(DROP);
setEnd(ctxOld, OLD_END);
const resOld = peek(ctxOld, 'RollingBacktest').runAll();

const ctxNew = buildRolling(0);
setEnd(ctxNew, NEW_END);
const resNew = peek(ctxNew, 'RollingBacktest').runAll();

// ---------- 结果索引：按 起点key + 建仓方式 ----------
/**
 * 对齐键：用「N年前入场」+ 建仓方式，而不是具体年月。
 * 原因：收口月后移 1 个月后，常规起点的日历月也整体后移 1 个月
 *      （旧 10年前 = 2016年7月，新 10年前 = 2016年8月），
 *      但「回测月数」相同（都是 120 个月），这才是可比的同口径。
 */
function keyOf(r) {
  const sp = r.startPoint;
  const build = sp.buildMonths === 1 ? 'once' : (sp.isComparison ? 'cmp' : 'batch');
  const ya = sp.yearsAgo === null || sp.yearsAgo === undefined ? 'earliest' : 'y' + sp.yearsAgo;
  return ya + '|' + build;
}
const mapOld = new Map(resOld.map((r) => [keyOf(r), r]));
const mapNew = new Map(resNew.map((r) => [keyOf(r), r]));

// 保持顺序：旧表顺序优先，再追加新表独有的起点
const order = [];
for (const k of mapOld.keys()) order.push(k);
for (const k of mapNew.keys()) if (!mapOld.has(k)) order.push(k);

// ---------- 输出 ----------
const HEADER = [
  '起点', '回测月数', '最终市值(元)', '总收益率(%)', '年化收益(%)', '最大回撤(%)',
  'Sharpe', 'Sortino', '月胜率(%)', '年化波动(%)', '操作次数', '数据状态'
];

function row(r) {
  const sp = r.startPoint;
  const label = sp.label + (sp.buildMonths === 1 ? ' · 一次建仓版' : ' · 分批建仓版');
  return {
    label,
    months: r.totalMonths,
    finalValue: r.finalValue,
    total: r.totalReturn,
    annual: r.annualReturn,
    dd: r.maxDrawdown,
    sharpe: r.sharpe,
    sortino: r.sortino,
    winRate: r.winRate,
    annVol: r.annVol * 100,
    ops: r.operationCount,
    status: r.hasEstimatedData ? '含估计值' : '全部真实数据'
  };
}

const F = {
  months: (v) => String(v),
  finalValue: (v) => v.toFixed(0),
  total: (v) => v.toFixed(2),
  annual: (v) => v.toFixed(2),
  dd: (v) => v.toFixed(2),
  sharpe: (v) => v.toFixed(2),
  sortino: (v) => v.toFixed(2),
  winRate: (v) => v.toFixed(2),
  annVol: (v) => v.toFixed(2),
  ops: (v) => String(v)
};

// 方向：该指标「变大」是好事还是坏事
const HIGHER_IS_BETTER = {
  months: null,
  finalValue: true,
  total: true,
  annual: true,
  dd: true,         // ⚠️ 回撤是负数（-6.09），越大＝越接近 0＝越好
  sharpe: true,
  sortino: true,
  winRate: true,
  annVol: false,    // 波动越低越好
  ops: null
};

const FIELD_KEYS = ['months', 'finalValue', 'total', 'annual', 'dd', 'sharpe', 'sortino', 'winRate', 'annVol', 'ops'];

function mark(delta, hib, dec) {
  // 按显示精度判断「是否实质变化」，避免 +0.00 被误标方向
  const eps = dec === 0 ? 0.5 : 0.5 * Math.pow(10, -dec);
  if (Math.abs(delta) < eps) return '—';
  if (hib === null) return delta > 0 ? '↑' : '↓';
  return (delta > 0) === hib ? '正 ↑' : '负 ↓';
}

const lines = [];
const P = (s = '') => { lines.push(s); console.log(s); };

P('# 数据更新差异报告（滚动回测汇总口径）');
P();
P(`- 对比口径：**旧 ${OLD_END} 收口**（${resOld[0] ? resOld[0].totalMonths : '?'} 个月） vs **新 ${NEW_END} 收口**（${resNew[0] ? resNew[0].totalMonths : '?'} 个月）`);
P('- 引擎：`js/rolling.js` `RollingBacktest.runAll()`，与站点「滚动回测汇总」表完全同源');
P('- 起点对齐：按「N 年前入场」对齐（回测月数相同），差异来自「窗口整体后移 1 个月」');
P(`- 生成时间：${new Date().toISOString().slice(0, 10)}`);
P();

// ---- 表1：滚动回测汇总（新数据，全量） ----
P('## 一、滚动回测汇总 · 新数据（' + NEW_END + ' 收口）');
P();
P('| ' + HEADER.join(' | ') + ' |');
P('|' + HEADER.map(() => '---').join('|') + '|');
for (const k of order) {
  const r = mapNew.get(k);
  if (!r) continue;
  const v = row(r);
  P(`| ${v.label} | ${F.months(v.months)} | ${F.finalValue(v.finalValue)} | ${F.total(v.total)} | ${F.annual(v.annual)} | ${F.dd(v.dd)} | ${F.sharpe(v.sharpe)} | ${F.sortino(v.sortino)} | ${F.winRate(v.winRate)} | ${F.annVol(v.annVol)} | ${F.ops(v.ops)} | ${v.status} |`);
}
P();

// ---- 表2：新旧逐起点差异 ----
P('## 二、新旧差异（同口径对齐，‘新 − 旧’）');
P();
P('> 对齐方式：按「N 年前入场」对齐，回测月数完全相同。常规起点的日历月整体后移 1 个月（旧 10 年前 = 2016年7月，新 10 年前 = 2016年8月），这是收口月后移的自然结果。');
P();
const diffHeader = ['起点（旧 → 新）', '建仓方式', '回测月数', '指标', '旧', '新', '差值', '方向'];
P('| ' + diffHeader.join(' | ') + ' |');
P('|' + diffHeader.map(() => '---').join('|') + '|');

const CN = {
  months: '回测月数',
  finalValue: '最终市值(元)',
  total: '总收益率(%)',
  annual: '年化收益(%)',
  dd: '最大回撤(%)',
  sharpe: 'Sharpe',
  sortino: 'Sortino',
  winRate: '月胜率(%)',
  annVol: '年化波动(%)',
  ops: '操作次数'
};

const summary = [];
for (const k of order) {
  const ro = mapOld.get(k);
  const rn = mapNew.get(k);
  if (!ro || !rn) continue;
  const vo = row(ro);
  const vn = row(rn);
  const buildLabel = ro.startPoint.buildMonths === 1 ? '一次建仓版' : '分批建仓版';
  const span = ro.startPoint.label === rn.startPoint.label
    ? ro.startPoint.label
    : ro.startPoint.label + ' → ' + rn.startPoint.label;
  summary.push({ label: span, buildLabel, vo, vn });
  for (const f of FIELD_KEYS) {
    const d = vn[f] - vo[f];
    const dec = (f === 'finalValue' || f === 'months' || f === 'ops') ? 0 : 2;
    P(`| ${span} | ${buildLabel} | ${vo.months} | ${CN[f]} | ${F[f](vo[f])} | ${F[f](vn[f])} | ${d >= 0 ? '+' : ''}${d.toFixed(dec)} | ${mark(d, HIGHER_IS_BETTER[f], dec)} |`);
  }
}
P();

// ---- 表3：结论速览 ----
P('## 三、结论速览（主要指标方向）');
P();
P('> 总评口径：以 **最终市值 / 年化 / Sharpe** 三项主指标为准——三项同向为正即判「正向」。回撤、月胜率作为参考列单独列出。');
P();
const quickHeader = ['起点（旧 → 新）', '建仓方式', '回测月数', 'Δ最终市值', 'Δ年化(pct)', 'Δ最大回撤(pct)', 'ΔSharpe', 'Δ月胜率(pct)', '总评'];
P('| ' + quickHeader.join(' | ') + ' |');
P('|' + quickHeader.map(() => '---').join('|') + '|');
let posCount = 0;
let negCount = 0;
for (const s of summary) {
  const dVal = s.vn.finalValue - s.vo.finalValue;
  const dAnn = s.vn.annual - s.vo.annual;
  const dDd = s.vn.dd - s.vo.dd;
  const dSh = s.vn.sharpe - s.vo.sharpe;
  const dWr = s.vn.winRate - s.vo.winRate;
  const main = [dVal > 0, dAnn > 0, dSh > 0].filter(Boolean).length;
  const verdict = main === 3 ? '正向 ✅' : (main === 0 ? '负向 ⚠️' : '混合');
  if (main === 3) posCount++;
  if (main === 0) negCount++;
  P(`| ${s.label} | ${s.buildLabel} | ${s.vo.months} | ${dVal >= 0 ? '+' : ''}${dVal.toFixed(0)} | ${dAnn >= 0 ? '+' : ''}${dAnn.toFixed(2)} | ${dDd >= 0 ? '+' : ''}${dDd.toFixed(2)} | ${dSh >= 0 ? '+' : ''}${dSh.toFixed(2)} | ${dWr >= 0 ? '+' : ''}${dWr.toFixed(2)} | ${verdict} |`);
}
P();
P(`**汇总**：${summary.length} 个起点中，正向 ${posCount} 个、负向 ${negCount} 个、混合 ${summary.length - posCount - negCount} 个。`);
P();

// ---- 表4：三档方案全周期对比 ----
P('## 四、三档方案全周期对比（引擎主路径 `BacktestEngine.simulateCMV`）');
P();
P('> 与站点「三档对比卡片 / 首屏 Hero / 雷达图」同源：初始 50 万，一次建仓，全窗口。');
P();
const PLAN_IDS = ['conservative', 'balanced', 'aggressive'];
const PLAN_CN = { conservative: '保守型', balanced: '稳健型', aggressive: '进取型' };

function buildEngine(dropN) {
  const ctx = makeCtx();
  loadInto(ctx, ['js/data.js']);
  if (dropN > 0) {
    const rr = peek(ctx, 'APP_DATA.realReturns');
    const n = rr.months.length;
    rr.month_count = rr.month_count - dropN;
    rr.months = rr.months.slice(0, n - dropN);
    for (const k of Object.keys(rr.asset_returns)) {
      rr.asset_returns[k] = rr.asset_returns[k].slice(0, rr.asset_returns[k].length - dropN);
    }
  }
  loadInto(ctx, ['js/engine.js']);
  return ctx;
}

const beOld = peek(buildEngine(DROP), 'BacktestEngine');
const beNew = peek(buildEngine(0), 'BacktestEngine');

const planHeader = ['方案', '回测月数', '最终市值(元)', '总收益率(%)', '年化收益(%)', '最大回撤(%)', 'Sharpe', 'Sortino', '月胜率(%)', '年化波动(%)'];
P('| ' + planHeader.join(' | ') + ' |');
P('|' + planHeader.map(() => '---').join('|') + '|');
for (const id of PLAN_IDS) {
  const r = beNew.simulateCMV(beNew.PLANS[id]);
  P(`| ${PLAN_CN[id]} | ${r.totalMonths} | ${r.finalValue.toFixed(0)} | ${r.total.toFixed(2)} | ${r.annual.toFixed(2)} | ${r.maxDd.toFixed(2)} | ${r.sharpe.toFixed(2)} | ${r.sortino.toFixed(2)} | ${(r.monthlyWinRate * 100).toFixed(2)} | ${(r.annVol * 100).toFixed(2)} |`);
}
P();

const planDiffHeader = ['方案', '指标', '旧', '新', '差值', '方向'];
P('| ' + planDiffHeader.join(' | ') + ' |');
P('|' + planDiffHeader.map(() => '---').join('|') + '|');
const planFields = [
  { k: 'totalMonths', cn: '回测月数', dec: 0, hib: null },
  { k: 'finalValue', cn: '最终市值(元)', dec: 0, hib: true },
  { k: 'total', cn: '总收益率(%)', dec: 2, hib: true },
  { k: 'annual', cn: '年化收益(%)', dec: 2, hib: true },
  { k: 'maxDd', cn: '最大回撤(%)', dec: 2, hib: true },
  { k: 'sharpe', cn: 'Sharpe', dec: 2, hib: true },
  { k: 'sortino', cn: 'Sortino', dec: 2, hib: true },
  { k: 'monthlyWinRate', cn: '月胜率(%)', dec: 2, hib: true, mul: 100 },
  { k: 'annVol', cn: '年化波动(%)', dec: 2, hib: false, mul: 100 }
];
for (const id of PLAN_IDS) {
  const ro = beOld.simulateCMV(beOld.PLANS[id]);
  const rn = beNew.simulateCMV(beNew.PLANS[id]);
  for (const f of planFields) {
    const m = f.mul || 1;
    const o = ro[f.k] * m;
    const n2 = rn[f.k] * m;
    const d = n2 - o;
    P(`| ${PLAN_CN[id]} | ${f.cn} | ${o.toFixed(f.dec)} | ${n2.toFixed(f.dec)} | ${d >= 0 ? '+' : ''}${d.toFixed(f.dec)} | ${mark(d, f.hib, f.dec)} |`);
  }
}
P();

P('## 五、一句话结论');
P();
{
  const ro = beOld.simulateCMV(beOld.PLANS.balanced);
  const rn = beNew.simulateCMV(beNew.PLANS.balanced);
  // 新增月份的五资产收益（动态取，不写死）
  const rrN = peek(ctxNew, 'APP_DATA.realReturns');
  const parts = Object.keys(rrN.asset_returns).map((a) => {
    const v = rrN.asset_returns[a][rrN.asset_returns[a].length - 1] * 100;
    return `${a} ${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  });
  const allUp = Object.keys(rrN.asset_returns).every(
    (a) => rrN.asset_returns[a][rrN.asset_returns[a].length - 1] > 0
  );
  const allDown = Object.keys(rrN.asset_returns).every(
    (a) => rrN.asset_returns[a][rrN.asset_returns[a].length - 1] < 0
  );
  const tone = allUp ? '全面上涨月' : (allDown ? '全面下跌月' : '涨跌互现月');
  P(`新增的 ${NEW_END} 是**${tone}**（${parts.join('、')}）。`);
  P();
  if (negCount === 0 && posCount === summary.length) {
    P(`**全部 ${summary.length} 个入场起点均为正向改善，无一恶化。**`);
  } else {
    P(`**${summary.length} 个入场起点中：正向 ${posCount}、混合 ${summary.length - posCount - negCount}、负向 ${negCount}。**`);
  }
  P();
  P(`稳健型全周期口径：年化 ${ro.annual.toFixed(2)}% → **${rn.annual.toFixed(2)}%**（${rn.annual - ro.annual >= 0 ? '+' : ''}${(rn.annual - ro.annual).toFixed(2)} pct），`);
  P(`终值 ${(ro.finalValue / 10000).toFixed(1)}万 → **${(rn.finalValue / 10000).toFixed(1)}万**（${rn.finalValue - ro.finalValue >= 0 ? '+' : ''}${(rn.finalValue - ro.finalValue).toFixed(0)} 元），`);
  P(`Sharpe ${ro.sharpe.toFixed(2)} → **${rn.sharpe.toFixed(2)}**，最大回撤 ${ro.maxDd.toFixed(2)}% → **${rn.maxDd.toFixed(2)}%**（${rn.maxDd >= ro.maxDd ? '未恶化' : '略有加深'}）。`);
}
P();

if (MD_OUT) {
  fs.writeFileSync(path.join(ROOT, MD_OUT), lines.join('\n'), 'utf8');
  console.log('\n[已写入] ' + MD_OUT);
}
