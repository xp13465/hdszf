#!/usr/bin/env node
/**
 * 冒烟检查：数据更新后的一键自检
 *   node scripts/smoke_check.js
 *
 * 校验内容：
 *  1) 引擎输出内部一致性（CAGR、月胜率、年度统计）
 *  2) index.html 首屏 Hero 卡片 ID 齐全
 *  3) main.js 的 updateHeroStats 引用的 ID 与 index.html 一致
 *  4) data.js 与 real_returns.json 数据窗口一致
 *
 * 退出码：0 通过；1 失败。供 CI / 发布前调用。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(path.dirname(path.resolve(__filename)));
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function check(name, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${ok ? '' : '  ->  ' + (detail || '')}`);
  if (!ok) failures++;
}

// ---- 1) 引擎一致性 ----
const ctx = {};
vm.createContext(ctx);
vm.runInContext(read('js/data.js') + '; this.APP_DATA = APP_DATA;', ctx);
vm.runInContext(read('js/engine.js') + '; this.BacktestEngine = BacktestEngine;', ctx);
const rr = ctx.APP_DATA.realReturns;
const B = ctx.BacktestEngine;

const r = B.getDefaultResult();
const m = r.metrics;

// CAGR 一致性：finalValue 与 annual 互相印证
const totalRatio = m.finalValue / 500000;
const impliedAnnual = (Math.pow(totalRatio, 12 / m.totalMonths) - 1) * 100;
check('CAGR 一致 (annual≈implied)', Math.abs(impliedAnnual - m.annual) < 0.05,
  `annual=${m.annual.toFixed(4)} implied=${impliedAnnual.toFixed(4)}`);

// 月胜率一致性
const impliedWin = m.positiveMonths / m.totalMonths;
check('月胜率一致', Math.abs(impliedWin - m.monthlyWinRate) < 1e-9,
  `${m.positiveMonths}/${m.totalMonths} vs ${m.monthlyWinRate}`);

// 年度统计合理性
check('年度统计合理', m.yearly && m.yearly.fullYears >= 5 && m.yearly.negativeYears <= m.yearly.fullYears && m.yearly.worstYear < 0,
  JSON.stringify(m.yearly));

// 数据窗口一致性：months 标签数 = 资产收益条数 + 1（末位为下月占位）
const assetLen = Object.values(rr.asset_returns)[0].length;
check('数据窗口一致 (months=资产条数+1)', rr.months.length === assetLen + 1,
  `months=${rr.months.length} asset=${assetLen}`);

// 引擎回测窗口 = 真实数据条数（排除占位月，与 rolling 口径一致）
check('simulateCMV 窗口=真实数据条数', m.totalMonths === assetLen,
  `totalMonths=${m.totalMonths} asset=${assetLen}`);

// ---- 2) index.html 首屏 ID ----
const html = read('index.html');
const heroIds = ['hero-final-value', 'hero-final-sub', 'hero-winrate-label', 'hero-winrate-value',
  'hero-winrate-sub', 'hero-dd-value', 'hero-dd-sub', 'hero-cash-value'];
for (const id of heroIds) {
  check(`index.html 含 ${id}`, html.includes(`id="${id}"`));
}

// ---- 3) main.js 引用 ID 与 index.html 一致 ----
const main = read('js/main.js');
for (const id of heroIds) {
  check(`main.js 引用 ${id}`, main.includes(`'${id}'`) || main.includes(`"${id}"`));
}

// ---- 4) 三档卡片动态口径与静态 comparisons 对照（应基本吻合）----
const comp = ctx.APP_DATA.comparisons['三档方案对比'];
for (const id of Object.keys(B.PLANS)) {
  const dyn = B.simulateCMV(B.PLANS[id]);
  const stat = comp[id];
  const ok = dyn && stat && Math.abs(dyn.annual - stat.annual) < 0.01;
  check(`三档[${id}] 动态≈静态`, ok,
    ok ? `annual=${dyn.annual.toFixed(4)} vs ${stat.annual.toFixed(4)}` : `dyn=${dyn && dyn.annual} stat=${stat && stat.annual}`);
}

// ---- 5) 滚动回测日志末月 = 数据末月（防 off-by-one 回归：曾停在 2026-07）----
vm.runInContext(read('js/rolling.js') + '; this.RollingBacktest = RollingBacktest;', ctx);
const RB = ctx.RollingBacktest;
const rollingResults = RB.runAll();
const lastMonthInData = rr.months[rr.months.length - 1];
let rollingOk = true;
let badDetail = '';
for (const r of rollingResults) {
  const snaps = r.monthlySnapshots;
  const last = snaps.length ? snaps[snaps.length - 1].month : '(空)';
  if (last !== lastMonthInData) { rollingOk = false; badDetail += `${r.startPoint.label}:${last} `; }
}
check('滚动日志末月=数据末月 (无 off-by-one)', rollingOk,
  `data末月=${lastMonthInData}${badDetail ? ' 异常:' + badDetail : ''}`);

// ---- 6) 数据起点固化 2015-08：全周期真实数据、无估计值泄漏 ----
// 项目数据边界：五资产中历史最短的是中证500(新浪最早 2015-08)，故入场月地板=2015-08，
// 首个可算收益月=2015-09。起点固化于此，未来只增量 append 末月，绝不前移 months[0]。
const FLOOR = '2015-08';
check('数据起点地板=2015-08', rr.months[0] === FLOOR, `months[0]=${rr.months[0]}`);
let floorOk = true, estLeak = '', earliestStart = '9999';
for (const r of rollingResults) {
  const sp = r.startPoint, snaps = r.monthlySnapshots;
  const first = snaps.length ? snaps[0].month : '(空)';
  if (first < earliestStart) earliestStart = first;
  const est = snaps.filter(s => s.estimatedMonth).length;
  if (est > 0) { floorOk = false; estLeak += `${sp.label}/${sp.buildLabel}:${est}个估计月 `; }
}
check('最早入场月≥地板2015-08', earliestStart === FLOOR,
  `最早入场=${earliestStart}`);
check('12起点全真实数据(无估计泄漏)', floorOk,
  estLeak ? estLeak : '');

// ---- 7) 进行中月份进度快照（js/progress.json）不得污染主回测 ----
// 该文件只服务站内「进行中月份」区块（只读展示），其月份必须尚未进入 data.js 主数据；
// 一旦"进行中月"出现在 months 里，说明月度定稿已完成，快照文件应立即被重写/清理。
const PROG = path.join(ROOT, 'js/progress.json');
if (fs.existsSync(PROG)) {
  let p = null;
  try { p = JSON.parse(fs.readFileSync(PROG, 'utf8')); } catch (e) { p = null; }
  check('progress.json 可解析', !!p, 'JSON 解析失败');
  if (p) {
    check('progress.json 标记为进行中', p.in_progress === true, `in_progress=${p.in_progress}`);
    const leaked = p.in_progress_month && rr.months.includes(p.in_progress_month);
    check('进行中月份未泄漏进 data.js', !leaked,
      leaked ? `${p.in_progress_month} 已在 months 中 → 该月已定稿，请重跑 monthly_progress.js 或删除 progress.json` : '');
    check('progress.json 基准本金=50万', p.base_capital === 500000, `base_capital=${p.base_capital}`);
    check('progress.json 资产行数与 fund_map 一致',
      Array.isArray(p.assets) && p.assets.length === Object.keys(JSON.parse(read('scripts/fund_map.json')).assets).length + 1,
      `assets=${p.assets && p.assets.length}（应为风险资产数+现金1行）`);
  }
} else {
  check('progress.json 存在（站点进行中区块数据源）', true, '未生成，站点该区块将自动隐藏（非致命）');
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
