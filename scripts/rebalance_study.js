#!/usr/bin/env node
// scripts/rebalance_study.js
//
// 再平衡策略研究（双研究）
//  研究1：再平衡频率扫描 — 5 档（1周/2周/1月/2月/3月），每档产出 13 行滚动回测表
//  研究2：再平衡日扫描 — 31 档（每月第 1~31 个交易日），每号产出 13 行滚动回测表
//
// 输出格式：与生产线「滚动回测汇总」一致
//   起点 / 回测周期 / 回测月数 / 最终市值 / 总收益率 / 年化 / 最大回撤 / Sharpe / 月胜率 / 正收益月
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

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(dataSrc + '\nthis.APP_DATA = APP_DATA;', sandbox);
vm.runInContext(engineSrc + '\nthis.BacktestEngine = BacktestEngine;', sandbox);

const AD = sandbox.APP_DATA;
const BE = sandbox.BacktestEngine;

// 加载日K线
const dailyCache = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/_daily_cache.json'), 'utf8'));
console.error('[日K线] 沪深300=' + dailyCache['沪深300'].length +
              ', 中证500=' + dailyCache['中证500'].length +
              ', 标普500=' + dailyCache['标普500'].length +
              ', 纳指100=' + dailyCache['纳斯达克100'].length +
              ', 黄金=' + dailyCache['黄金'].length);

const PLAN = { '沪深300': 0.15, '中证500': 0.05, '标普500': 0.15, '纳斯达克100': 0.20, '黄金': 0.20, '现金·货币基金': 0.25 };

/**
 * 从 monthlyReturns 切出 idx 起的子序列，按月收益计算指标
 */
function sliceAndFormat(monthlyReturns, t0, label) {
  const sub = monthlyReturns.slice(t0);
  if (sub.length < 6) return null;
  let cum = 1, peak = 1, maxDd = 0;
  for (const r of sub) {
    cum *= (1 + r);
    if (cum > peak) peak = cum;
    const dd = (cum / peak - 1) * 100;
    if (dd < maxDd) maxDd = dd;
  }
  const total = (cum - 1) * 100;
  const years = sub.length / 12;
  const annual = (Math.pow(cum, 1 / years) - 1) * 100;
  const mean = sub.reduce((a, b) => a + b, 0) / sub.length;
  const variance = sub.length > 1 ? sub.reduce((s, r) => s + (r - mean) ** 2, 0) / (sub.length - 1) : 0;
  const annVol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
  const sharpe = annVol > 0 ? (annual / 100 - 0.02) / annVol : 0;
  const posMonths = sub.filter(r => r > 0).length;
  const winRate = (posMonths / sub.length) * 100;

  return {
    起点: label,
    回测月数: sub.length,
    最终市值: 500000 * cum,
    总收益率: total,
    年化收益: annual,
    最大回撤: maxDd,
    Sharpe: sharpe,
    月胜率: winRate,
    正收益月: posMonths + '/' + sub.length
  };
}

/**
 * 生产线 13 行滚动回测起点：11y/10y/9y/8y/7y/6y/5y/4y/3y/2y/1y 前入场 + 最近 12/24 月
 */
function rollingStartIndices(totalMonths) {
  const items = [];
  for (let y = 11; y >= 2; y--) {
    items.push({ label: y + '年前入场', idx: totalMonths - y * 12 });
  }
  items.push({ label: '1年前入场', idx: totalMonths - 12 });
  items.push({ label: '最近12个月', idx: totalMonths - 12 });
  return items.filter(x => x.idx >= 0 && x.idx + 6 <= totalMonths);
}

/**
 * 把 BE 跑出的结果切成 13 行滚动回测表
 */
function buildQuarterRows(result, modeLabel) {
  if (!result) return { rows: [], totalMonths: 0 };
  const monthlyReturns = result.monthlyReturns;
  const totalMonths = monthlyReturns.length;
  const starts = rollingStartIndices(totalMonths);
  // 月份标签（project 真实月份）
  const months = (AD.realReturns && AD.realReturns.months) || [];
  const rows = starts.map(s => {
    // 用 months[s.idx] 当起点标签（处理越界）
    const tag = months[s.idx] || ('M' + s.idx);
    return sliceAndFormat(monthlyReturns, s.idx, tag + ' (' + s.label + ')');
  }).filter(Boolean);
  return { rows, totalMonths };
}

