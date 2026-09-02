#!/usr/bin/env node
// scripts/recompute_derived.js
//
// 重算 js/data.js 中「写死的派生字段」，使其与 simulateCMV 的实时计算结果一致。
//
// 为什么需要它：
//   js/data.js 里 comparisons（三档方案）和 finalConfig.backtest 是**预先算好写死的**结果。
//   每月补入新的月收益后，前端动态部分（Hero 卡 / 三档卡片 / 雷达图 / 对比柱状图）会自动跟着变，
//   但这两个写死块不会 —— 于是出现「动态 ≈ 静态」对不上，scripts/smoke_check.js 会报 FAIL。
//   本脚本的作用就是让静态块追上动态结果。
//
// 用法：
//   node scripts/recompute_derived.js --check   # 只对比不写入，输出差异表；有差异时退出码 1
//   node scripts/recompute_derived.js           # 发现不一致时改写 js/data.js（改前自动备份 .bak）
//
// 退出码：0 = 静态已与动态一致（或写回后复核通过）；1 = 发现不一致/复核失败；2 = 运行出错
//
// 字段命名对照（两套不一样，别改混）：
//   simulateCMV 返回  : annual(百分数) maxDd(百分数) sharpe sortino total(百分数)
//                       finalValue(元) monthlyWinRate(小数) annVol(小数)
//   comparisons.*     : annual dd sharpe sortino total_return final_value win_rate(百分数) monthly_vol
//   finalConfig.backtest: annual total_return max_dd sharpe sortino final_value win_rate(百分数) monthly_vol
//
// 关联：scripts/RELEASE_CHECKLIST.md 阶段 3

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'js', 'data.js');

const PLAN_IDS = ['conservative', 'balanced', 'aggressive'];
const NAMES = { conservative: '保守', balanced: '稳健', aggressive: '进取' };

// ---------------------------------------------------------------- 区块定义
// 每个区块：定位用的正则 + 字段映射（静态键 -> 由动态值算出的写入值）
// write: 生成写回文件的字符串；expect: 生成用于比对的数值（与静态同量纲）
// 注：写回时保留完整浮点精度（不做 toFixed 截断），这样 diff 里只出现真正变化的字段。
//     截断到 4 位会造成"值没变但行变了"的噪音 diff。
const full = (v) => String(v);
const round0 = (v) => String(Math.round(v));

const SECTIONS = [
  ...PLAN_IDS.map((id) => ({
    key: 'comparisons.' + id,
    label: NAMES[id] + '型 (comparisons.' + id + ')',
    match: new RegExp('("' + id + '"\\s*:\\s*\\{)([\\s\\S]*?)(\\n\\s{4}\\})'),
    fields: [
      { st: 'annual', get: (d) => d.annual, put: (d) => full(d.annual), tol: 0.005 },
      { st: 'dd', get: (d) => d.maxDd, put: (d) => full(d.maxDd), tol: 0.005 },
      { st: 'sharpe', get: (d) => d.sharpe, put: (d) => full(d.sharpe), tol: 0.005 },
      { st: 'sortino', get: (d) => d.sortino, put: (d) => full(d.sortino), tol: 0.005 },
      { st: 'total_return', get: (d) => d.total, put: (d) => full(d.total), tol: 0.01 },
      { st: 'final_value', get: (d) => d.finalValue, put: (d) => round0(d.finalValue), tol: 50 },
      { st: 'win_rate', get: (d) => d.monthlyWinRate * 100, put: (d) => full(d.monthlyWinRate * 100), tol: 0.01 },
      { st: 'monthly_vol', get: (d) => d.annVol * 100, put: (d) => full(d.annVol * 100), tol: 0.01 }
    ],
    dyn: (BE, rr) => BE.simulateCMV(BE.PLANS[id], rr)
  })),
  {
    key: 'finalConfig.backtest',
    label: '最终方案 (finalConfig.backtest = 稳健型)',
    match: /("backtest"\s*:\s*\{)([\s\S]*?)(\n\s{4}\})/,
    fields: [
      { st: 'annual', get: (d) => d.annual, put: (d) => full(d.annual), tol: 0.005 },
      { st: 'max_dd', get: (d) => d.maxDd, put: (d) => full(d.maxDd), tol: 0.005 },
      { st: 'sharpe', get: (d) => d.sharpe, put: (d) => full(d.sharpe), tol: 0.005 },
      { st: 'sortino', get: (d) => d.sortino, put: (d) => full(d.sortino), tol: 0.005 },
      { st: 'total_return', get: (d) => d.total, put: (d) => full(d.total), tol: 0.01 },
      { st: 'final_value', get: (d) => d.finalValue, put: (d) => round0(d.finalValue), tol: 50 },
      { st: 'win_rate', get: (d) => d.monthlyWinRate * 100, put: (d) => full(d.monthlyWinRate * 100), tol: 0.01 },
      { st: 'monthly_vol', get: (d) => d.annVol * 100, put: (d) => full(d.annVol * 100), tol: 0.01 }
    ],
    dyn: (BE, rr) => BE.simulateCMV(BE.PLANS.balanced, rr)
  }
];

