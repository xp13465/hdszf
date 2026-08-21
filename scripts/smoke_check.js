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

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