function fmtWan(v) { return (v / 10000).toFixed(1) + '万'; }
function fmtPct(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }

/**
 * 渲染 13 行表体（无标题）
 */
function renderTableBody(rows) {
  if (!rows.length) return '_无数据_\n\n';
  let out = '| 起点 | 回测月数 | 最终市值 | 总收益率 | 年化收益 | 最大回撤 | Sharpe | 月胜率 | 正收益月 |\n';
  out += '|---|---|---|---:|---:|---:|---:|---:|---|\n';
  for (const r of rows) {
    out += `| ${r.起点} | ${r.回测月数}个月 | `
         + fmtWan(r.最终市值) + ' | '
         + fmtPct(r.总收益率) + ' | '
         + fmtPct(r.年化收益) + ' | '
         + r.最大回撤.toFixed(2) + '% | '
         + r.Sharpe.toFixed(4) + ' | '
         + r.月胜率.toFixed(2) + '% | '
         + r.正收益月 + ' |\n';
  }
  return out + '\n';
}

/**
 * 渲染单个象限的 13 行表
 */
function renderTable(title, rows) {
  return `### ${title}\n\n` + renderTableBody(rows);
}

function avg(rows, k) { return rows.reduce((s, r) => s + r[k], 0) / rows.length; }

// ====== 主流程 ======
let out = '';
out += '# 再平衡策略研究 — 日频深度报告\n\n';
out += '> **数据**：日 K 线（5 资产 × ~3000 天，覆盖 2014-04 至今，新浪前复权），5 资产交集起点 = 2014-04-23；研究窗口 = 2015-08 至今 133 月（与月频 131 月对齐至月初）。\n';
out += '> **配置**：稳健型（沪深300 15% / 中证500 5% / 标普500 15% / 纳指100 20% / 黄金 20% / 现金25%），初始 ¥50万，建仓1月首月到位，再平衡阈值 ±5%，费率 0.1%。\n';
out += '> **引擎**：`js/engine.js` 新增 `simulateCMV_daily`（基于日 K 线的恒市值法回测）。\n';
out += '> **口径说明**：日频视角下 `最大回撤` 比月频大（约 -20%），因能捕捉月内极端值；横向对比依然有效。\n';
out += '> **输出**：每象限 13 行滚动回测表（与生产线「滚动回测汇总」字段对齐：起点 / 回测月数 / 最终市值 / 总收益 / 年化 / 最大回撤 / Sharpe / 月胜率 / 正收益月）。\n\n';

// ============================
// 研究 1：再平衡频率扫描
// ============================
out += '## 研究 1：再平衡频率扫描\n\n';
out += '**5 档对比**：1 周 / 2 周 / 1 月 / 2 月 / 3 月\n\n';
out += '| 档位 | schedule | 触发时机 |\n|---|---|---|\n';
out += '| 1 周 1 次 | `weekly-mon` | 每周一检查 |\n';
out += '| 2 周 1 次 | `biweekly-mon` | 双周周一检查 |\n';
out += '| 1 月 1 次（当前默认） | `monthly-eom` | 每月最后一个交易日检查 |\n';
out += '| 2 月 1 次 | `every-2-months-eom` | 每 2 月最后一个交易日检查 |\n';
out += '| 3 月 1 次 | `every-3-months-eom` | 每 3 月最后一个交易日检查 |\n\n';

const study1Schedules = [
  { label: '1 周 1 次（每周一）', schedule: 'weekly-mon' },
  { label: '2 周 1 次（双周周一）', schedule: 'biweekly-mon' },
  { label: '1 月 1 次（每月末·当前默认）', schedule: 'monthly-eom' },
  { label: '2 月 1 次（每 2 月末）', schedule: 'every-2-months-eom' },
  { label: '3 月 1 次（每 3 月末）', schedule: 'every-3-months-eom' }
];

