// scripts/_smoke_daily.js — 最小冒烟测试
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
const dailyCache = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/_daily_cache.json'), 'utf8'));

const PLAN = { '沪深300': 0.15, '中证500': 0.05, '标普500': 0.15, '纳斯达克100': 0.20, '黄金': 0.20, '现金·货币基金': 0.25 };

console.log('====== monthly-eom ======');
let r = BE.simulateCMV_daily(PLAN, {
  schedule: 'monthly-eom', threshold: 0.05, feeRate: 0.001,
  buildMonths: 1, totalCapital: 500000,
  dailyCache
});
console.log('annual=', r.annual.toFixed(2), 'maxDd=', r.maxDd.toFixed(2),
  'totalMonths=', r.totalMonths,
  'winRate=', (r.monthlyWinRate*100).toFixed(2) + '%',
  'final=', r.finalValue.toFixed(0));
console.log('monthlyReturns sample:', r.monthlyReturns.slice(0, 6));

console.log('\n====== weekly-mon ======');
r = BE.simulateCMV_daily(PLAN, {
  schedule: 'weekly-mon', threshold: 0.05, feeRate: 0.001,
  buildMonths: 1, totalCapital: 500000,
  dailyCache
});
console.log('annual=', r.annual.toFixed(2), 'maxDd=', r.maxDd.toFixed(2),
  'totalMonths=', r.totalMonths,
  'winRate=', (r.monthlyWinRate*100).toFixed(2) + '%');

console.log('\n====== biweekly-mon ======');
r = BE.simulateCMV_daily(PLAN, {
  schedule: 'biweekly-mon', threshold: 0.05, feeRate: 0.001,
  buildMonths: 1, totalCapital: 500000,
  dailyCache
});
console.log('annual=', r.annual.toFixed(2), 'maxDd=', r.maxDd.toFixed(2),
  'totalMonths=', r.totalMonths,
  'winRate=', (r.monthlyWinRate*100).toFixed(2) + '%');

console.log('\n====== monthly-day-1 ======');
r = BE.simulateCMV_daily(PLAN, {
  schedule: 'monthly-day-1', threshold: 0.05, feeRate: 0.001,
  buildMonths: 1, totalCapital: 500000,
  dailyCache
});
console.log('annual=', r.annual.toFixed(2), 'maxDd=', r.maxDd.toFixed(2),
  'totalMonths=', r.totalMonths,
  'winRate=', (r.monthlyWinRate*100).toFixed(2) + '%');

console.log('\n====== monthly-day-15 ======');
r = BE.simulateCMV_daily(PLAN, {
  schedule: 'monthly-day-15', threshold: 0.05, feeRate: 0.001,
  buildMonths: 1, totalCapital: 500000,
  dailyCache
});
console.log('annual=', r.annual.toFixed(2), 'maxDd=', r.maxDd.toFixed(2),
  'totalMonths=', r.totalMonths,
  'winRate=', (r.monthlyWinRate*100).toFixed(2) + '%');

// 对比月频 baseline
console.log('\n====== BASELINE 月频 simulateCMV ======');
const baseline = BE.simulateCMV(PLAN, { rebalanceEveryMonths: 1, threshold: 0.05 });
console.log('annual=', baseline.annual.toFixed(2), 'maxDd=', baseline.maxDd.toFixed(2),
  'totalMonths=', baseline.totalMonths,
  'winRate=', (baseline.monthlyWinRate*100).toFixed(2) + '%',
  'final=', baseline.finalValue.toFixed(0));