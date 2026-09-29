#!/usr/bin/env node
/**
 * 冒烟检查：数据更新后的一键自检
 *   node scripts/smoke_check.js
 *
 * 校验内容：
 *  1) 引擎输出内部一致性（CAGR、月胜率、年度统计、窗口=入场月+收益月）
 *  2) index.html 首屏 Hero 卡片 ID 齐全
 *  3) main.js 的 updateHeroStats 引用的 ID 与 index.html 一致
 *  4) 三档卡片动态口径 ≈ data.js 静态 comparisons
 *  5) 滚动日志末月 = 数据末月（防 off-by-one 回归）
 *  6) 数据起点固化 2015-08、12 起点无估计值泄漏
 *  7) progress.json 不污染主回测（基准月/资产名/÷50万口径）
 *  8) 两套引擎口径一致（simulateCMV == RollingBacktest，一次建仓版 & 分批建仓版）
 *  9) 进行中月份叠加层 == progress.json（est_total / 累计% / 月数 +1、非法叠加被拒）
 *     第二轮追加：滚动引擎同源叠加（result.live 与 engine 逐项一致、monthlySnapshots 未被污染、
 *     进行中月 opCount=0、累计月序=冻结月数+1）、空值/空表不得冒充 0
 * 10) 降级快照闸门：progress.json 若标记 degraded，估算字段必须全为 null，
 *     绝不允许出现用 0 填补出来的「当月持平」（会被 live overlay 当成真估算发到全站）
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

// 引擎回测窗口 = 入场月 + 全部真实收益月（= months 标签数，与 rolling.js 的 totalMonthsNeeded 同源）
check('simulateCMV 窗口=入场月+真实收益月', m.totalMonths === assetLen + 1,
  `totalMonths=${m.totalMonths} asset=${assetLen}（应 ${assetLen + 1}）`);

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
// 该文件只服务站内『完整持仓日志』末行的「进行中(MTD)」追加行（只读展示），
// 其月份必须尚未进入 data.js 主数据；一旦"进行中月"出现在 months 里，
// 说明月度定稿已完成，快照文件应立即被重写/清理。
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

    // 前端 buildLiveRows 是按「资产名」匹配 MTD 的，名称不一致会静默按 0% 处理 → 必须逐字校验
    const mainAssets = (read('js/main.js').match(/const ASSETS = \[([^\]]+)\]/) || [, ''])
      .slice(1).join('')
      .split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    check('progress.json 资产名与 main.js ASSETS 逐字一致',
      Array.isArray(p.assets) && mainAssets.length > 0 &&
      p.assets.length === mainAssets.length && mainAssets.every(n => p.assets.some(a => a.name === n)),
      `main.js=[${mainAssets.join('/')}] progress=[${(p.assets || []).map(a => a.name).join('/')}]`);

    // 前端仅在「基准月 = 日志末月」时才追加进行中行 → 基准月漂移会导致该行整体消失
    // （同理：live overlay 也会因月份「不晚于数据末月」被 setLiveOverlay 拒绝，全站「含当月估」标记撤下）
    // 定稿后 base_month 必然落后一个月 → 重跑 node scripts/monthly_progress.js 即可（monthly_update.js 已自动代跑）
    check('progress.json 基准月=主数据末月', p.base_month === rr.months[rr.months.length - 1],
      `base_month=${p.base_month} months末位=${rr.months[rr.months.length - 1]} → 快照已过期，重跑 node scripts/monthly_progress.js`);

    // 口径红线：本月至今比例的分母必须是「固定基准本金 50 万」，不是上月末总市值
    const impliedBasePct = p.base_capital ? (p.est_change_amount / p.base_capital) * 100 : 0;
    check('progress.json 本月至今比例=收益金额÷固定基准50万',
      Math.abs((p.est_change_pct_base || 0) - impliedBasePct) < 0.05,
      `est_change_pct_base=${p.est_change_pct_base} 应为 ${impliedBasePct.toFixed(2)}（禁止用上月末总市值作分母）`);
  }
} else {
  check('progress.json 存在（站点日志「进行中行」数据源）', true, '未生成，日志将不含进行中行（非致命）');
}

// ---- 8) 两套引擎口径一致（2026-09-29 统一）----
// 背景：simulateCMV 曾按 arr[t] 取值，把 2015-09 的收益应用在空仓上 → 组合只吃到 131 个月收益
//       却对外报 132 个月，导致首屏/三档（112.22万 / 累计 124.44% / 年化 7.63%）与滚动日志
//       （110.58万 / 121.16% / 7.42%）两套数字并存。现两者必须逐项相等。
const earliest = rollingResults.find(x => x.startPoint.isEarliest);
const comparison = rollingResults.find(x => x.startPoint.isComparison);
function crossCheck(tag, eng, rb) {
  const rows = [
    ['终值', eng.finalValue, rb.finalValue],
    ['累计收益%', eng.total, rb.totalReturn],
    ['年化%', eng.annual, rb.annualReturn],
    ['最大回撤%', eng.maxDd, rb.maxDrawdown],
    ['Sharpe', eng.sharpe, rb.sharpe],
    ['月胜率%', eng.monthlyWinRate * 100, rb.winRate],
    ['月数', eng.totalMonths, rb.totalMonths]
  ];
  const bad = rows.filter(([, a, b]) => Math.abs(a - b) > 1e-6)
    .map(([k, a, b]) => `${k}: engine=${a} rolling=${b}`);
  check(`两引擎口径一致 · ${tag}`, bad.length === 0, bad.join(' | '));
}
crossCheck('一次建仓版', B.simulateCMV(B.PLANS.balanced, { liveOverlay: false }), earliest);
crossCheck('分批建仓版(同起点)', B.simulateCMV(B.PLANS.balanced, { buildMonths: 12, liveOverlay: false }), comparison);

// ---- 9) 进行中月份叠加层（live overlay）：结果必须与 progress.json 逐位一致 ----
// 叠加月的口径 = 「上月末持仓 × (1 + 各资产 MTD)」，且该月不触发再平衡；
// 因此引擎终值必须等于 progress.json 的 est_total（差几厘以内），否则说明再平衡或月份映射跑偏了。
if (typeof PROG !== 'undefined' && fs.existsSync(PROG)) {
  let prog = null;
  try { prog = JSON.parse(fs.readFileSync(PROG, 'utf8')); } catch (e) { prog = null; }
  // 降级快照（本月行情取数不完整）的分支：必须不含任何估算数值。
  // null = 「本次没有数据」；0 = 伪造出来的「当月持平」—— 后者会被前端 live overlay
  // 当成真实估算发到全站（Hero / 三档卡 / 指标卡），直接违反铁律「不凭空造月收益」。
  if (prog && prog.in_progress && prog.degraded) {
    const numFields = ['est_total', 'est_change_amount', 'est_change_pct_base', 'est_change_pct_prev', 'cum_return_pct_base'];
    const badTop = numFields.filter((k) => prog[k] != null);
    const badAssets = prog.assets
      .filter((a) => a.mtd != null || a.mtd_raw != null || a.est_value != null)
      .map((a) => a.name);
    check('降级快照的上层估算字段必须为 null（不得用 0 伪装「当月持平」）', badTop.length === 0,
      badTop.length ? badTop.map((k) => `${k}=${prog[k]}`).join(', ') : '全部为 null ✓');
    check('降级快照的各资产 MTD / est_value 必须为 null', badAssets.length === 0,
      badAssets.length ? badAssets.join(', ') : '全部为 null ✓');
    check('降级快照身份仍自洽（基准月=主数据末月、进行中月未定稿）',
      prog.base_month === lastMonthInData && !rr.months.includes(prog.in_progress_month),
      `base_month=${prog.base_month} 末月=${lastMonthInData} month=${prog.in_progress_month}`);
    check('降级快照可追溯原因（fetch.fail > 0 或 offline 自检）',
      Number(prog.fetch && prog.fetch.fail) > 0 || (prog.fetch && prog.fetch.offline === true),
      `fetch=${JSON.stringify(prog.fetch)}`);
    check('降级快照各资产 ok 必须为 false（不得声称取到了 MTD）',
      prog.assets.every((a) => a.ok === false),
      JSON.stringify(prog.assets.map((a) => a.ok)));
  }

  if (prog && prog.in_progress && !prog.degraded) {
    const returns = {};
    let rawOk = true;
    for (const a of prog.assets) {
      const v = (a.mtd_raw != null) ? Number(a.mtd_raw) : Number(a.mtd) / 100;
      if (!isFinite(v)) rawOk = false;
      returns[a.name] = v;
    }
    check('progress.json 含 mtd_raw（高精度 MTD，避免 ±3 元漂移）',
      prog.assets.every(a => a.mtd_raw != null), '缺 mtd_raw 时叠加结果会有几元误差');

    const applied = B.setLiveOverlay({ month: prog.in_progress_month, asOf: prog.data_as_of, returns });
    check('live overlay 被接受（月份晚于数据末月且未定稿）', !!applied,
      `month=${prog.in_progress_month} 数据末月=${lastMonthInData}`);

    const live = B.simulateCMV(B.PLANS.balanced);
    check('含当月叠加：稳健型终值 = progress.est_total',
      Math.abs(live.finalValue - prog.est_total) < 0.05,
      `engine=${live.finalValue.toFixed(2)} progress=${prog.est_total}（差 ${(live.finalValue - prog.est_total).toFixed(4)}）`);
    check('含当月叠加：月数 +1（固化为入场月+收益月）',
      live.totalMonths === earliest.totalMonths + 1,
      `live=${live.totalMonths} frozen=${earliest.totalMonths}`);
    check('含当月叠加：累计%=progress.cum_return_pct_base',
      Math.abs(live.total - prog.cum_return_pct_base) < 0.01,
      `engine=${live.total.toFixed(2)} progress=${prog.cum_return_pct_base}`);

    // 叠加层不得污染固化口径（同一进程内 frozen 结果必须与叠加前逐位一致）
    const frozen = B.simulateCMV(B.PLANS.balanced, { liveOverlay: false });
    check('叠加层不污染固化口径', Math.abs(frozen.finalValue - earliest.finalValue) < 0.01,
      `frozen=${frozen.finalValue.toFixed(2)} rolling=${earliest.finalValue.toFixed(2)}`);

    // 安全闸门：已定稿月 / 非法月份格式必须被拒
    const reject = [
      B.setLiveOverlay({ month: lastMonthInData, returns: {} }),      // 已定稿月
      B.setLiveOverlay({ month: '2026-13', returns: {} }),            // 非法月份
      B.setLiveOverlay({ month: '', returns: {} }),                   // 空月份
      B.setLiveOverlay({ month: '2026-10', returns: null })           // 缺收益表
    ];
    check('非法叠加（已定稿月/非法月份/缺收益）被拒绝', reject.every(x => x === null),
      reject.map(x => x === null ? 'null' : 'accepted').join(','));
    // ---- 滚动引擎同源校验（弹窗顶部汇总 / 滚动汇总表 / 折线图 都吃这一套）----
    // 前面的「非法叠加」测试会把两个引擎的叠加状态清空，这里重新装回再比。
    B.setLiveOverlay({ month: prog.in_progress_month, asOf: prog.data_as_of, returns: Object.assign({}, returns) });
    const rApplied = RB.setLiveOverlay({ month: prog.in_progress_month, asOf: prog.data_as_of, mtd: Object.assign({}, returns) });
    check('滚动引擎 live overlay 被接受（与 engine 同源判定）', !!rApplied,
      `month=${prog.in_progress_month} 数据末月=${lastMonthInData}`);
    if (rApplied) {
      const rLiveResults = RB.runAll();
      const rEarliest = rLiveResults.find(x => x.startPoint.isEarliest);
      const rComparison = rLiveResults.find(x => x.startPoint.isComparison);

      check('滚动叠加：一次建仓版终值 = progress.est_total',
        Math.abs(rEarliest.live.finalValue - prog.est_total) < 0.05,
        `rolling=${rEarliest.live.finalValue.toFixed(2)} progress=${prog.est_total}（差 ${(rEarliest.live.finalValue - prog.est_total).toFixed(4)}）`);

      check('滚动叠加：monthlySnapshots 未被污染（日志表格 / CSV 仍为固化口径）',
        rEarliest.monthlySnapshots.length === rEarliest.frozenMonths &&
        Math.abs(rEarliest.monthlySnapshots[rEarliest.monthlySnapshots.length - 1].totalValue - earliest.finalValue) < 0.01,
        `snaps=${rEarliest.monthlySnapshots.length} frozen=${rEarliest.frozenMonths}`);

      check('滚动叠加：进行中月不产生任何操作（恒市值法只在月末调仓）',
        rEarliest.live.snapshot.opCount === 0 && rEarliest.live.snapshot.assetDetails.every(a => a.action === '无操作'),
        `opCount=${rEarliest.live.snapshot.opCount}`);

      check('滚动叠加：累计月序 = 冻结月数 + 1（入场月=第1个月）',
        rEarliest.live.snapshot.monthIndex === rEarliest.frozenMonths + 1,
        `monthIndex=${rEarliest.live.snapshot.monthIndex} frozen=${rEarliest.frozenMonths}`);

      // ---- 滚动板块「本月至今明细块」/ 汇总表末行的数据源守卫 ----
      // 明细块与汇总表末行都直接吃 rEarliest.live.snapshot.assetDetails，
      // 所以这里必须锁死「各资产之和 = 组合合计 = progress.est_total」这条链，
      // 否则页面外部展示的数字与弹窗 / 首屏会再次分叉。
      const lpDetails = rEarliest.live.snapshot.assetDetails;
      const lpBase = lpDetails.reduce((s, d) => s + d.holdingBefore, 0);
      const lpAfter = lpDetails.reduce((s, d) => s + d.holdingAfter, 0);
      const SMOKE_CAP = RB.CONFIG.totalCapital;
      check('本月至今明细块：各资产最新市值之和 = 组合合计 = progress.est_total',
        Math.abs(lpAfter - rEarliest.live.snapshot.totalValue) < 1e-6 &&
        Math.abs(lpAfter - prog.est_total) < 0.05,
        `sum=${lpAfter.toFixed(2)} snap=${rEarliest.live.snapshot.totalValue.toFixed(2)} progress=${prog.est_total}`);
      check('本月至今明细块：各资产月初市值之和 = progress.base_total（锚定已定稿月）',
        Math.abs(lpBase - prog.base_total) < 0.05,
        `sum=${lpBase.toFixed(2)} progress=${prog.base_total}`);
      check('本月至今明细块：合计比例 = progress.est_change_pct_base（÷固定基准 50 万）',
        Math.abs((rEarliest.live.snapshot.totalValue - lpBase) / SMOKE_CAP * 100 - prog.est_change_pct_base) < 0.005,
        `计算=${((rEarliest.live.snapshot.totalValue - lpBase) / SMOKE_CAP * 100).toFixed(4)} progress=${prog.est_change_pct_base}`);
      check('本月至今明细块：资产条数 = 6',
        lpDetails.length === 6, `n=${lpDetails.length}`);
      const colorBlock = (read('js/main.js').match(/const LIVE_ASSET_COLORS = \{[\s\S]*?\};/) || [''])[0];
      const missingColor = lpDetails.map(d => d.asset).filter(a => !colorBlock.includes(`'${a}'`));
      check('本月至今明细块：每种资产都有配色（LIVE_ASSET_COLORS 无遗漏）',
        missingColor.length === 0, '缺: ' + missingColor.join(','));

      const crossLive = (tag, eng, rl) => {
        const rows = [
          ['终值', eng.finalValue, rl.finalValue],
          ['累计%', eng.total, rl.totalReturn],
          ['年化%', eng.annual, rl.annualReturn],
          ['最大回撤%', eng.maxDd, rl.maxDrawdown],
          ['Sharpe', eng.sharpe, rl.sharpe],
          ['月胜率%', eng.monthlyWinRate * 100, rl.winRate],
          ['月数', eng.totalMonths, rl.totalMonths]
        ];
        const bad = rows.filter(([, a, b]) => Math.abs(a - b) > 1e-6)
          .map(([k, a, b]) => `${k}: engine=${a} rolling=${b}`);
        check(`两引擎叠加口径一致 · ${tag}`, bad.length === 0, bad.join(' | '));
      };
      crossLive('一次建仓版', B.simulateCMV(B.PLANS.balanced), rEarliest.live);
      crossLive('分批建仓版(同起点)', B.simulateCMV(B.PLANS.balanced, { buildMonths: 12 }), rComparison.live);

      // 空值闸门：null / undefined 绝不能被当作 0（「没有数据」≠「当月持平」）
      const badReturns = Object.assign({}, returns, { '黄金': null });
      check('空值不得冒充 0（engine 拒绝含 null 的收益表）',
        B.setLiveOverlay({ month: prog.in_progress_month, returns: badReturns }) === null);
      check('空值不得冒充 0（rolling 拒绝含 null 的 MTD 表）',
        RB.setLiveOverlay({ month: prog.in_progress_month, mtd: badReturns }) === null);
      check('空表被拒（不得默认全 0）',
        B.setLiveOverlay({ month: prog.in_progress_month, returns: {} }) === null &&
        RB.setLiveOverlay({ month: prog.in_progress_month, mtd: {} }) === null);

      RB.clearLiveOverlay();
      check('滚动 clearLiveOverlay 后回到固化口径（live=null、快照仍固化）',
        RB.runSingleBacktest(RB.getStartPoints()[0]).live === null &&
        Math.abs(RB.runSingleBacktest(RB.getStartPoints()[0]).finalValue - earliest.finalValue) < 0.01);
    }

    B.clearLiveOverlay();
    check('clearLiveOverlay 后回到固化口径',
      Math.abs(B.simulateCMV(B.PLANS.balanced).finalValue - earliest.finalValue) < 0.01);
  }
}

// ---- 11) 展示层骨架与措辞守卫 ----
//  用户 2026-09-29 拍板两条约定，都属于「容易悄悄回潮」的文案/结构：
//   (1) 最新月份数据必须在页面外部可见（滚动汇总表末行 + 本月至今明细块），不必点开弹窗；
//   (2) 措辞统一为「本月至今（MTD）」——它是真实已发生的行情，不是预测/估算。
{
  const html = read('index.html');
  const mainSrc = read('js/main.js');

  ['live-progress-card', 'live-progress-title', 'live-progress-body', 'live-progress-foot', 'live-progress-note']
    .forEach((id) => check(`本月至今明细块骨架存在 · #${id}`, html.includes(`id="${id}"`)));

  check('本月至今明细块由 body.has-live-estimate 控制显隐',
    /\.live-progress-card \{ display: none; \}/.test(html) &&
    /body\.has-live-estimate \.live-progress-card \{ display: block; \}/.test(html));
  check('汇总表末行样式存在（.rolling-summary-table tr.live-month-row）',
    /\.rolling-summary-table tr\.live-month-row td \{/.test(html));
  check('明细块渲染已接入统一入口 renderRollingAll',
    /renderLiveProgressBlock\(rollingResults\)/.test(mainSrc));

  const stale = ['含当月估', '含当月估算', 'MTD 估算', '当月估算'];
  const hits = [];
  ['index.html', 'js/main.js', 'js/rolling.js', 'js/engine.js', 'js/progress.json', 'scripts/monthly_progress.js']
    .forEach((f) => {
      const src = read(f);
      stale.forEach((w) => { if (src.includes(w)) hits.push(`${f}: ${w}`); });
    });
  check('旧措辞未回潮（含当月估 / 含当月估算 / MTD 估算 / 当月估算）',
    hits.length === 0, hits.join(' | '));

  // 「含估计值」是另一件事：rolling 的 hasEstimatedData = 历史数据缺失时的插值兜底，
  // 与「本月至今」无关，不得被顺带改名或删除。
  check('数据质量列的「含估计值」语义未被误改（hasEstimatedData 仍独立存在）',
    mainSrc.includes('含估计值') && read('js/rolling.js').includes('hasEstimatedData'));
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
