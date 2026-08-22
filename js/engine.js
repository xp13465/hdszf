/**
 * 回测计算引擎
 * 6维资产权重直接匹配 + 降级估算
 *
 * 月频回测：simulateCMV（直接读 APP_DATA.realReturns 月收益）
 * 日频回测：simulateCMV_daily（读 scripts/_daily_cache.json 日K线，支持周/月/日级别再平衡）
 */

const BacktestEngine = (() => {
  // 默认配置（稳健型 ★推荐方案）
  const DEFAULT_CONFIG = {
    '沪深300': 15,
    '中证500': 5,
    '标普500': 15,
    '纳斯达克100': 20,
    '黄金': 20,
    '现金·货币基金': 25
  };

  const ASSETS = ['沪深300', '中证500', '标普500', '纳斯达克100', '黄金', '现金·货币基金'];
  const CASH_ASSET = '现金·货币基金';

  // 三档方案配置（唯一事实来源：对比卡片/雷达图/柱状图/README 均由此驱动）
  const PLANS = {
    conservative: { '沪深300': 0.10, '中证500': 0.03, '标普500': 0.07, '纳斯达克100': 0.10, '黄金': 0.20, '现金·货币基金': 0.50 },
    balanced:     { '沪深300': 0.15, '中证500': 0.05, '标普500': 0.15, '纳斯达克100': 0.20, '黄金': 0.20, '现金·货币基金': 0.25 },
    aggressive:   { '沪深300': 0.00, '中证500': 0.00, '标普500': 0.10, '纳斯达克100': 0.82, '黄金': 0.08, '现金·货币基金': 0.00 }
  };

  // 距离阈值：6维欧氏距离超过此值不再信任 trendData 匹配
  const MATCH_THRESHOLD = 0.15;

  /**
   * 6维欧氏距离匹配：返回最近的两个邻居，用于线性插值
   */
  function findNearest6D(sliders) {
    const trendData = APP_DATA.trendData;
    let bestDist = Infinity, bestItem = null;
    let secondDist = Infinity, secondItem = null;

    const target = {};
    for (const a of ASSETS) {
      target[a] = (sliders[a] || 0) / 100;
    }

    for (const item of trendData) {
      const alloc = item.alloc || {};
      let dist2 = 0;
      for (const a of ASSETS) {
        const d = target[a] - (alloc[a] || 0);
        dist2 += d * d;
      }
      if (dist2 < bestDist) {
        secondDist = bestDist;
        secondItem = bestItem;
        bestDist = dist2;
        bestItem = item;
      } else if (dist2 < secondDist) {
        secondDist = dist2;
        secondItem = item;
      }
    }

    return {
      best: { item: bestItem, distance: Math.sqrt(bestDist) },
      second: { item: secondItem, distance: Math.sqrt(secondDist) }
    };
  }

  /**
   * 线性插值：在最近邻和次近邻之间按距离权重插值
   */
  function interpolateMetrics(best, second) {
    const d1 = best.distance;
    const d2 = second.distance;
    if (d1 < 0.001 || !second.item) {
      return {
        annual: best.item.annual || 0,
        dd: best.item.dd || 0,
        sharpe: best.item.sharpe || 0,
        sortino: best.item.sortino || 0,
        total: best.item.total || 0,
        final: best.item.final || 500000,
        w_positive_ratio: best.item.w_positive_ratio || 0
      };
    }
    // 用距离平方做权重，让近邻影响更大，变化更敏感
    const d1sq = d1 * d1;
    const d2sq = d2 * d2;
    const total = d1sq + d2sq;
    const w1 = d2sq / total;
    const w2 = d1sq / total;
    return {
      annual: (best.item.annual || 0) * w1 + (second.item.annual || 0) * w2,
      dd: (best.item.dd || 0) * w1 + (second.item.dd || 0) * w2,
      sharpe: (best.item.sharpe || 0) * w1 + (second.item.sharpe || 0) * w2,
      sortino: (best.item.sortino || 0) * w1 + (second.item.sortino || 0) * w2,
      total: (best.item.total || 0) * w1 + (second.item.total || 0) * w2,
      final: (best.item.final || 500000) * w1 + (second.item.final || 500000) * w2,
      w_positive_ratio: (best.item.w_positive_ratio || 0) * w1 + (second.item.w_positive_ratio || 0) * w2
    };
  }

  /**
   * 匹配精度等级
   */
  function getMatchLevel(distance) {
    if (distance < 0.02) return { level: 'exact', label: '精确匹配' };
    if (distance < 0.08) return { level: 'approx', label: '近似匹配' };
    if (distance < MATCH_THRESHOLD) return { level: 'coarse', label: '粗略匹配' };
    return { level: 'fallback', label: '估算值（超出回测覆盖范围）' };
  }

  /**
   * 降级估算：用各资产独立月度收益率 + 配置权重做加权计算
   * 这是最精确的计算方式，6资产完全独立，不丢任何信息
   */
  function estimateFromScratch(sliders) {
    return estimateFromScratchWithIdleCash(sliders, 0);
  }

  /**
   * 带活期的加权计算
   * idlePct = 缺额百分比，视为活期（0收益）
   * 已配置的现金·货币基金按正常 cash_monthly 计算
   */
  function estimateFromScratchWithIdleCash(sliders, idlePct) {
    const rr = APP_DATA.realReturns;
    if (!rr || !rr.asset_returns) {
      return { annual: 0, maxDd: 0, sharpe: 0, sortino: 0, total: 0, finalValue: 500000, monthlyWinRate: 0 };
    }

    const cashMonthly = rr.cash_monthly || 0.00083;
    const n = rr.asset_returns['沪深300'].length;
    const monthlyReturns = [];

    for (let i = 0; i < n; i++) {
      let r = 0;
      for (const [asset, pct] of Object.entries(sliders)) {
        if (pct === 0) continue;
        if (asset === '现金·货币基金') {
          r += (pct / 100) * cashMonthly;
        } else if (rr.asset_returns[asset]) {
          r += (pct / 100) * rr.asset_returns[asset][i];
        }
      }
      // 活期部分不产生收益也不亏损，r 不加任何值
      monthlyReturns.push(r);
    }

    // 累计收益 → 年化（基于总投入50万，活期部分不参与增长）
    let cumulative = 1;
    let peak = 1;
    let maxDd = 0;
    for (const r of monthlyReturns) {
      cumulative *= (1 + r);
      if (cumulative > peak) peak = cumulative;
      const dd = (cumulative / peak - 1) * 100;
      if (dd < maxDd) maxDd = dd;
    }

    const totalReturn = (cumulative - 1) * 100;
    const annual = (Math.pow(cumulative, 12 / n) - 1) * 100;
    const posMonths = monthlyReturns.filter(r => r > 0).length;

    // Sharpe
    const meanR = monthlyReturns.reduce((a, b) => a + b, 0) / n;
    const variance = monthlyReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / (n - 1);
    const annVol = Math.sqrt(variance) * Math.sqrt(12);
    const sharpe = annVol > 0 ? (annual / 100 - 0.02) / annVol : 0;
    // Sortino: 只对负收益率计算下行标准差
    const negReturns = monthlyReturns.filter(r => r < 0);
    const downVariance = negReturns.length > 1
      ? negReturns.reduce((s, r) => s + r ** 2, 0) / (negReturns.length - 1)
      : (negReturns.length === 1 ? negReturns[0] ** 2 : 0);
    const annDownVol = Math.sqrt(Math.max(0, downVariance)) * Math.sqrt(12);
    const sortino = annDownVol > 0 ? (annual / 100 - 0.02) / annDownVol : 0;

    return {
      annual, maxDd, sharpe: Math.max(0, Math.min(sharpe, 10)),
      sortino: Math.max(0, Math.min(sortino, 10)),
      total: totalReturn, finalValue: 500000 * (1 + totalReturn / 100),
      monthlyWinRate: posMonths / n
    };
  }

  /**
   * 真实恒市值法回测（含建仓期 + 月度再平衡 ±阈值 + 交易费率）
   * 直接读取 APP_DATA.realReturns 全量真实数据，无前视偏差。
   * 这是回测引擎的主路径，替代 trendData 插值；trendData 仅作
   * realReturns 缺失时的兜底（覆盖回测范围外的极端配置估算）。
   *
   * @param {Object} alloc - 资产配置（小数比例，如 {'沪深300':0.15}），缺额自动补现金
   * @param {Object} opts  - {buildMonths, threshold, feeRate, totalCapital, rebalanceEveryMonths}
   * @returns {Object|null} 指标对象；realReturns 缺失时返回 null
   */
  function simulateCMV(alloc, opts) {
    opts = opts || {};
    const rr = APP_DATA.realReturns;
    if (!rr || !rr.asset_returns || !rr.asset_returns['沪深300']) return null;

    const totalCapital = opts.totalCapital || 500000;
    const buildMonths  = opts.buildMonths != null ? opts.buildMonths : 1;
    const threshold    = opts.threshold != null ? opts.threshold : 0.05;
    const feeRate      = opts.feeRate != null ? opts.feeRate : 0.001;
    const rebalanceEvery = opts.rebalanceEveryMonths != null ? opts.rebalanceEveryMonths : 1;  // N 月再平衡一次，1=每月
    const cashMonthly  = rr.cash_monthly || 0.00083;

    // 归一化为小数，缺额补现金
    const a = {};
    let sum = 0;
    for (const asset of ASSETS) { a[asset] = alloc[asset] || 0; sum += a[asset]; }
    if (sum < 0.999) a[CASH_ASSET] += (1 - sum);

    const months = rr.months;
    // 回测窗口 = 有真实收益数据的月份数（排除 months 末位“下月占位”标签，与 rolling 口径一致）
    const n = rr.asset_returns['沪深300'].length;

    // 状态初始化（恒定市值法：目标市值永远不变）
    const holdings = {};
    const targetValues = {};
    for (const asset of ASSETS) {
      holdings[asset] = 0;
      targetValues[asset] = totalCapital * a[asset];
    }
    let cashBalance = totalCapital;
    let totalValue = totalCapital;
    let peakValue = totalCapital;
    let maxDrawdown = 0;
    let prevTotalValue = totalCapital;
    const monthlyReturns = [];

    for (let t = 0; t < n; t++) {
      const idx = t;            // 从最早真实数据月开始，覆盖全期
      const isBuild = t < buildMonths;

      // 月初：把现金余额并入现金持仓，统一处理
      holdings[CASH_ASSET] += cashBalance;
      cashBalance = 0;

      // 本月资产收益（按各资产当月真实收益率变动）
      for (const asset of ASSETS) {
        let ret;
        if (asset === CASH_ASSET) {
          ret = cashMonthly;
        } else {
          const arr = rr.asset_returns[asset];
          ret = (arr && idx < arr.length) ? arr[idx] : 0;
        }
        holdings[asset] *= (1 + ret);
      }

      // 建仓期：将各资产推向「目标市值 × 进度」
      const buildFraction = Math.min(1, (t + 1) / buildMonths);
      if (isBuild) {
        for (const asset of ASSETS) {
          if (asset === CASH_ASSET) continue;
          const currentTarget = targetValues[asset] * buildFraction;
          const diff = currentTarget - holdings[asset];
          if (Math.abs(diff) <= 1) continue;
          const fee = Math.abs(diff) * feeRate;
          if (diff > 0) {
            const needed = diff + fee;
            const available = Math.min(holdings[CASH_ASSET], needed);
            if (available > 1) { holdings[CASH_ASSET] -= available; holdings[asset] += (available - fee); }
          } else {
            holdings[CASH_ASSET] += (Math.abs(diff) - fee);
            holdings[asset] = currentTarget;
          }
        }
      }

      // 再平衡期：偏离目标市值超过 ±阈值触发（按 rebalanceEveryMonths 间隔检查）
      if (!isBuild && rebalanceEvery > 0 && (t % rebalanceEvery === 0)) {
        for (const asset of ASSETS) {
          if (asset === CASH_ASSET) continue;
          const tv = targetValues[asset];
          const ch = holdings[asset];
          if (tv <= 0) continue;
          const dev = (ch - tv) / tv;
          if (Math.abs(dev) > threshold) {
            const diff = tv - ch;
            const fee = Math.abs(diff) * feeRate;
            if (diff > 0) {
              const needed = diff + fee;
              const available = Math.min(holdings[CASH_ASSET], needed);
              if (available > 1) { holdings[CASH_ASSET] -= available; holdings[asset] += (available - fee); }
            } else {
              holdings[CASH_ASSET] += (Math.abs(diff) - fee);
              holdings[asset] = tv;
            }
          }
        }
      }

      totalValue = ASSETS.reduce((s, asset) => s + holdings[asset], 0);
      if (totalValue > peakValue) peakValue = totalValue;
      const dd = (totalValue / peakValue - 1) * 100;
      if (dd < maxDrawdown) maxDrawdown = dd;
      const mr = prevTotalValue > 0 ? (totalValue / prevTotalValue - 1) : 0;
      prevTotalValue = totalValue;
      monthlyReturns.push(mr);
    }

    // 指标计算
    const finalValue = totalValue;
    const totalReturn = (finalValue / totalCapital - 1) * 100;
    const nYears = n / 12;
    const annual = (Math.pow(finalValue / totalCapital, 1 / nYears) - 1) * 100;
    const meanR = monthlyReturns.length ? monthlyReturns.reduce((x, y) => x + y, 0) / monthlyReturns.length : 0;
    const variance = monthlyReturns.length > 1
      ? monthlyReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / (monthlyReturns.length - 1) : 0;
    const annVol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
    const sharpe = annVol > 0 ? (annual / 100 - 0.02) / annVol : 0;
    const neg = monthlyReturns.filter(r => r < 0);
    const downVar = neg.length > 1
      ? neg.reduce((s, r) => s + r ** 2, 0) / (neg.length - 1)
      : (neg.length === 1 ? neg[0] ** 2 : 0);
    const annDown = Math.sqrt(Math.max(0, downVar)) * Math.sqrt(12);
    const sortino = annDown > 0 ? (annual / 100 - 0.02) / annDown : 0;
    const posMonths = monthlyReturns.filter(r => r > 0).length;
    const winRate = monthlyReturns.length ? posMonths / monthlyReturns.length : 0;

    // 年度统计：按月份标签年份聚合，仅计满 12 个月的完整年
    const byYear = {};
    for (let i = 0; i < monthlyReturns.length; i++) {
      const m = months[i];
      const y = m ? String(m).slice(0, 4) : '?';
      (byYear[y] = byYear[y] || []).push(monthlyReturns[i]);
    }
    const fullYears = Object.keys(byYear)
      .filter(y => byYear[y].length === 12)
      .map(y => ({ year: y, ret: byYear[y].reduce((a, r) => a * (1 + r), 1) - 1 }));
    const negativeYears = fullYears.filter(x => x.ret < 0).length;
    const worstYear = fullYears.length
      ? fullYears.reduce((m, x) => (x.ret < m ? x.ret : m), 0) : 0;

    return {
      annual,
      maxDd: maxDrawdown,
      sharpe: Math.max(0, Math.min(sharpe, 10)),
      sortino: Math.max(0, Math.min(sortino, 10)),
      total: totalReturn,
      finalValue,
      monthlyWinRate: winRate,
      annVol,
      monthlyReturns,
      positiveMonths: posMonths,
      totalMonths: monthlyReturns.length,
      yearly: { fullYears: fullYears.length, negativeYears, worstYear }
    };
  }

  /**
   * 主计算函数
   */
  function compute(sliders) {
    // 缺额补到现金·货币基金，确保恒市值法满仓匹配
    const sum = Object.values(sliders).reduce((a, b) => a + b, 0);
    const normalized = { ...sliders };
    if (sum < 100) {
      normalized['现金·货币基金'] = (normalized['现金·货币基金'] || 0) + (100 - sum);
    }

    // 主路径：基于全量真实数据的恒市值法回测（反映最新月份，无前视偏差）
    const alloc = {};
    for (const asset of ASSETS) alloc[asset] = (normalized[asset] || 0) / 100;
    const realResult = simulateCMV(alloc);
    if (realResult) {
      return {
        sliders: { ...sliders },
        match: getMatchLevel(0), // 基于真实数据精确计算
        alloc: Object.fromEntries(
          Object.entries(sliders).map(([k, v]) => [k, v / 100])
        ),
        metrics: realResult
      };
    }

    // 兜底：真实收益数据缺失时，回退到 trendData 插值（覆盖回测范围外估算）
    const { best, second } = findNearest6D(normalized);
    const match = getMatchLevel(best.distance);

    // 距离太大或没有匹配 → 走精确加权估算
    if (!best.item || best.distance > MATCH_THRESHOLD) {
      const estimated = estimateFromScratch(sliders);
      return {
        sliders: { ...sliders },
        match,
        alloc: Object.fromEntries(
          Object.entries(sliders).map(([k, v]) => [k, v / 100])
        ),
        metrics: estimated
      };
    }

    // 线性插值：最近邻和次近邻之间平滑过渡
    const interp = interpolateMetrics(best, second);
    const alloc2 = best.item.alloc || {};
    return {
      sliders: { ...sliders },
      match,
      alloc: {
        '沪深300': alloc2['沪深300'] || 0,
        '中证500': alloc2['中证500'] || 0,
        '标普500': alloc2['标普500'] || 0,
        '纳斯达克100': alloc2['纳斯达克100'] || 0,
        '黄金': alloc2['黄金'] || 0,
        '现金·货币基金': alloc2['现金·货币基金'] || 0
      },
      metrics: {
        annual: interp.annual,
        maxDd: interp.dd,
        sharpe: interp.sharpe,
        sortino: interp.sortino,
        total: interp.total,
        finalValue: interp.final,
        monthlyWinRate: interp.w_positive_ratio
      }
    };
  }

  /**
   * 生成累计收益和回撤曲线
   * 统一走 simulateCMV（恒市值法），保证曲线终点/回撤与指标卡数值一致。
   */
  function generateMonthlyReturns(alloc) {
    const rr = APP_DATA.realReturns;
    const sim = simulateCMV(alloc);
    if (!rr || !sim) {
      return { equityCurve: [0], drawdownCurve: [0], months: 0, monthLabels: [] };
    }

    const monthlyReturns = sim.monthlyReturns;
    let cumulative = 1;
    const equityCurve = [0];
    for (const r of monthlyReturns) {
      cumulative *= (1 + r);
      equityCurve.push((cumulative - 1) * 100);
    }

    let peak = 1;
    const drawdownCurve = [0];
    for (let i = 0; i < monthlyReturns.length; i++) {
      let c = 1;
      for (let j = 0; j <= i; j++) c *= (1 + monthlyReturns[j]);
      if (c > peak) peak = c;
      drawdownCurve.push((c / peak - 1) * 100);
    }

    return { equityCurve, drawdownCurve, months: monthlyReturns.length, monthLabels: rr.months.slice(0, monthlyReturns.length) };
  }

  /**
   * 加载日K线缓存（scripts/_daily_cache.json），供日频回测用
   * Node 环境（脚本）：用 fs.readFileSync；浏览器环境：无 fs 时返回 null。
   */
  function loadDailyCache() {
    if (typeof require !== 'undefined' && typeof fs !== 'undefined') {
      try {
        const p = require('path').resolve(__dirname || '.', 'scripts/_daily_cache.json');
        if (typeof require !== 'undefined') {
          return JSON.parse(require('fs').readFileSync(p, 'utf8'));
        }
      } catch (e) { return null; }
    }
    return null;
  }

  /**
   * 日频恒市值法回测（基于日K线）
   *
   * @param {Object} alloc 资产配置小数比例
   * @param {Object} opts
   *   - schedule: 'weekly-mon' | 'biweekly-mon' | 'monthly-eom' | 'monthly-day-N'（N=1..31，遇非交易日顺延下一交易日）
   *   - threshold: ±阈值（默认 0.05）
   *   - feeRate, buildMonths, totalCapital
   *   - dailyCache: 可直接传入 _daily_cache.json 内容（避免 require）
   * @returns {Object|null} {monthlyReturns, monthlyWinRate, ...}，同 simulateCMV 字段
   */
  function simulateCMV_daily(alloc, opts) {
    opts = opts || {};
    const cache = opts.dailyCache || loadDailyCache();
    if (!cache) return null;

    const totalCapital = opts.totalCapital || 500000;
    const buildMonths  = opts.buildMonths != null ? opts.buildMonths : 1;
    const threshold    = opts.threshold != null ? opts.threshold : 0.05;
    const feeRate      = opts.feeRate != null ? opts.feeRate : 0.001;
    const schedule     = opts.schedule || 'monthly-eom';

    // 归一化为小数
    const a = {};
    let sum = 0;
    for (const asset of ASSETS) { a[asset] = alloc[asset] || 0; sum += a[asset]; }
    if (sum < 0.999) a[CASH_ASSET] += (1 - sum);

    // 5 资产对齐：取公共日期集合（按 ISO 日期字符串交集 + 升序）
    const dateSets = {};
    for (const asset of ASSETS) {
      const arr = cache[asset] || [];
      dateSets[asset] = new Set(arr.map(r => r.day));
    }
    const referenceDates = (cache['沪深300'] || []).map(r => r.day).sort();
    const commonDates = referenceDates.filter(d =>
      ASSETS.every(asset => asset === CASH_ASSET || dateSets[asset].has(d))
    );
    if (commonDates.length < 60) return null;

    // 按 startDate / endDate 裁剪（默认 '2015-08-01' 起；endDate 用于对齐月频数据终点）
    const startDate = opts.startDate || '2015-08-01';
    const endDate = opts.endDate || '2099-12-31';
    const startIdx = commonDates.findIndex(d => d >= startDate);
    let alignedDates = startIdx >= 0 ? commonDates.slice(startIdx) : commonDates.slice();
    alignedDates = alignedDates.filter(d => d <= endDate);
    if (alignedDates.length < 60) return null;

    // 建立日索引到 close 的映射
    const closeMap = {};
    for (const asset of ASSETS) {
      closeMap[asset] = {};
      for (const r of (cache[asset] || [])) closeMap[asset][r.day] = +r.close;
    }

    // 现金用月收益近似（与月频引擎口径一致）：每日按月收益/30 复利
    const cashDaily = Math.pow(1 + (APP_DATA.realReturns && APP_DATA.realReturns.cash_monthly ? APP_DATA.realReturns.cash_monthly : 0.00083), 1/30) - 1;

    // 持仓状态
    const holdings = {};
    const targetValues = {};
    for (const asset of ASSETS) {
      holdings[asset] = 0;
      targetValues[asset] = totalCapital * a[asset];
    }
    let cashBalance = totalCapital;

    // 预计算再平衡检查日
    const rebalanceSet = buildRebalanceSet(alignedDates, schedule);

    // 按日循环
    const monthlyReturns = [];
    let curMonth = null;
    let prevMonthTotal = totalCapital;  // 上月末净值（首月用 totalCapital）
    let totalValue = totalCapital;
    let peakValue = totalCapital;
    let maxDrawdown = 0;
    let buildMonthCount = 0;

    for (let dayIdx = 0; dayIdx < alignedDates.length; dayIdx++) {
      const date = alignedDates[dayIdx];
      const m = date.slice(0, 7); // YYYY-MM

      // 新月份首日：收尾上月 + 现金并入
      if (m !== curMonth) {
        if (curMonth !== null) {
          // 收尾上一月
          const r = prevMonthTotal > 0 ? (totalValue / prevMonthTotal - 1) : 0;
          monthlyReturns.push(r);
          if (totalValue > peakValue) peakValue = totalValue;
          const dd = (totalValue / peakValue - 1) * 100;
          if (dd < maxDrawdown) maxDrawdown = dd;
        }
        curMonth = m;
        prevMonthTotal = totalValue;
        // 月初：现金余额并入现金持仓
        holdings[CASH_ASSET] = (holdings[CASH_ASSET] || 0) + cashBalance;
        cashBalance = 0;
      }

      // 每日按 close 累乘更新持仓
      for (const asset of ASSETS) {
        let ret;
        if (asset === CASH_ASSET) {
          ret = cashDaily;
        } else {
          const prev = closeMap[asset][alignedDates[Math.max(0, dayIdx - 1)]] || closeMap[asset][date];
          const cur = closeMap[asset][date];
          ret = prev > 0 ? (cur / prev - 1) : 0;
        }
        holdings[asset] = (holdings[asset] || 0) * (1 + ret);
      }

      // 建仓期判断：本月是否在 buildMonths 内（从最早 commonDate 月份开始计）
      const isBuildMonth = (buildMonthCount < buildMonths);
      // 月内首日（每月只在 dayIdx==0 或跨月时执行建仓一次）
      const isMonthFirstDay = (m !== (alignedDates[dayIdx - 1] || '').slice(0, 7));

      if (isBuildMonth && isMonthFirstDay) {
        const buildFraction = Math.min(1, (buildMonthCount + 1) / buildMonths);
        for (const asset of ASSETS) {
          if (asset === CASH_ASSET) continue;
          const currentTarget = targetValues[asset] * buildFraction;
          const diff = currentTarget - holdings[asset];
          if (Math.abs(diff) <= 1) continue;
          const fee = Math.abs(diff) * feeRate;
          if (diff > 0) {
            const need = diff + fee;
            const avail = Math.min(holdings[CASH_ASSET], need);
            if (avail > 1) { holdings[CASH_ASSET] -= avail; holdings[asset] += (avail - fee); }
          } else {
            holdings[CASH_ASSET] += (Math.abs(diff) - fee);
            holdings[asset] = currentTarget;
          }
        }
        buildMonthCount += 1;
      }

      // 再平衡检查
      if (!isBuildMonth && rebalanceSet.has(date)) {
        for (const asset of ASSETS) {
          if (asset === CASH_ASSET) continue;
          const tv = targetValues[asset];
          const ch = holdings[asset];
          if (tv <= 0) continue;
          const dev = (ch - tv) / tv;
          if (Math.abs(dev) > threshold) {
            const diff = tv - ch;
            const fee = Math.abs(diff) * feeRate;
            if (diff > 0) {
              const need = diff + fee;
              const avail = Math.min(holdings[CASH_ASSET], need);
              if (avail > 1) { holdings[CASH_ASSET] -= avail; holdings[asset] += (avail - fee); }
            } else {
              holdings[CASH_ASSET] += (Math.abs(diff) - fee);
              holdings[asset] = tv;
            }
          }
        }
      }

      totalValue = ASSETS.reduce((s, asset) => s + holdings[asset], 0);
    }
    // 收尾最后一个月
    if (curMonth !== null) {
      const r = prevMonthTotal > 0 ? (totalValue / prevMonthTotal - 1) : 0;
      monthlyReturns.push(r);
      if (totalValue > peakValue) peakValue = totalValue;
      const dd = (totalValue / peakValue - 1) * 100;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    // 指标
    const n = monthlyReturns.length;
    const finalValue = totalValue;
    const totalReturn = (finalValue / totalCapital - 1) * 100;
    const annual = n > 0 ? (Math.pow(finalValue / totalCapital, 12 / n) - 1) * 100 : 0;
    const meanR = n ? monthlyReturns.reduce((x,y)=>x+y,0)/n : 0;
    const variance = n > 1 ? monthlyReturns.reduce((s,r)=>s+(r-meanR)**2,0)/(n-1) : 0;
    const annVol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
    const sharpe = annVol > 0 ? (annual/100 - 0.02) / annVol : 0;
    const neg = monthlyReturns.filter(r => r < 0);
    const dVar = neg.length > 1 ? neg.reduce((s,r)=>s+r*r,0)/(neg.length-1) : 0;
    const annDown = Math.sqrt(Math.max(0, dVar)) * Math.sqrt(12);
    const sortino = annDown > 0 ? (annual/100 - 0.02) / annDown : 0;
    const posMonths = monthlyReturns.filter(r => r > 0).length;
    const winRate = n ? posMonths / n : 0;

    return {
      annual, maxDd: maxDrawdown,
      sharpe: Math.max(0, Math.min(sharpe, 10)),
      sortino: Math.max(0, Math.min(sortino, 10)),
      total: totalReturn, finalValue,
      monthlyWinRate: winRate,
      monthlyReturns,
      positiveMonths: posMonths,
      totalMonths: n,
      trades: monthlyReturns.length  // 占位字段，dailystudy 单独算
    };
  }

  /**
   * 构造再平衡检查日集合
   * schedule:
   *   'weekly-mon'      -> 每周一
   *   'biweekly-mon'    -> 每 2 周周一
   *   'monthly-eom'     -> 每月最后一个交易日
   *   'monthly-day-N'   -> 每月第 N 个交易日（N=1..31，遇周末/节假日顺延下一交易日；数据精度为日，无节假日表，按"周一~周五"判断）
   */
  function buildRebalanceSet(dates, schedule) {
    const set = new Set();
    // alias: monthly-day-N → every-1-months-calendar-N
    if (schedule.startsWith('monthly-day-')) {
      schedule = 'every-1-months-cal-' + schedule.slice('monthly-day-'.length);
    }
    if (schedule === 'weekly-mon' || schedule === 'biweekly-mon') {
      const step = schedule === 'weekly-mon' ? 1 : 2;
      let weekCount = 0;
      for (const d of dates) {
        const dow = new Date(d + 'T00:00:00Z').getUTCDay(); // 0=Sun, 1=Mon
        if (dow === 1) {
          if (weekCount % step === 0) set.add(d);
          weekCount += 1;
        }
      }
    } else if (schedule === 'monthly-eom') {
      // 每月最后一个交易日（数据集中最后一天即月末）
      let prevM = null;
      for (let i = 0; i < dates.length; i++) {
        const m = dates[i].slice(0, 7);
        const nextM = (dates[i+1] || '').slice(0, 7);
        if (m !== nextM) set.add(dates[i]);
        prevM = m;
      }
    } else if (/^every-\d+-months-cal-/.test(schedule)) {
      // 日历日 schedule：每月第 N 个日历日（N=1..31，遇周末顺延下一交易日）
      // 形如 every-N-months-cal-K（K 为日历日 1~31）
      // N 始终 1（每月都触发），K 是日历日
      const dayOfMonth = parseInt(schedule.match(/-cal-(\d+)$/)[1], 10);
      // 收集每月日期范围
      let curMonth = null;
      let monthDates = [];
      const monthDateMap = [];
      for (const d of dates) {
        const m = d.slice(0, 7);
        if (m !== curMonth) {
          monthDateMap.push({ m, dates: monthDates });
          curMonth = m;
          monthDates = [];
        }
        monthDates.push(d);
      }
      monthDateMap.push({ m: curMonth, dates: monthDates });

      // 每月找日历日 = dayOfMonth；若该日非交易日则顺延下个交易日；
      // 该月无该日（如 2 月无 30/31）则取该月末
      for (const entry of monthDateMap) {
        if (!entry.dates.length) continue;
        const targetMonth = entry.m;
        const dayStr = String(dayOfMonth).padStart(2, '0');
        const targetDay = targetMonth + '-' + dayStr;
        // 找 >= targetDay 的第一个交易日
        let pickDay = null;
        for (const d of entry.dates) {
          if (d >= targetDay) { pickDay = d; break; }
        }
        // 该月无此日（如 2 月 30 号不存在且最大 28/29）→ 取月末
        if (!pickDay) pickDay = entry.dates[entry.dates.length - 1];
        // pickDay 是周末则顺延下一交易日
        if (pickDay) {
          let idx = entry.dates.indexOf(pickDay);
          let dow = new Date(pickDay + 'T00:00:00Z').getUTCDay();
          while ((dow === 0 || dow === 6) && idx + 1 < entry.dates.length) {
            idx += 1;
            pickDay = entry.dates[idx];
            dow = new Date(pickDay + 'T00:00:00Z').getUTCDay();
          }
          if (dow === 0 || dow === 6) pickDay = null;  // 整月无交易日（极端）
          if (pickDay) set.add(pickDay);
        }
      }
    } else if (/^every-\d+-months-/.test(schedule)) {
      // 形如 every-N-months-eom 或 every-N-months-day-M（N 为数字）
      const m = schedule.match(/^every-(\d+)-months-(.+)$/);
      if (!m) return set;
      const stepMonths = parseInt(m[1], 10);
      const rest = m[2];
      let dayN;
      if (rest === 'eom') {
        dayN = null;
      } else if (rest.startsWith('day-')) {
        dayN = parseInt(rest.slice('day-'.length), 10);
      } else {
        return set;
      }
      // 收集每月的交易日列表
      let curMonth = null;
      let monthTradingDays = [];
      const monthDayMap = [];  // [{m, lastDay}]
      for (const d of dates) {
        const m = d.slice(0, 7);
        const dow = new Date(d + 'T00:00:00Z').getUTCDay();
        if (m !== curMonth) {
          monthDayMap.push({ m, days: monthTradingDays });
          curMonth = m;
          monthTradingDays = [];
        }
        if (dow >= 1 && dow <= 5) monthTradingDays.push(d);
      }
      monthDayMap.push({ m: curMonth, days: monthTradingDays });

      // 找每 N 月触发点
      for (let i = 0; i < monthDayMap.length; i++) {
        const entry = monthDayMap[i];
        if (i % stepMonths !== 0) continue;
        if (entry.days.length === 0) continue;
        let pickDay;
        if (dayN == null) {
          pickDay = entry.days[entry.days.length - 1];  // EOM
        } else {
          pickDay = entry.days[Math.min(dayN - 1, entry.days.length - 1)];  // 第 N 个交易日（不足则取月末）
        }
        if (pickDay) set.add(pickDay);
      }
    }
    return set;
  }

  function getDefaultResult() {
    return compute(DEFAULT_CONFIG);
  }

  return {
    compute,
    getDefaultResult,
    simulateCMV,
    simulateCMV_daily,
    buildRebalanceSet,
    generateMonthlyReturns,
    DEFAULT_CONFIG,
    PLANS,
    getMatchLevel,
    MATCH_THRESHOLD
  };
})();
