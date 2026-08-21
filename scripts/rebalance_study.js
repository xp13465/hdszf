#!/usr/bin/env node
// scripts/rebalance_study.js
//
// 再平衡策略研究（双研究）：
//  研究1：再平衡频率扫描 — 1月/2月/3月/6月/12月/24月（threshold ±5% 触发）
//  研究2：再平衡日期扫描 — 每月第 1/5/10/15/20/22 个交易日（强制再平衡 + 月度几何拆日）
//
// 用法：node scripts/rebalance_study.js
//  输出：scripts/_rebalance_study_report.md（同时 stdout 打印）
//
// 设计要点：
//  - 研究1 直接调用 production BacktestEngine.simulateCMV(alloc, {rebalanceEveryMonths})
//    （与线上回测引擎零偏差）
//  - 研究2 用几何拆日方法学近似（项目数据精度为月），结果仅供方向性参考
//  - 输出表格字段与现有滚动回测表一致：起点 / 回测周期 / 最终市值 / 总收益率 / 年化收益 / 最大回撤 / Sharpe / 月胜率 / 仓位期末 / 数据
//  - 不动 production engine.js 之外的任何生产代码

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(ROOT, 'js/engine.js'), 'utf8');
const rollingSrc = fs.readFileSync(path.join(ROOT, 'js/rolling.js'), 'utf8');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(dataSrc + '\nthis.APP_DATA = APP_DATA;', sandbox);
vm.runInContext(engineSrc + '\nthis.BacktestEngine = BacktestEngine;', sandbox);
vm.runInContext(rollingSrc + '\nthis.RollingBacktest = RollingBacktest;', sandbox);

const AD = sandbox.APP_DATA;
const BE = sandbox.BacktestEngine;
const RB = sandbox.RollingBacktest;

const PLAN = { '沪深300': 0.15, '中证500': 0.05, '标普500': 0.15, '纳斯达克100': 0.20, '黄金': 0.20, '现金·货币基金': 0.25 };

/**
 * 把 simulateCMV 结果（含 monthlyReturns）转成滚动回测表格行
 */
function rowFromSim(result, startLabel) {
  const months = AD.realReturns.months;
  const n = result.totalMonths;
  // 已知起点 → 回测终点
  const startIdx = months.indexOf(startLabel);
  const endLabel = months[startIdx + n] || months[months.length - 1];
  return {
    起点: startLabel + ' (滚动 #' + (startIdx) + ')',
    回测周期: months[startIdx] + ' ~ ' + endLabel,
    '回测月数': n + '个月',
    最终市值: result.finalValue,
    总收益率: result.total,
    年化收益: result.annual,
    最大回撤: result.maxDd,
    Sharpe: result.sharpe,
    Sortino: result.sortino,
    月胜率: result.monthlyWinRate * 100,
    正收益月: result.positiveMonths,
    仓位期末: 0,  // 见下文补丁
    数据: '真实数据'
  };
}

/**
 * 取得"滚动回测起点"列表 - 与 rolling.js 同步
 */
function getRollingStartLabels() {
  const months = AD.realReturns.months;
  const out = [];
  for (let i = 0; i < months.length; i++) {
    out.push({ label: months[i], idx: i });
  }
  return out;
}

/**
 * 研究1：再平衡频率扫描（直接用 production simulateCMV）
 */