const study1Results = [];
for (const s of study1Schedules) {
  console.error('[研究1] ' + s.label + ' ...');
  const result = BE.simulateCMV_daily(PLAN, {
    schedule: s.schedule, threshold: 0.05, feeRate: 0.001,
    buildMonths: 1, totalCapital: 500000,
    dailyCache
  });
  const { rows } = buildQuarterRows(result, s.label);
  out += renderTable(s.label, rows);
  if (rows.length) {
    study1Results.push({
      label: s.label,
      平均年化: avg(rows, '年化收益'),
      平均回撤: avg(rows, '最大回撤'),
      平均Sharpe: avg(rows, 'Sharpe'),
      平均月胜率: avg(rows, '月胜率'),
      平均终值: avg(rows, '最终市值'),
      rows
    });
  }
}

out += `---\n\n### 研究 1 频率排名（按 13 行滚动回测平均）\n\n`;
out += '| 排序 | 频率 | 平均年化 | 平均最大回撤 | 平均Sharpe | 平均月胜率 | 平均终值 |\n';
out += '|---|---|---:|---:|---:|---:|---:|\n';
study1Results
  .slice()
  .sort((a, b) => b.平均年化 - a.平均年化)
  .forEach((s, i) => {
    out += `| ${i+1} | ${s.label} | ${fmtPct(s.平均年化)} | ${s.平均回撤.toFixed(2)}% | ${s.平均Sharpe.toFixed(4)} | ${s.平均月胜率.toFixed(2)}% | ${fmtWan(s.平均终值)} |\n`;
  });
out += '\n';

// ============================
// 研究 2：再平衡日扫描
// ============================
out += `---\n\n## 研究 2：再平衡日扫描\n\n`;
out += '**31 档对比**：每月第 1~31 个交易日（遇周末顺延下一交易日）。\n\n';
out += '> **说明**：因每月交易日数不等（通常 20~23 个），实际触发日为「每月第 N 个交易日」而非日历 N 号。例：第 1 个交易日 ≈ 月初首个工作日；第 22+ 个交易日 ≈ 月末。\n\n';

const study2Results = [];
for (let day = 1; day <= 31; day++) {
  const label = `每月第 ${day} 号（遇周末顺延）`;
  const schedule = `monthly-day-${day}`;
  console.error('[研究2] ' + label + ' ...');
  // 跑两组阈值：±5%（生产口径）+ ±1%（更敏感，能放大日号差异）
  const result5 = BE.simulateCMV_daily(PLAN, {
    schedule, threshold: 0.05, feeRate: 0.001,
    buildMonths: 1, totalCapital: 500000, dailyCache
  });
  const result1 = BE.simulateCMV_daily(PLAN, {
    schedule, threshold: 0.01, feeRate: 0.001,
    buildMonths: 1, totalCapital: 500000, dailyCache
  });
  out += `### ${label}\n\n`;
  out += '**±5% 阈值（生产口径）**：\n\n';
  out += renderTableBody(buildQuarterRows(result5, label).rows);
  out += '**±1% 阈值（更敏感，放大日号差异）**：\n\n';
  out += renderTableBody(buildQuarterRows(result1, label).rows);

  // 用 ±1% 作为排名口径（±5% 下日号差异不显著）
  const { rows } = buildQuarterRows(result1, label);
  if (rows.length) {
    study2Results.push({
      label,
      平均年化: avg(rows, '年化收益'),
      平均回撤: avg(rows, '最大回撤'),
      平均Sharpe: avg(rows, 'Sharpe'),
      平均月胜率: avg(rows, '月胜率'),
      平均终值: avg(rows, '最终市值'),
      rows
    });
  }
}

out += `---\n\n### 研究 2 日号排名（按 13 行滚动回测平均）\n\n`;
out += '| 排序 | 再平衡日 | 平均年化 | 平均最大回撤 | 平均Sharpe | 平均月胜率 | 平均终值 |\n';
out += '|---|---|---:|---:|---:|---:|---:|\n';
study2Results
  .slice()
  .sort((a, b) => b.平均年化 - a.平均年化)
  .forEach((s, i) => {
    out += `| ${i+1} | ${s.label} | ${fmtPct(s.平均年化)} | ${s.平均回撤.toFixed(2)}% | ${s.平均Sharpe.toFixed(4)} | ${s.平均月胜率.toFixed(2)}% | ${fmtWan(s.平均终值)} |\n`;
  });
out += '\n';

console.log(out);
const reportPath = path.join(ROOT, 'scripts/_rebalance_study_report.md');
fs.writeFileSync(reportPath, out, 'utf8');
console.error('\n[报告已保存到 ' + reportPath + ']');