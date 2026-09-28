#!/usr/bin/env node
/**
 * 恒市值助手 · 进行中月份进度快照
 *
 * 用途：每周 / 每个交易日跑一次，取「当前未完成月」的月至今(MTD)收益，
 *       把最新完整月(2026-08)的组合持仓往前推一步，给出本月进行中的组合进度估算。
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
 *
 * 退出码：0 成功（含"进行中"标记）；2 取数全部失败（已降级为占位，仍可输出）。
 */
'use strict';

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

// ---------------- 加载数据与滚动引擎 ----------------
const ctx = {};
vm.createContext(ctx);
vm.runInContext(read('js/data.js') + '; this.APP_DATA = APP_DATA;', ctx);
vm.runInContext(read('js/rolling.js') + '; this.RollingBacktest = RollingBacktest;', ctx);
const rr = ctx.APP_DATA.realReturns;
const RB = ctx.RollingBacktest;

// 最新完整月 = months 末位；进行中月 = 其下一月
const lastCompleteMonth = rr.months[rr.months.length - 1];
const inProgressMonth = nextMonthLabel(lastCompleteMonth);
const prevMonth = lastCompleteMonth;

// 取「全量回测(数据最早月·一次建仓)」组合在最新完整月的持仓与市值，作为进度估算的基准
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

function computeMTD(daily, inProg, prev) {
  let prevClose = null;
  let lastProgClose = null;
  for (const k of daily) {
    const ym = k.day.slice(0, 7);
    const c = parseFloat(k.close);
    if (ym === prev) prevClose = c;       // 升序，后者覆盖 → 上月末收盘
    else if (ym === inProg) lastProgClose = c; // 本月至今最后交易日收盘
  }
  if (prevClose == null || lastProgClose == null) return null;
  return lastProgClose / prevClose - 1;
}

async function fetchMTDForAsset(asset, cfg) {
  const candidates = [cfg.sina, ...(cfg.backup || [])];
  let lastErr = null;
  for (const sym of candidates) {
    try {
      const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=900&adj=qfq`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.sina.com.cn' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const daily = await res.json();
      const mtd = computeMTD(daily, inProgressMonth, prevMonth);
      if (mtd == null) throw new Error('无 ' + inProgressMonth + ' 数据');
      return { ok: true, mtd, sym, asset };
    } catch (e) {
      lastErr = e;
    }
  }
  return { ok: false, err: lastErr ? String(lastErr.message || lastErr) : 'unknown', asset };
}

// 现金 MTD：按本月已过天数占比折算（现金月收益 cashMonthly）
function cashMTD() {
  const [y, m] = inProgressMonth.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = new Date();
  const elapsed = Math.min(today.getDate(), daysInMonth);
  return cashMonthly * (elapsed / daysInMonth);
}

// ---------------- 主流程 ----------------
(async () => {
  const mtdMap = {};
  let fetchOk = 0;
  let fetchFail = 0;

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
    if (fetchFail > 0 && fetchOk === 0) {
      console.error('  ⚠ 全部资产取数失败，已降级为 MTD=0 占位');
      for (const asset of Object.keys(ASSETS)) mtdMap[asset] = { ok: false, mtd: 0, sym: '(降级)', asset };
    }
  }
  mtdMap[CASH] = { ok: true, mtd: cashMTD(), sym: 'cash', asset: CASH };

  // 估算当前市值：基准持仓 × (1 + MTD)
  let estTotal = 0;
  const rows = [];
  for (const asset of Object.keys(ASSETS).concat([CASH])) {
    const baseH = baseHoldings[asset] || 0;
    const mtd = mtdMap[asset].ok ? mtdMap[asset].mtd : 0;
    const est = baseH * (1 + mtd);
    estTotal += est;
    rows.push({ asset, mtd, baseH, est, pct: baseTotal > 0 ? baseH / baseTotal : 0 });
  }
  const delta = estTotal - baseTotal;
  const deltaPct = baseTotal > 0 ? (delta / baseTotal) * 100 : 0;

  // ---------------- 渲染报告 ----------------
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const fmtMoney = (v) => (v >= 10000 ? (v / 10000).toFixed(2) + '万' : v.toFixed(0));
  const sign = (v) => (v >= 0 ? '+' : '');

  let md = '';
  md += `# 恒市值组合 · 进行中月份进度快照\n\n`;
  md += `- 生成时间：${ts}\n`;
  md += `- 基准月（最新完整月）：${lastCompleteMonth}，组合市值 ¥${fmtMoney(baseTotal)}\n`;
  md += `- 进行中月：**${inProgressMonth}（非完整月，以下为月至今 MTD 估算，待月末收盘后由 monthly_update.js 定稿）**\n`;
  md += `- 取数状态：${fetchOk}/${Object.keys(ASSETS).length} 个风险资产实时成功` +
        (fetchFail > 0 ? `（${fetchFail} 个失败/降级）` : '') + `\n\n`;

  md += `## 各资产月至今(MTD)收益\n\n`;
  md += `| 资产 | MTD | 基准持仓(2026-08) | 估算现值 |\n`;
  md += `| --- | --- | --- | --- |\n`;
  for (const r of rows) {
    md += `| ${r.asset} | ${sign(r.mtd * 100)}${(r.mtd * 100).toFixed(2)}% | ¥${fmtMoney(r.baseH)} | ¥${fmtMoney(r.est)} |\n`;
  }
  md += `\n`;

  md += `## 组合估算（进行中）\n\n`;
  md += `- 估算当前市值：**¥${fmtMoney(estTotal)}**\n`;
  md += `- 本月至今收益：**${sign(deltaPct)}${deltaPct.toFixed(2)}%**（${sign(delta)}¥${fmtMoney(Math.abs(delta))}）\n`;
  md += `- 状态：🟡 **进行中（非完整月）** — 本快照不写入主回测数据，仅作进度参考\n`;

  console.log(md);
  if (OUT) {
    fs.writeFileSync(path.join(ROOT, OUT), md, 'utf8');
    console.error(`[ok] 报告已写入 ${OUT}`);
  }

  process.exit(fetchFail > 0 && fetchOk === 0 ? 2 : 0);
})();

// 月份标签 +1（YYYY-MM 格式，跨年自动进位）
function nextMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const nm = m + 1;
  if (nm > 12) return `${y + 1}-01`;
  return `${y}-${String(nm).padStart(2, '0')}`;
}
