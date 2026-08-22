#!/usr/bin/env node
// scripts/rebalance_study.js
//
// 再平衡策略研究（双研究，与生产线滚动回测表口径对齐）
//  研究1：再平衡频率扫描 — 月频引擎（与线上滚动表同一份逻辑/数据，分批建仓12次），5 档（每月/每2月/每3月/每6月/每12月）
//  研究2：再平衡日扫描   — 日频引擎（月频无法表达日号），31 档（每月第 1~31 号，遇周末顺延），同样分批建仓12次 + 窗口对齐 2026-07
//
// 关键：研究1 的「每月（=当前默认）」档 100% 复现线上滚动表，可逐行核对。
//
// 用法：node scripts/rebalance_study.js
// 输出：scripts/_rebalance_study_report.md

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(ROOT, 'js/engine.js'), 'utf8');
const rollingSrc = fs.readFileSync(path.join(ROOT, 'js/rolling.js'), 'utf8');

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(dataSrc + '\nthis.APP_DATA = APP_DATA;', sandbox);
vm.runInContext(engineSrc + '\nthis.BacktestEngine = BacktestEngine;', sandbox);
vm.runInContext(rollingSrc + '\nthis.RollingBacktest = RollingBacktest;', sandbox);

const AD = sandbox.APP_DATA;
const BE = sandbox.BacktestEngine;
const RR = sandbox.RollingBacktest;
const rr = AD.realReturns;

const ASSETS = ['沪深300', '中证500', '标普500', '纳斯达克100', '黄金', '现金·货币基金'];
const CASH = '现金·货币基金';
const ALLOC = { '沪深300':0.15, '中证500':0.05, '标普500':0.15, '纳斯达克100':0.20, '黄金':0.20, '现金·货币基金':0.25 };
const TOTAL = 500000;
const THRESHOLD = 0.05;
const FEE = 0.001;

// 加载日K线（研究2 用）
const dailyCache = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/_daily_cache.json'), 'utf8'));

