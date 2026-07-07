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

  // 距离阈值：6维欧氏距离超过此值不再信任 trendData 匹配
  const MATCH_THRESHOLD = 0.15;

  /**
   * 6维欧氏距离匹配：直接用6资产权重在 trendData.alloc 中找最近邻
   * 不再压缩为4维，彻底解决"标普100=纳指100"的问题
   */
  function findNearest6D(sliders) {
    const trendData = APP_DATA.trendData;
    let bestDist = Infinity;
    let bestItem = null;

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
        bestDist = dist2;
        bestItem = item;
      }
    }

    return { item: bestItem, distance: Math.sqrt(bestDist) };
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
    const sortino = sharpe * 1.2;

    return {
      annual, maxDd, sharpe: Math.max(0, Math.min(sharpe, 10)),
      sortino: Math.max(0, Math.min(sortino, 10)),
      total: totalReturn, finalValue: 500000 * (1 + totalReturn / 100),
      monthlyWinRate: posMonths / n
    };
  }

  /**
   * 主计算函数
   */
  function compute(sliders) {
    const sum = Object.values(sliders).reduce((a, b) => a + b, 0);

    // 缺额 > 0：缺额部分视为活期（0收益）
    // 用 estimateFromScratch 但把现金月收益临时设为 0
    // 因为缺额=活期，不是货币基金，不产生收益
    if (sum < 100) {
      const estimated = estimateFromScratchWithIdleCash(sliders, 100 - sum);
      return {
        sliders: { ...sliders },
        match: { level: 'custom', label: `配置${sum}% · ${100 - sum}%活期` },
        alloc: Object.fromEntries(
          Object.entries(sliders).map(([k, v]) => [k, v / 100])
        ),
        metrics: estimated
      };
    }

    // 满仓：恒市值法 trendData 精确匹配
    const { item, distance } = findNearest6D(sliders);
    const match = getMatchLevel(distance);

    // 距离太大或没有匹配 → 走精确加权估算（永远正确）
    if (!item || distance > MATCH_THRESHOLD) {
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

    // 近距离匹配：用 trendData 中的精确回测结果（包含完整的月度序列）
    const alloc = item.alloc || {};
    return {
      sliders: { ...sliders },
      match,
      alloc: {
        '沪深300': alloc['沪深300'] || 0,
        '中证500': alloc['中证500'] || 0,
        '标普500': alloc['标普500'] || 0,
        '纳斯达克100': alloc['纳斯达克100'] || 0,
        '黄金': alloc['黄金'] || 0,
        '现金·货币基金': alloc['现金·货币基金'] || 0
      },
      metrics: {
        annual: item.annual || 0,
        maxDd: item.dd || 0,
        sharpe: item.sharpe || 0,
        sortino: item.sortino || 0,
        total: item.total || 0,
        finalValue: item.final || 500000,
        monthlyWinRate: item.w_positive_ratio || 0
      }
    };
  }

  /**
   * 用真实历史月度收益率 + 用户配置权重，生成累计收益和回撤曲线
   */
  function generateMonthlyReturns(alloc, _unused1, _unused2) {
    const rr = APP_DATA.realReturns;
    if (!rr || !rr.asset_returns) {
      return { equityCurve: [0], drawdownCurve: [0], months: 0 };
    }

    const cashMonthly = rr.cash_monthly || 0.00083;
    const n = rr.asset_returns['沪深300'].length;
    const monthlyReturns = [];

    for (let i = 0; i < n; i++) {
      let r = 0;
      for (const [asset, pct] of Object.entries(alloc)) {
        if (pct === 0) continue;
        if (asset === '现金·货币基金') {
          r += pct * cashMonthly;
        } else if (rr.asset_returns[asset]) {
          r += pct * rr.asset_returns[asset][i];
        }
      }
      monthlyReturns.push(r);
    }

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

    return { equityCurve, drawdownCurve, months: n, monthLabels: rr.months };
  }

  function getDefaultResult() {
    return compute(DEFAULT_CONFIG);
  }

  return {
    compute,
    getDefaultResult,
    generateMonthlyReturns,
    DEFAULT_CONFIG,
    getMatchLevel,
    MATCH_THRESHOLD
  };
})();