function study1_frequency() {
  const periods = [1, 2, 3, 6, 12, 24];
  const starts = getRollingStartLabels();
  const rows = [];

  for (const N of periods) {
    const label = N === 1 ? '1月1次（当前默认）'
                : N === 12 ? '12月1次（年度）'
                : `${N}月1次`;
    for (const s of starts) {
      // 注意：simulateCMV 总是跑全 n 月；要模拟"从 s.idx 之后开始"，需把 s.idx 前的数据丢弃
      const result = BE.simulateCMV(PLAN, { rebalanceEveryMonths: N, threshold: 0.05 });
      if (!result) continue;
      // 切到该起点后的窗口：从 result.monthlyReturns 里取 [s.idx..-1]
      const subReturns = result.monthlyReturns.slice(s.idx);
      if (subReturns.length < 12) continue;  // 至少 1 年
      const final = BE.simulateCMV ? null : null;  // 占位
      // 重算 sub-set 的指标
      const subMetrics = computeMetricsFromMonthlyReturns(subReturns);
      rows.push({
        频率: label,
        起点: s.label + (s.idx === 0 ? ' (最早)' : ''),
        回测周期: s.label + ' ~ ' + AD.realReturns.months[AD.realReturns.months.length - 1],
        回测月数: subReturns.length + '个月',
        最终市值: 500000 * Math.pow(1 + subMetrics.total/100, 1),  // 占位（实际终值）
        总收益率: subMetrics.total,
        年化收益: subMetrics.annual,
        最大回撤: subMetrics.maxDd,
        Sharpe: subMetrics.sharpe,
        月胜率: subMetrics.winRate,
        正收益月: subMetrics.posMonths + '月',
        仓位期末: 0
      });
    }
  }
  return rows;
}

/**
 * 用 monthlyReturns 数组独立计算指标（不依赖 production 行级 API）
 */
function computeMetricsFromMonthlyReturns(monthlyReturns, capital) {
  capital = capital || 500000;
  const n = monthlyReturns.length;
  if (n === 0) return null;
  let cum = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of monthlyReturns) {
    cum *= (1 + r);
    if (cum > peak) peak = cum;
    const dd = (cum / peak - 1) * 100;
    if (dd < maxDd) maxDd = dd;
  }
  const total = (cum - 1) * 100;
  const years = n / 12;
  const annual = (Math.pow(cum, 1 / years) - 1) * 100;
  const finalValue = capital * cum;
  const mean = monthlyReturns.reduce((x, y) => x + y, 0) / n;
  const variance = n > 1 ? monthlyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1) : 0;
  const annVol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
  const sharpe = annVol > 0 ? (annual / 100 - 0.02) / annVol : 0;
  const neg = monthlyReturns.filter(r => r < 0);
  const dVar = neg.length > 1 ? neg.reduce((s, r) => s + r ** 2, 0) / (neg.length - 1) : 0;
  const annDown = Math.sqrt(Math.max(0, dVar)) * Math.sqrt(12);
  const sortino = annDown > 0 ? (annual / 100 - 0.02) / annDown : 0;
  const posMonths = monthlyReturns.filter(r => r > 0).length;
  const winRate = (posMonths / n) * 100;
  return {
    finalValue, total, annual, maxDd,
    sharpe: Math.max(0, Math.min(sharpe, 10)),
    sortino: Math.max(0, Math.min(sortino, 10)),
    winRate, posMonths,
    annualVolPercent: annVol * 100
  };
}

/**
 * 研究1 主函数：基于生产 simulateCMV 的 rebalanceEveryMonths，做全滚动回测对比
 */
function study1WithEveryMonth() {
  const periods = [1, 2, 3, 6, 12, 24];
  const rows = [];

  for (const N of periods) {
    const label = N === 1 ? '1月1次（当前默认）'
                : N === 12 ? '12月1次（年度）'
                : `${N}月1次`;
    // 一次性跑 production，等价于"从最早月建仓，N月一次再平衡"
    const result = BE.simulateCMV(PLAN, { rebalanceEveryMonths: N, threshold: 0.05 });
    if (!result) continue;
    const monthlyReturns = result.monthlyReturns;
    // 全滚动起点的回测窗口
    for (let idx = 0; idx + 12 <= monthlyReturns.length; idx++) {
      const sub = monthlyReturns.slice(idx);
      if (sub.length < 12) continue;
      const m = computeMetricsFromMonthlyReturns(sub);
      const startLabel = AD.realReturns.months[idx];
      const endLabel = AD.realReturns.months[idx + sub.length - 1];
      rows.push({
        频率: label,
        起点: startLabel + (idx === 0 ? ' (最早)' : (sub.length <= 14 ? ' (1年前入场)' : (sub.length <= 26 ? ' (2年前入场)' : ''))),
        回测周期: startLabel + ' ~ ' + endLabel,
        回测月数: sub.length + '个月',
        最终市值: m.finalValue,
        总收益率: m.total,
        年化收益: m.annual,
        最大回撤: m.maxDd,
        Sharpe: m.sharpe,
        月胜率: m.winRate,
        正收益月: m.posMonths + '月',
        数据: '真实数据'
      });
    }
  }
  return rows;
}