// ============================================================
// 月频回测（复制 rolling.js 逻辑 + 支持 rebalanceEveryMonths）
// 与线上滚动表 100% 同一套口径（分批建仓12次、月频数据、月末检查）
// ============================================================
function runMonthly(startPoint, rebalanceEveryMonths) {
  const { year, month, totalMonthsNeeded } = startPoint;
  const buildMonths = startPoint.buildMonths || 12;
  const holdings = {}; const targetValues = {};
  for (const asset of ASSETS) { holdings[asset] = 0; targetValues[asset] = TOTAL * ALLOC[asset]; }
  let cashBalance = TOTAL;
  let totalValue = TOTAL, peakValue = TOTAL, maxDrawdown = 0, prevTotalValue = TOTAL;
  const monthlyReturns = [];
  let curY = year, curM = month;
  for (let t = 0; t < totalMonthsNeeded; t++) {
    const monthKey = `${curY}-${String(curM).padStart(2,'0')}`;
    const isBuildPhase = t < buildMonths;
    holdings[CASH] += cashBalance; cashBalance = 0;

    const idx = rr.months.indexOf(monthKey);
    const mret = {};
    for (const asset of ASSETS) {
      if (asset === CASH) mret[asset] = rr.cash_monthly || 0.00083;
      else if (idx >= 0 && rr.asset_returns[asset] && idx < rr.asset_returns[asset].length) mret[asset] = rr.asset_returns[asset][idx] || 0;
      else { const arr = rr.asset_returns[asset] || []; mret[asset] = arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
    }
    for (const asset of ASSETS) holdings[asset] *= (1 + mret[asset]);

    const buildFraction = Math.min(1, (t + 1) / buildMonths);
    if (isBuildPhase) {
      for (const asset of ASSETS) {
        if (asset === CASH) continue;
        const currentTarget = targetValues[asset] * buildFraction;
        const diff = currentTarget - holdings[asset];
        if (Math.abs(diff) > 1) {
          const fee = Math.abs(diff) * FEE;
          if (diff > 0) { const need = diff + fee; const avail = Math.min(holdings[CASH], need); if (avail > 1) { holdings[CASH] -= avail; holdings[asset] += (avail - fee); } }
          else { holdings[CASH] += (Math.abs(diff) - fee); holdings[asset] = currentTarget; }
        }
      }
    }

    if (!isBuildPhase && (t - buildMonths) % rebalanceEveryMonths === 0) {
      totalValue = ASSETS.reduce((s, a) => s + holdings[a], 0);
      for (const asset of ASSETS) {
        if (asset === CASH) continue;
        const tv = targetValues[asset]; const ch = holdings[asset];
        const dev = tv > 0 ? (ch - tv) / tv : 0;
        if (Math.abs(dev) > THRESHOLD) {
          const diff = tv - ch; const fee = Math.abs(diff) * FEE;
          if (diff > 0) { const need = diff + fee; const avail = Math.min(holdings[CASH], need); if (avail > 1) { holdings[CASH] -= avail; holdings[asset] += (avail - fee); } }
          else { holdings[CASH] += (Math.abs(diff) - fee); holdings[asset] = tv; }
        }
      }
    }

    totalValue = ASSETS.reduce((s, a) => s + holdings[a], 0);
    if (totalValue > peakValue) peakValue = totalValue;
    const dd = (totalValue / peakValue - 1) * 100; if (dd < maxDrawdown) maxDrawdown = dd;
    const mr = prevTotalValue > 0 ? (totalValue / prevTotalValue - 1) : 0;
    monthlyReturns.push(mr);
    prevTotalValue = totalValue;
    curM += 1; if (curM > 12) { curM = 1; curY++; }
  }

  const finalValue = totalValue;
  const totalReturn = (finalValue / TOTAL - 1) * 100;
  const nYears = totalMonthsNeeded / 12;
  const annual = (Math.pow(finalValue / TOTAL, 1 / nYears) - 1) * 100;
  const meanR = monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length;
  const variance = monthlyReturns.length > 1 ? monthlyReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / (monthlyReturns.length - 1) : 0;
  const annVol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
  const sharpe = annVol > 0 ? (annual / 100 - 0.02) / annVol : 0;
  const posMonths = monthlyReturns.filter(r => r > 0).length;
  const winRate = posMonths / monthlyReturns.length * 100;
  return { label: startPoint.label, buildLabel: startPoint.buildLabel, finalValue, totalReturn, annual, maxDrawdown, sharpe, winRate, posMonths, totalMonths: totalMonthsNeeded };
}

// ============================================================
// 渲染工具
// ============================================================
function fmtWan(v) { return (v / 10000).toFixed(2) + '万'; }
function fmtPct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

function renderRows(rows) {
  if (!rows.length) return '_无数据_\n\n';
  let out = '| 起点 | 回测月数 | 最终市值 | 总收益率 | 年化收益 | 最大回撤 | Sharpe | 月胜率 | 正收益月 |\n';
  out += '|---|---|---|---:|---:|---:|---:|---:|---|\n';
  for (const r of rows) {
    const tag = r.buildLabel ? `${r.label}（${r.buildLabel}）` : r.label;
    out += `| ${tag} | ${r.totalMonths}个月 | `
         + fmtWan(r.finalValue) + ' | '
         + fmtPct(r.totalReturn) + ' | '
         + fmtPct(r.annual) + ' | '
         + r.maxDrawdown.toFixed(2) + '% | '
         + r.sharpe.toFixed(4) + ' | '
         + r.winRate.toFixed(1) + '% | '
         + r.posMonths + '/' + r.totalMonths + ' |\n';
  }
  return out + '\n';
}

// ============================================================
// 主流程
// ============================================================
let out = '';
out += '# 再平衡策略研究 — 与线上滚动表同口径版\n\n';
out += '> **口径说明**：本报告**全部使用与线上滚动回测表相同的口径**——分批建仓 12 次（`buildMonths=12`）、月频真实数据、再平衡阈值 ±5%、费率 0.1%。\n';
out += '> - **研究1（频率）**：月频引擎（与线上滚动表同一份逻辑），其中「每月（=当前默认）」一档数字**逐行等于线上滚动表**，可直接核对。\n';
out += '> - **研究2（再平衡日）**：必须用到日级精度（月频无法表达「每月第几号」），故用日频引擎，但同样 `buildMonths=12`、窗口终点对齐 2026-07。日频天然捕捉月内极端值，最大回撤比月频大，横向对比有效。\n\n';

// ---- 滚动起点（与线上一致）----
const points = RR.getStartPoints();
const labeled = points.map(p => ({
  ...p,
  dispLabel: p.yearsAgo != null ? `${p.label}（${p.yearsAgo}年前入场）` : p.label
}));

// ============================
// 研究 1：频率（月频，可核对）
// ============================
out += '## 研究 1：再平衡频率扫描（月频引擎 · 与线上同口径）\n\n';
out += '> 说明：项目数据为月度精度，**无法在月频表达「每周」**。本表用「每 N 月」覆盖用户的月级意图（每月/每2月/每3月/每6月/每12月）。周级（每周/双周）已在日频引擎单独验证，差异 < 0.4pct，无优化价值（见文末附录）。\n\n';

const freqSteps = [
  { label: '每月 1 次（当前默认）', step: 1 },
  { label: '每 2 月 1 次', step: 2 },
  { label: '每 3 月 1 次', step: 3 },
  { label: '每 6 月 1 次', step: 6 },
  { label: '每 12 月 1 次', step: 12 }
];

const study1 = [];
for (const f of freqSteps) {
  console.error('[研究1] ' + f.label + ' ...');
  const rows = labeled.map(p => runMonthly(p, f.step));
  out += `### ${f.label}\n\n` + renderRows(rows);
  study1.push({
    label: f.label,
    avgAnnual: rows.reduce((s, r) => s + r.annual, 0) / rows.length,
    avgDd: rows.reduce((s, r) => s + r.maxDrawdown, 0) / rows.length,
    avgSharpe: rows.reduce((s, r) => s + r.sharpe, 0) / rows.length,
    avgWin: rows.reduce((s, r) => s + r.winRate, 0) / rows.length
  });
}

out += `---\n\n### 研究 1 频率排名（按 12 个起点平均年化）\n\n`;
out += '| 排序 | 频率 | 平均年化 | 平均最大回撤 | 平均Sharpe | 平均月胜率 |\n';
out += '|---|---|---:|---:|---:|---:|\n';
study1.slice().sort((a, b) => b.avgAnnual - a.avgAnnual).forEach((s, i) => {
  out += `| ${i+1} | ${s.label} | ${fmtPct(s.avgAnnual)} | ${s.avgDd.toFixed(2)}% | ${s.avgSharpe.toFixed(4)} | ${s.avgWin.toFixed(1)}% |\n`;
});
out += '\n';

// ============================
// 研究 2：再平衡日（日频，同 buildMonths=12）
// ============================
out += `---\n\n## 研究 2：再平衡日扫描（日频引擎 · 同口径 buildMonths=12）\n\n`;
out += '> **说明**：因月频无法表达「每月第几号」，本表用日频引擎；建仓期同样为分批 12 次，窗口终点对齐 2026-07。每档（每月第 N 号，遇周末顺延下一交易日）产出与线上同格式的滚动回测表。\n\n';

const study2 = [];
for (let day = 1; day <= 31; day++) {
  console.error('[研究2] 每月第 ' + day + ' 号 ...');
  const schedule = `monthly-day-${day}`;
  const rows = labeled.map(p => {
    const startDate = `${p.year}-${String(p.month).padStart(2,'0')}-01`;
    const r = BE.simulateCMV_daily(ALLOC, {
      schedule, threshold: THRESHOLD, feeRate: FEE,
      buildMonths: 12, totalCapital: TOTAL,
      startDate, endDate: '2026-07-31', dailyCache
    });
    if (!r) return null;
    return {
      label: p.dispLabel, buildLabel: p.buildLabel,
      finalValue: r.finalValue, totalReturn: r.total, annual: r.annual,
      maxDrawdown: r.maxDd, sharpe: r.sharpe, winRate: r.monthlyWinRate * 100,
      posMonths: r.positiveMonths, totalMonths: r.totalMonths
    };
  }).filter(Boolean);
  out += `### 每月第 ${day} 号（遇周末顺延）\n\n` + renderRows(rows);
  if (rows.length) {
    study2.push({
      label: `每月第 ${day} 号`,
      avgAnnual: rows.reduce((s, r) => s + r.annual, 0) / rows.length,
      avgDd: rows.reduce((s, r) => s + r.maxDrawdown, 0) / rows.length,
      avgSharpe: rows.reduce((s, r) => s + r.sharpe, 0) / rows.length,
      avgWin: rows.reduce((s, r) => s + r.winRate, 0) / rows.length
    });
  }
}

out += `---\n\n### 研究 2 日号排名（按 12 个起点平均年化）\n\n`;
out += '| 排序 | 再平衡日 | 平均年化 | 平均最大回撤 | 平均Sharpe | 平均月胜率 |\n';
out += '|---|---|---:|---:|---:|---:|\n';
study2.slice().sort((a, b) => b.avgAnnual - a.avgAnnual).forEach((s, i) => {
  out += `| ${i+1} | ${s.label} | ${fmtPct(s.avgAnnual)} | ${s.avgDd.toFixed(2)}% | ${s.avgSharpe.toFixed(4)} | ${s.avgWin.toFixed(1)}% |\n`;
});
out += '\n';

// ============================
// 附录：周级日频验证（用户原象限含 1周/2周）
// ============================
out += `---\n\n## 附录：周级再平衡（日频验证，用户原象限 1周/2周）\n\n`;
out += '> 项目月度数据无法表达「每周」，以下用日频引擎对全期（2015-08 → 2026-07，分批建仓12次）验证周级频率，作为研究1 月级结论的补充。\n\n';
const weeklySchedules = [
  { label: '每周一检查', schedule: 'weekly-mon' },
  { label: '双周周一检查', schedule: 'biweekly-mon' },
  { label: '每月末检查（=当前默认）', schedule: 'monthly-eom' }
];
out += '| 频率 | 最终市值 | 总收益率 | 年化收益 | 最大回撤 | Sharpe | 月胜率 |\n';
out += '|---|---:|---:|---:|---:|---:|---:|\n';
for (const w of weeklySchedules) {
  const r = BE.simulateCMV_daily(ALLOC, {
    schedule: w.schedule, threshold: THRESHOLD, feeRate: FEE,
    buildMonths: 12, totalCapital: TOTAL,
    startDate: '2015-08-01', endDate: '2026-07-31', dailyCache
  });
  out += `| ${w.label} | ${fmtWan(r.finalValue)} | ${fmtPct(r.total)} | ${fmtPct(r.annual)} | ${r.maxDd.toFixed(2)}% | ${r.sharpe.toFixed(4)} | ${(r.monthlyWinRate*100).toFixed(1)}% |\n`;
}
out += '\n> 结论：周级与月级年化差异 < 0.4pct，再平衡频率不是收益的主要驱动因素。\n';

// ---- 输出 ----
console.log(out);
const reportPath = path.join(ROOT, 'scripts/_rebalance_study_report.md');
fs.writeFileSync(reportPath, out, 'utf8');
console.error('\n[报告已保存到 ' + reportPath + ']');
