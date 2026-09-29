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
const NO_JSON = has('--no-json');
const JSON_OUT = arg('json') || 'js/progress.json';
const PUSH = has('--push');

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
  let lastDay = null;
  for (const k of daily) {
    const ym = k.day.slice(0, 7);
    const c = parseFloat(k.close);
    if (ym === prev) prevClose = c;       // 升序，后者覆盖 → 上月末收盘
    else if (ym === inProg) { lastProgClose = c; lastDay = k.day; } // 本月至今最后交易日收盘
  }
  if (prevClose == null || lastProgClose == null) return null;
  return { mtd: lastProgClose / prevClose - 1, lastDay };
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
      const m = computeMTD(daily, inProgressMonth, prevMonth);
      if (m == null) throw new Error('无 ' + inProgressMonth + ' 数据');
      return { ok: true, mtd: m.mtd, lastDay: m.lastDay, sym, asset };
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
      for (const asset of Object.keys(ASSETS)) mtdMap[asset] = { ok: false, mtd: 0, lastDay: null, sym: '(降级)', asset };
    }
  }
  mtdMap[CASH] = { ok: true, mtd: cashMTD(), lastDay: null, sym: 'cash', asset: CASH };

  // 估算当前市值：基准持仓 × (1 + MTD)
  let estTotal = 0;
  const rows = [];
  for (const asset of Object.keys(ASSETS).concat([CASH])) {
    const baseH = baseHoldings[asset] || 0;
    const mtd = mtdMap[asset].ok ? mtdMap[asset].mtd : 0;
    const est = baseH * (1 + mtd);
    estTotal += est;
    rows.push({ asset, mtd, baseH, est, lastDay: mtdMap[asset].lastDay || null, pct: baseTotal > 0 ? baseH / baseTotal : 0 });
  }
  const delta = estTotal - baseTotal;
  // 口径：与站内「月收益/年度收益率/累计收益」一致 → 一律 ÷ 固定基准本金 50 万（各分段可加）
  const deltaPctBase = CAP > 0 ? (delta / CAP) * 100 : 0;       // 本月至今（主指标）
  const deltaPctPrev = baseTotal > 0 ? (delta / baseTotal) * 100 : 0; // 相对上月末总市值（参考值）
  const cumPctBase = CAP > 0 ? (estTotal / CAP - 1) * 100 : 0;  // 累计（估算，÷50万）
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
  md += `- 进行中月：**${inProgressMonth}（非完整月，以下为月至今 MTD 估算，待月末收盘后由 monthly_update.js 定稿）**\n`;
  md += `- 取数状态：${fetchOk}/${Object.keys(ASSETS).length} 个风险资产实时成功` +
        (fetchFail > 0 ? `（${fetchFail} 个失败/降级）` : '') + `\n\n`;

  md += `## 各资产月至今(MTD)收益\n\n`;
  md += `| 资产 | MTD | 基准持仓(${lastCompleteMonth}) | 估算现值 |\n`;
  md += `| --- | --- | --- | --- |\n`;
  for (const r of rows) {
    md += `| ${r.asset} | ${sign(r.mtd * 100)}${(r.mtd * 100).toFixed(2)}% | ¥${fmtMoney(r.baseH)} | ¥${fmtMoney(r.est)} |\n`;
  }
  md += `\n`;

  md += `## 组合估算（进行中）\n\n`;
  md += `- 估算当前市值：**¥${fmtMoney(estTotal)}**（对固定基准 ¥${fmtMoney(CAP)} → 累计 ${sign(cumPctBase)}${cumPctBase.toFixed(2)}%）\n`;
  md += `- 本月至今收益：**${sign(deltaPctBase)}${deltaPctBase.toFixed(2)}%**（${sign(delta)}¥${fmtMoney(Math.abs(delta))} 变更，即 ${sign(delta)}${Math.abs(delta).toFixed(0)} 元）— ÷固定基准50万\n`;
  md += `  - 参考：同一变更金额若按上月末总市值 ¥${fmtMoney(baseTotal)} 计，为 ${sign(deltaPctPrev)}${deltaPctPrev.toFixed(2)}%（站内各收益列统一采用 ÷固定基准50万，故以 ${sign(deltaPctBase)}${deltaPctBase.toFixed(2)}% 为准）\n`;
  md += `- 状态：🟡 **进行中（非完整月）** — 本快照不写入主回测数据，仅作进度参考\n`;

  console.log(md);
  if (OUT) {
    fs.writeFileSync(path.join(ROOT, OUT), md, 'utf8');
    console.error(`[ok] 报告已写入 ${OUT}`);
  }

  // ---------------- 写前端数据源 js/progress.json ----------------
  if (!NO_JSON) {
    const payload = {
      generated_at: ts,
      in_progress: true,
      in_progress_month: inProgressMonth,
      base_month: lastCompleteMonth,
      data_as_of: dataAsOf,
      base_capital: CAP,
      base_total: Number(baseTotal.toFixed(2)),
      est_total: Number(estTotal.toFixed(2)),
      est_change_amount: Number(delta.toFixed(2)),
      est_change_pct_base: Number(deltaPctBase.toFixed(2)),   // ÷固定基准50万（站内统一口径）
      est_change_pct_prev: Number(deltaPctPrev.toFixed(2)),   // ÷上月末总市值（参考）
      cum_return_pct_base: Number(cumPctBase.toFixed(2)),
      fetch: { ok: fetchOk, fail: fetchFail },
      degraded: fetchOk === 0,
      assets: rows.map((r) => ({
        name: r.asset,
        mtd: Number((r.mtd * 100).toFixed(2)),
        base_holding: Number(r.baseH.toFixed(2)),
        est_value: Number(r.est.toFixed(2)),
        last_day: r.lastDay || null
      })),
      note: '非完整月（月至今 MTD）估算，不计入官方回测；月末收盘后由月度定稿流程写入正式数据。收益比例统一按固定基准 50 万口径。'
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
    if (unchanged) {
      console.error(`[skip] ${JSON_OUT} 数据无变化，未重写（保留原快照时间）`);
    } else {
      payload.generated_at = ts;
      fs.writeFileSync(jpath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
      console.error(`[ok] ${JSON_OUT} 已更新（${inProgressMonth} 估算 ¥${fmtMoney(estTotal)}，${sign(deltaPctBase)}${deltaPctBase.toFixed(2)}%）`);
    }
    if (PUSH) gitPushJson(JSON_OUT);
  }

  process.exit(fetchFail > 0 && fetchOk === 0 ? 2 : 0);
})();

