/**
 * 回测计算引擎
 * 最近邻匹配 + 降级估算
 */

const BacktestEngine = (() => {
  // 默认配置（最终方案）
  const DEFAULT_CONFIG = {
    '沪深300': 19,
    '中证500': 11,
    '标普500': 17,
    '纳斯达克100': 23,
    '黄金': 15,
    '现金·货币基金': 15
  };

  // 距离阈值：超过此值不再信任最近邻匹配，改用真实数据加权估算
  const MATCH_THRESHOLD = 0.12;

  /**
   * 用户6滑块 → 4参数
   */
  function slidersToParams(sliders) {
    return {
      a: (sliders['沪深300'] + sliders['中证500']) / 100,
      u: (sliders['标普500'] + sliders['纳斯达克100']) / 100,
      g: sliders['黄金'] / 100,
      c: sliders['现金·货币基金'] / 100
    };
  }

  /**
   * 欧氏距离最近邻匹配
   */
  function findNearest(params) {
    const trendData = APP_DATA.trendData;
    let bestDist = Infinity;
    let bestItem = null;

    for (const item of trendData) {
      const da = params.a - (item.a || 0);
      const du = params.u - (item.u || 0);
      const dg = params.g - (item.gold_pct || 0);
      const dc = params.c - (item.c || 0.20);
      const dist = da * da + du * du + dg * dg + dc * dc;

      if (dist < bestDist) {
        bestDist = dist;
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
   * 降级估算：用各资产独立年化 + 配置权重做加权
   * 假设资产间相关性为平均值，回撤按加权估计
   */
  function estimateFromScratch(sliders) {
    // 用真实月度收益率数据加权计算年化和回撤
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
      monthlyReturns.push(r);
    }

    // 累计收益 → 年化
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

    // Sharpe 简化估算
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
    const params = slidersToParams(sliders);
    const { item, distance } = findNearest(params);
    const match = getMatchLevel(distance);

    // 距离太大（>12%）→ 降级为加权估算，避免匹配到无关配置
    if (!item || distance > MATCH_THRESHOLD) {
      const estimated = estimateFromScratch(sliders);
      return {
        params,
        sliders: { ...sliders },
        match,
        alloc: Object.fromEntries(
          Object.entries(sliders).map(([k, v]) => [k, v / 100])
        ),
        metrics: estimated
      };
    }

    // 正常匹配
    const alloc = item.alloc || {};
    return {
      params,
      sliders: { ...sliders },
      match,
      alloc: {
        '沪深300': alloc['沪深300'] || 0,
        '中证500': alloc['中证500'] || 0,
        '标普500': alloc['标普500'] || 0,
        '纳斯达克100': alloc['纳斯达克100'] || 0,
        '黄金': alloc['黄金'] || 0,
        '现金·货币基金': item.c || 0.20
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