// ---------------------------------------------------------------- 载入
function loadSandbox() {
  const sandbox = { console, Math, Date, JSON };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(DATA_PATH, 'utf8') + '\nthis.APP_DATA = APP_DATA;', sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'js', 'engine.js'), 'utf8') + '\nthis.BacktestEngine = BacktestEngine;',
    sandbox
  );
  return sandbox;
}

// 从区块文本里读出某个键的数值
function readStatic(body, stKey) {
  const re = new RegExp('"' + stKey + '"\\s*:\\s*(-?[0-9.]+)');
  const m = body.match(re);
  return m ? parseFloat(m[1]) : undefined;
}

// ---------------------------------------------------------------- 对比
function collect(src, sandbox) {
  const AD = sandbox.APP_DATA;
  const BE = sandbox.BacktestEngine;
  const rr = AD.realReturns;
  const rows = [];

  for (const sec of SECTIONS) {
    const m = src.match(sec.match);
    if (!m) { rows.push({ sec, missing: true }); continue; }
    const body = m[2];
    const d = sec.dyn(BE, rr);
    const items = sec.fields.map((f) => {
      const sv = readStatic(body, f.st);
      const dv = f.get(d);
      return { st: f.st, dv, sv, tol: f.tol, put: f.put(d) };
    });
    rows.push({ sec, body, d, items, raw: m });
  }
  return rows;
}

function report(rows) {
  let bad = 0;
  console.log('字段'.padEnd(14), '区块'.padEnd(42), '动态值'.padStart(14), '静态值'.padStart(14), '  状态');
  console.log('-'.repeat(96));
  for (const r of rows) {
    if (r.missing) {
      console.log(''.padEnd(14), r.sec.key.padEnd(42), ''.padStart(14), ''.padStart(14), '  ✗ 未定位到区块');
      bad++;
      continue;
    }
    for (const it of r.items) {
      if (it.sv === undefined) {
        console.log(it.st.padEnd(14), r.sec.key.padEnd(42), String(it.dv.toFixed(4)).padStart(14), '(缺失)'.padStart(14), '  ⚠ 静态无此字段');
        bad++;
        continue;
      }
      const diff = Math.abs(it.dv - it.sv);
      const ok = diff <= it.tol;
      if (!ok) bad++;
      console.log(
        it.st.padEnd(14), r.sec.key.padEnd(42),
        it.dv.toFixed(4).padStart(14), String(it.sv).padStart(14),
        '  ' + (ok ? 'OK' : '差 ' + diff.toFixed(4) + ' > 容差 ' + it.tol)
      );
    }
  }
  console.log('-'.repeat(96));
  console.log(bad === 0 ? '✓ 静态已与动态一致' : '✗ 有 ' + bad + ' 处不一致');
  return bad;
}

// ---------------------------------------------------------------- 写回
function writeBack(src, rows) {
  let out = src;
  for (const r of rows) {
    if (r.missing) continue;
    let body = r.body;
    for (const it of r.items) {
      const re = new RegExp('("' + it.st + '"\\s*:\\s*)(-?[0-9.]+)');
      if (re.test(body)) body = body.replace(re, '$1' + it.put);
    }
    out = out.replace(r.sec.match, r.raw[1] + body + r.raw[3]);
  }
  fs.copyFileSync(DATA_PATH, DATA_PATH + '.bak');
  fs.writeFileSync(DATA_PATH, out, 'utf8');
  console.log('已写入 ' + path.relative(ROOT, DATA_PATH) + '（改前备份 js/data.js.bak）');
}

// ---------------------------------------------------------------- main
(function main() {
  const checkOnly = process.argv.includes('--check');
  let sandbox;
  try {
    sandbox = loadSandbox();
  } catch (e) {
    console.error('载入 data.js / engine.js 失败：', e.message);
    process.exit(2);
  }

  const src = fs.readFileSync(DATA_PATH, 'utf8');
  const bad = report(collect(src, sandbox));

  if (checkOnly) process.exit(bad === 0 ? 0 : 1);
  if (bad === 0) { console.log('无需写入。'); process.exit(0); }

  writeBack(src, collect(src, sandbox));

  // 写回后复核
  try {
    const sb2 = loadSandbox();
    const src2 = fs.readFileSync(DATA_PATH, 'utf8');
    const bad2 = report(collect(src2, sb2));
    console.log(bad2 === 0 ? '✓ 写回后复核通过' : '⚠ 写回后仍有 ' + bad2 + ' 处不一致，请检查字段命名（备份在 js/data.js.bak）');
    process.exit(bad2 === 0 ? 0 : 1);
  } catch (e) {
    console.error('复核时解析失败：', e.message, '（data.js 可能已被写坏，请用 js/data.js.bak 恢复）');
    process.exit(2);
  }
})();