// 仅提交并推送进度 JSON（有变化才提交），推后核对远程 tip
function gitPushJson(relPath) {
  const { execSync } = require('child_process');
  const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try {
    if (!run(`git status --porcelain -- ${relPath}`)) {
      console.error('[skip] git 无变更，跳过提交');
      return;
    }
    run(`git add -- ${relPath}`);
    const msg = `chore(progress): 更新进行中月份进度快照 ${relPath}\n\n由 scripts/monthly_progress.js --push 自动生成（只读快照，不修改 data.js / real_returns.json）`;
    execSync('git commit -F -', { cwd: ROOT, input: msg, stdio: ['pipe', 'pipe', 'pipe'] });
    const branch = run('git rev-parse --abbrev-ref HEAD');
    run(`git push origin ${branch}`);
    const tip = execSync(`git ls-remote origin ${branch}`, { cwd: ROOT }).toString().trim().split(/\s+/)[0];
    const local = run('git rev-parse HEAD');
    console.error(tip === local ? `[ok] 已推送，远程 tip=${tip.slice(0, 7)}` : `[warn] 远程 tip=${tip.slice(0, 7)} 与本地 ${local.slice(0, 7)} 不一致，请人工核对`);
  } catch (e) {
    console.error('[warn] commit/push 失败：' + String(e.message || e).split('\n')[0]);
  }
}

// 月份标签 +1（YYYY-MM 格式，跨年自动进位）
function nextMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const nm = m + 1;
  if (nm > 12) return `${y + 1}-01`;
  return `${y}-${String(nm).padStart(2, '0')}`;
}