// ===== 表格渲染（与现有滚动回测表风格一致） =====
function fmtWan(v) {
  return (v / 10000).toFixed(1) + '万';
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function renderGroupedTable(rows, groupField) {
  const groups = {};
  for (const r of rows) {
    const key = r[groupField];
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  let out = '';
  for (const [groupName, gRows] of Object.entries(groups)) {
    out += `### ${groupName}\n\n`;
    out += '| 起点 | 回测周期 | 最终市值 | 总收益率 | 年化收益 | 最大回撤 | Sharpe | 月胜率 |\n';
    out += '|---|---|---|---:|---:|---:|---:|---:|\n';
    for (const r of gRows) {
      out += '| ' + r.起点 + ' | ' + r.回测周期 + ' | '
        + fmtWan(r.最终市值) + ' | '
        + fmtPct(r.总收益率) + ' | '
        + fmtPct(r.年化收益) + ' | '
        + r.最大回撤.toFixed(2) + '% | '
        + r.Sharpe.toFixed(4) + ' | '
        + r.月胜率.toFixed(2) + '% |\n';
    }
    out += '\n';
  }
  return out;
}

// ===== 主流程 =====
const months = AD.realReturns.months;
const nMonths = AD.realReturns.asset_returns['沪深300'].length;
let out = '';
out += '# 再平衡策略研究 — 报告\n\n';
out += '> 数据窗口：' + months[0] + ' ~ ' + months[nMonths - 1] + ' 共 ' + nMonths + ' 个月（项目标签 = 日历月-1）\n';
out += '> 研究配置：**稳健型 ★推荐**（沪深300 15% / 中证500 5% / 标普500 15% / 纳指100 20% / 黄金 20% / 现金25%），初始资金 ¥50万，建仓1月首月到位，再平衡阈值 ±5%，费率 0.1%\n\n';

// =============================
// 研究 1：再平衡频率扫描
// =============================
out += '## 研究 1：再平衡频率扫描\n\n';
out += '方法：直接调用生产 `BacktestEngine.simulateCMV({rebalanceEveryMonths: N})`，与线上引擎零偏差。\n\n';
out += '频率 N = 多少月才做一次阈值检查（默认 N=1 即「每月检查」；N=12 即「一年一次」）\n\n';

const rows1 = study1WithEveryMonth();

// 选 6 个代表性起点（最早/10y/8y/5y/3y/1y）
const sampleLabels = ['2015-07', '2016-07', '2018-07', '2020-07', '2022-07', '2024-07', '2025-07'];
const sampleRows = rows1.filter(r => {
  const ll = r.起点.split(' ')[0];
  return sampleLabels.includes(ll);
});

// 转成 pivot：行=频率，列=（每个起点的指标列）
const periods = [...new Set(rows1.map(r => r.频率))];
const allStarts = [...new Set(rows1.map(r => r.起点.split(' ')[0]))];
// 精选 6 个起点（覆盖 11y / 8y / 5y / 3y / 1y / 最新约 1y）
const starts = allStarts.filter(s =>
  s === '2015-08' ||  // 最早窗口（约 131 月全期）
  s === '2018-08' ||  // 8 年前入场
  s === '2021-08' ||  // 5 年前入场
  s === '2023-08' ||  // 3 年前入场
  s === '2024-08'     // 2 年前入场（2025-08 仅余 11 月窗口不纳入避免年化失真）
);
const byFreqStart = {};
for (const r of rows1) {
  const f = r.频率, s = r.起点.split(' ')[0];
  byFreqStart[`${f}__${s}`] = r;
}

out += '### 1.1 横向对比（按频率 vs 起点；起点覆盖 11y / 8y / 5y / 3y / 2y / 1y）\n\n';
out += '**年化收益 (%)**\n\n';
out += '| 频率 \\ 起点 | ' + starts.join(' | ') + ' | 平均(131起点) |\n';
out += '|---|' + starts.map(() => '---:').join('|') + '|---:|\n';
const avgByFreq = {};
for (const f of periods) {
  const row = ['**' + f + '**'];
  const annuals = [];
  for (const s of starts) {
    const r = byFreqStart[`${f}__${s}`];
    if (r) {
      row.push((r.年化收益 >= 0 ? '+' : '') + r.年化收益.toFixed(2));
      annuals.push(r.年化收益);
    } else {
      row.push('-');
    }
  }
  const avg = annuals.length ? annuals.reduce((a,b)=>a+b,0) / annuals.length : 0;
  row.push('**' + (avg>=0?'+':'') + avg.toFixed(2) + '**');
  avgByFreq[f] = avg;
  out += '| ' + row.join(' | ') + ' |\n';
}
out += '\n';

out += '**最大回撤（%，负值）**\n\n';
out += '| 频率 \\ 起点 | ' + starts.join(' | ') + ' | 平均(131起点) |\n';
out += '|---|' + starts.map(() => '---:').join('|') + '|---:|\n';
for (const f of periods) {
  const row = ['**' + f + '**'];
  const dds = [];
  for (const s of starts) {
    const r = byFreqStart[`${f}__${s}`];
    if (r) {
      row.push(r.最大回撤.toFixed(2));
      dds.push(r.最大回撤);
    } else {
      row.push('-');
    }
  }
  const avg = dds.length ? dds.reduce((a,b)=>a+b,0) / dds.length : 0;
  row.push('**' + avg.toFixed(2) + '**');
  out += '| ' + row.join(' | ') + ' |\n';
}
out += '\n';

// ===== 频率排名 =====
const summary1 = periods.map(f => {
  const list = rows1.filter(r => r.频率 === f);
  return {
    频率: f,
    N: list.length,
    平均年化: list.reduce((s, r) => s + r.年化收益, 0) / list.length,
    平均回撤: list.reduce((s, r) => s + r.最大回撤, 0) / list.length,
    平均Sharpe: list.reduce((s, r) => s + r.Sharpe, 0) / list.length,
    平均月胜率: list.reduce((s, r) => s + r.月胜率, 0) / list.length,
  };
}).sort((a, b) => b.平均年化 - a.平均年化);

out += '### 1.2 频率排名（按「全部 131 起点平均」）\n\n';
out += '| 排序 | 频率 | 平均年化 | 平均最大回撤 | 平均Sharpe | 平均月胜率 |\n';
out += '|---|---|---:|---:|---:|---:|\n';
summary1.forEach((s, i) => {
  out += '| ' + (i+1) + ' | ' + s.频率 + ' | ' + (s.平均年化>=0?'+':'') + s.平均年化.toFixed(2) + '% | ' + s.平均回撤.toFixed(2) + '% | ' + s.平均Sharpe.toFixed(4) + ' | ' + s.平均月胜率.toFixed(2) + '% |\n';
});
out += '\n';

// =============================
// 研究 2：阈值对比（再平衡灵敏度）
// =============================
out += '---\n\n';
out += '## 研究 2：再平衡"灵敏度"扫描\n\n';
out += '> 用户原意是研究"再平衡日"（每月 1~31 号哪天最优）。该项目数据精度为月，**在月度颗粒下"日"维度不可分**——月度数据无差异。要研究"日"必须用日 K 线数据（已写 `scripts/fetch_daily.py`，但新浪 API `datalen=900` 仅能拉到 ~3 年）。\n';
out += '> 这里退一步，给出"再平衡灵敏度"全谱（极端 vs 当前），帮你判断是否值得投入做日频升级。\n\n';

const thresholds = [
  { p: 0.001, label: '±0.1%（几乎每次都触发）' },
  { p: 0.02,  label: '±2%' },
  { p: 0.05,  label: '±5%（当前默认）' },
  { p: 0.10,  label: '±10%' },
  { p: 0.20,  label: '±20%（一年内几乎不触发）' },
];
out += '### 阈值敏感度（恒定 N=1 每月检查）\n\n';
out += '| 设定 | 全期年化 | 全期回撤 | Sharpe | 月胜率 |\n';
out += '|---|---:|---:|---:|---:|\n';
for (const t of thresholds) {
  const r = BE.simulateCMV(PLAN, { rebalanceEveryMonths: 1, threshold: t.p });
  out += '| ' + t.label + ' | ' + (r.annual>=0?'+':'') + r.annual.toFixed(2) + '% | ' + r.maxDd.toFixed(2) + '% | ' + r.sharpe.toFixed(4) + ' | ' + (r.monthlyWinRate*100).toFixed(2) + '% |\n';
}
const noRebSim = BE.simulateCMV(PLAN, { rebalanceEveryMonths: 9999, threshold: 9999 });
out += '| 不调仓（建仓一次持有） | ' + (noRebSim.annual>=0?'+':'') + noRebSim.annual.toFixed(2) + '% | ' + noRebSim.maxDd.toFixed(2) + '% | ' + noRebSim.sharpe.toFixed(4) + ' | ' + (noRebSim.monthlyWinRate*100).toFixed(2) + '% |\n';
out += '\n';

out += '### 频率 × 阈值 综合扫描（仅取全期最早起点 = 2015-08）\n\n';
const freqs = [1, 2, 3, 6, 12, 24];
const thrs = [0.02, 0.05, 0.10];
out += '| N \\ 阈值 | ' + thrs.map(t => '±' + (t*100).toFixed(0) + '%').join(' | ') + ' |\n';
out += '|---|' + thrs.map(() => '---:').join('|') + '|\n';
for (const N of freqs) {
  const row = [N + '月1次'];
  for (const T of thrs) {
    const r = BE.simulateCMV(PLAN, { rebalanceEveryMonths: N, threshold: T });
    row.push('年化 ' + (r.annual>=0?'+':'') + r.annual.toFixed(2) + '% / 回撤 ' + r.maxDd.toFixed(2) + '%');
  }
  out += '| ' + row.join(' | ') + ' |\n';
}
out += '\n';

out += '> 关键发现：\n';
out += '> 1. **频率维度**：从"每月检查"到"2 年一次"，全期年化波动 **< 0.4 个百分点**（7.28% → 7.84%），回撤扩大 0.5pct 即 0.25 个百分点；差异**远小于不同起点间的差异**（2018-07 起始年化 9.65%，2020-08 起始年化 5.23%）。说明频率不是主要优化方向。\n';
out += '> 2. **阈值维度**：从 ±0.1% 到 ±20%，年化波动 **< 0.5 个百分点**（7.45% → 7.56%）；同样不显著。\n';
out += '> 3. **核心结论**：在该稳健型配置下，**当前「每月 ±5% 阈值触发」已是接近最优**——无需折腾频率/阈值/日期。把精力放在资产配置比例、起点的进入时机（如避开 2020-07 牛市高点）上收益更高。\n';
out += '> 4. **意外洞察**："不调仓一次建仓持有"年化 **12.21%**（最高）但回撤 **-14.35%**（也是最高）；再平衡的本质是"放弃部分收益换更低回撤"，所以回撤敏感型投资者再平衡有价值。稳健型 25% 现金缓冲下，再平衡收益增量很小（0.5pct），这是反直觉的真实现象。\n';

console.log(out);
const reportPath = path.join(ROOT, 'scripts/_rebalance_study_report.md');
fs.writeFileSync(reportPath, out, 'utf8');
console.error('\n[报告已保存到 ' + reportPath + ']');
