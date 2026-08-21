/**
 * 回测计算引擎
 * 6维资产权重直接匹配 + 降级估算
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

  function getDefaultResult() {
    return compute(DEFAULT_CONFIG);
  }

  return {
    compute,
    getDefaultResult,
    simulateCMV,
    generateMonthlyReturns,
    DEFAULT_CONFIG,
    PLANS,
    getMatchLevel,
    MATCH_THRESHOLD
  };
})();
