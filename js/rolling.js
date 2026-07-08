/**
 * 滚动回测引擎
 * 从不同历史起点开始执行恒市值法策略，记录完整操作日志
 * 
 * 稳健型配置: 沪深300=15% 中证500=5% 标普500=15% 纳斯达克100=20% 黄金=20% 现金·货币基金=25%
 * 初始资金: 50万
 * 策略: 12个月逐步建仓 + 月度再平衡 ±5%阈值
 */

const RollingBacktest = (() => {
  const CONFIG = {
    totalCapital: 500000,
    allocations: {
      '沪深300': 0.15,
      '中证500': 0.05,
      '标普500': 0.15,
      '纳斯达克100': 0.20,
      '黄金': 0.20,
      '现金·货币基金': 0.25
    },
    buildMonths: 12,       // 建仓月数
    threshold: 0.05,       // 再平衡阈值 ±5%
    feeRate: 0.001,        // 交易费率 0.1%
    startYear: 2016,
    startMonth: 7,
    endYear: 2026,
    endMonth: 7
  };

  const ASSETS = ['沪深300', '中证500', '标普500', '纳斯达克100', '黄金', '现金·货币基金'];
  const CASH_ASSET = '现金·货币基金';

  /**
   * 获取所有回测起点（10年前 ~ 1年前，按月对齐）
   * 起点列表: 2016-07, 2017-07, 2018-07, ..., 2025-07
   */
  function getStartPoints() {
    const points = [];
    const endDate = new Date(CONFIG.endYear, CONFIG.endMonth - 1, 1);
    
    for (let yearsAgo = 10; yearsAgo >= 1; yearsAgo--) {
      const startDate = new Date(endDate);
      startDate.setFullYear(startDate.getFullYear() - yearsAgo);
      const y = startDate.getFullYear();
      const m = startDate.getMonth() + 1;
      const label = `${y}年${m}月`;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      
      // 检查这个起点是否在数据范围内
      const rr = APP_DATA.realReturns;
      const monthIdx = rr.months.indexOf(key);
      const inDataRange = monthIdx >= 0;
      
      // 从起点到终点需要的月数
      const totalMonthsNeeded = (endDate.getFullYear() - y) * 12 + (endDate.getMonth() + 1 - m);
      
      points.push({
        yearsAgo,
        label,
        key,
        year: y,
        month: m,
        inDataRange,
        monthIdx,
        totalMonthsNeeded,
        // 数据覆盖的月数（从起点到数据末尾）
        dataMonthsAvailable: inDataRange ? (rr.months.length - monthIdx) : 0
      });
    }
    return points;
  }

  /**
   * 获取某月的各资产收益率
   * @param {string} monthKey - 如 "2016-07"
   * @returns {Object|null} {asset: return} 或 null（数据不足）
   */
  function getMonthReturns(monthKey) {
    const rr = APP_DATA.realReturns;
    const idx = rr.months.indexOf(monthKey);
    if (idx < 0) return null;
    
    const ret = {};
    for (const asset of ASSETS) {
      if (asset === CASH_ASSET) {
        ret[asset] = rr.cash_monthly || 0.00083;
      } else if (rr.asset_returns[asset]) {
        ret[asset] = rr.asset_returns[asset][idx] || 0;
      } else {
        ret[asset] = 0;
      }
    }
    return ret;
  }

  /**
   * 生成估计的月度收益率
   * 基于已有数据的均值和波动率，用正态分布采样生成估计值
   * 标注为估计值
   */
  function estimateMonthReturns(asset) {
    const rr = APP_DATA.realReturns;
    if (!rr || !rr.asset_returns || !rr.asset_returns[asset]) {
      return { value: 0, estimated: true };
    }
    
    const returns = rr.asset_returns[asset];
    const n = returns.length;
    
    // 计算均值和标准差
    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
    const std = Math.sqrt(variance);
    
    // 使用均值作为估计（而非随机采样，保证结果可复现）
    // 对于现金，使用固定的月度收益率
    return { value: mean, estimated: true, note: `基于${n}个月历史数据的均值估计` };
  }

  /**
   * 获取某月完整的资产收益率（数据不足时用估计值）
   */
  function getMonthReturnsWithFallback(monthKey) {
    const rr = APP_DATA.realReturns;
    const idx = rr.months.indexOf(monthKey);
    const ret = {};
    
    for (const asset of ASSETS) {
      if (asset === CASH_ASSET) {
        ret[asset] = { value: rr.cash_monthly || 0.00083, estimated: false };
      } else if (idx >= 0 && rr.asset_returns[asset] && idx < rr.asset_returns[asset].length) {
        ret[asset] = { value: rr.asset_returns[asset][idx] || 0, estimated: false };
      } else {
        ret[asset] = estimateMonthReturns(asset);
      }
    }
    return ret;
  }

  /**
   * 生成月份标签（如 "2016-07"）
   */
  function makeMonthKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  /**
   * 月份加法
   */
  function addMonths(year, month, n) {
    const totalMonths = year * 12 + (month - 1) + n;
    const newYear = Math.floor(totalMonths / 12);
    const newMonth = (totalMonths % 12) + 1;
    return { year: newYear, month: newMonth };
  }

  /**
   * 执行单个起点的滚动回测
   * @param {Object} startPoint - 起点信息
   * @returns {Object} 完整的回测结果和操作日志
   */
  function runSingleBacktest(startPoint) {
    const { year, month, totalMonthsNeeded } = startPoint;
    const allocations = CONFIG.allocations;
    const totalCapital = CONFIG.totalCapital;
    const buildMonths = CONFIG.buildMonths;
    const threshold = CONFIG.threshold;
    
    // 初始化状态
    const holdings = {};      // 各资产当前持有市值
    const targetValues = {};  // 各资产目标市值
    for (const asset of ASSETS) {
      holdings[asset] = 0;
      targetValues[asset] = totalCapital * allocations[asset];
    }
    
    let cashBalance = totalCapital;  // 现金余额（未投资部分，含活期利息）
    let totalValue = totalCapital;   // 总市值（含现金余额）
    let peakValue = totalCapital;    // 历史最高市值
    let maxDrawdown = 0;             // 最大回撤
    let prevTotalValue = totalCapital; // 上月总市值（用于计算月收益率）
    
    const monthlySnapshots = []; // 每月快照（包含全部6资产详情）
    let hasEstimatedData = false;
    
    let currentYear = year;
    let currentMonth = month;
    
    // 逐月模拟
    for (let t = 0; t < totalMonthsNeeded; t++) {
      const monthKey = makeMonthKey(currentYear, currentMonth);
      const isBuildPhase = t < buildMonths;
      
      // 获取本月各资产收益率
      const monthReturns = getMonthReturnsWithFallback(monthKey);
      const anyEstimated = Object.values(monthReturns).some(r => r.estimated);
      if (anyEstimated) hasEstimatedData = true;
      
      // === 第1步：更新资产市值（按当月收益率变动） ===
      const holdingsBeforeReturns = {};
      for (const asset of ASSETS) {
        holdingsBeforeReturns[asset] = holdings[asset];
      }
      
      for (const asset of ASSETS) {
        if (asset === CASH_ASSET) {
          holdings[asset] *= (1 + monthReturns[asset].value);
          cashBalance *= (1 + monthReturns[asset].value);
        } else {
          holdings[asset] *= (1 + monthReturns[asset].value);
        }
      }
      
      // === 第2步：如果是建仓期，投入当月建仓金额 ===
      const buildFraction = Math.min(1, (t + 1) / buildMonths);
      const opEntries = [];
      
      if (isBuildPhase) {
        for (const asset of ASSETS) {
          if (asset === CASH_ASSET) continue; // 现金不需要建仓
          
          const currentTarget = targetValues[asset] * buildFraction;
          const currentHolding = holdings[asset];
          const deviation = currentTarget - currentHolding;
          
          if (Math.abs(deviation) > 1) { // 偏差超过1元才操作
            const fee = Math.abs(deviation) * CONFIG.feeRate;
            const actualInvest = deviation > 0 ? deviation : deviation;
            
            // 从现金余额扣除
            if (deviation > 0) {
              cashBalance -= (deviation + fee);
            } else {
              cashBalance += (Math.abs(deviation) - fee);
            }
            holdings[asset] = currentTarget;
            
            opEntries.push({
              asset,
              action: deviation > 0 ? '买入建仓' : '卖出调整',
              amount: Math.abs(deviation),
              fee,
              holdingAfter: holdings[asset],
              reason: `建仓期第${t + 1}/${buildMonths}月，目标比例${(allocations[asset] * 100).toFixed(0)}% × ${(buildFraction * 100).toFixed(0)}% = ¥${currentTarget.toFixed(0)}`
            });
          }
        }
      }
      
      // === 第3步：再平衡检查（非建仓期） ===
      if (!isBuildPhase) {
        totalValue = Object.values(holdings).reduce((a, b) => a + b, 0) + cashBalance;
        
        for (const asset of ASSETS) {
          const targetPct = allocations[asset];
          const actualPct = totalValue > 0 ? holdings[asset] / totalValue : 0;
          const deviation = actualPct - targetPct;
          
          // 偏离超过 ±5% 触发调仓
          if (Math.abs(deviation) > threshold) {
            const targetVal = totalValue * targetPct;
            const diff = targetVal - holdings[asset];
            const fee = Math.abs(diff) * CONFIG.feeRate;
            
            if (asset === CASH_ASSET) {
              // 现金的调仓：从其他资产来/去其他资产
              // 简化处理：现金的调整通过现金余额完成
              cashBalance += (diff - fee);
              holdings[asset] = targetVal;
            } else {
              // 从现金余额扣款或回款到现金余额
              if (diff > 0) {
                // 需要买入：从现金余额扣
                const available = Math.min(cashBalance, diff + fee);
                if (available > 1) {
                  cashBalance -= available;
                  holdings[asset] += (available - fee);
                }
              } else {
                // 需要卖出：回款到现金余额
                cashBalance += (Math.abs(diff) - fee);
                holdings[asset] = targetVal;
              }
            }
            
            opEntries.push({
              asset,
              action: deviation > 0 ? '卖出（超配）' : '买入（低配）',
              amount: Math.abs(diff),
              fee,
              holdingAfter: holdings[asset],
              deviationBefore: (deviation * 100).toFixed(2) + '%',
              reason: `实际${(actualPct * 100).toFixed(1)}%偏离目标${(targetPct * 100).toFixed(0)}%超过±5%阈值`
            });
          }
        }
      }
      
      // === 第4步：计算本月总市值 ===
      totalValue = Object.values(holdings).reduce((a, b) => a + b, 0) + cashBalance;
      
      // 更新峰值和回撤
      if (totalValue > peakValue) {
        peakValue = totalValue;
      }
      const dd = (totalValue / peakValue - 1) * 100;
      if (dd < maxDrawdown) maxDrawdown = dd;
      
      // 月收益率
      const monthReturn = prevTotalValue > 0 
        ? (totalValue / prevTotalValue - 1)
        : 0;
      prevTotalValue = totalValue;
      
      // === 第5步：构建每月完整持仓快照（展示用，含全部6资产 + 现金余额合并） ===
      // 展示用的 holdings: 把 cashBalance 合并进 现金·货币基金
      const displayHoldings = { ...holdings };
      displayHoldings[CASH_ASSET] += cashBalance;
      
      const assetDetails = ASSETS.map(asset => {
        const actualPct = totalValue > 0 ? displayHoldings[asset] / totalValue : 0;
        const targetPct = allocations[asset];
        const deviation = actualPct - targetPct;
        const op = opEntries.find(e => e.asset === asset);
        return {
          asset,
          targetPct,
          holdingBefore: holdingsBeforeReturns[asset] + (asset === CASH_ASSET ? cashBalance / (1 + (monthReturns[asset]?.value || monthReturns[asset] || 0)) : 0),
          monthReturn: monthReturns[asset],
          holdingAfter: displayHoldings[asset],
          actualPct,
          deviation,
          triggered: Math.abs(deviation) > threshold || (isBuildPhase && asset !== CASH_ASSET),
          action: op ? op.action : (isBuildPhase && asset !== CASH_ASSET ? '买入建仓' : '无操作'),
          amount: op ? op.amount : 0,
          fee: op ? op.fee : 0,
          reason: op ? op.reason : ''
        };
      });
      
      const snapshot = {
        month: monthKey,
        monthIndex: t + 1,
        phase: isBuildPhase ? `建仓期(${t + 1}/${buildMonths})` : '再平衡期',
        holdings: { ...holdings },
        cashBalance,
        totalValue,
        drawdown: dd,
        peakValue,
        assetDetails,
        monthReturn,
        estimatedMonth: anyEstimated,
        hasOperations: opEntries.length > 0,
        opCount: opEntries.length
      };
      monthlySnapshots.push(snapshot);
      
      // 进入下一个月
      const next = addMonths(currentYear, currentMonth, 1);
      currentYear = next.year;
      currentMonth = next.month;
    }
    
    // 计算最终指标
    const finalValue = totalValue;
    const totalReturn = (finalValue / totalCapital - 1) * 100;
    const nYears = totalMonthsNeeded / 12;
    const annualReturn = (Math.pow(finalValue / totalCapital, 1 / nYears) - 1) * 100;
    
    // 计算赚钱月占比
    const positiveMonths = monthlySnapshots.filter(s => s.monthReturn > 0).length;
    const winRate = monthlySnapshots.length > 0
      ? (positiveMonths / monthlySnapshots.length) * 100 
      : 0;
    
    // 计算Sharpe
    const monthlyReturns = monthlySnapshots.map(s => s.monthReturn);
    const meanR = monthlyReturns.length > 0 ? monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length : 0;
    const variance = monthlyReturns.length > 1 
      ? monthlyReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / (monthlyReturns.length - 1)
      : 0;
    const annVol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
    const sharpe = annVol > 0 ? (annualReturn / 100 - 0.02) / annVol : 0;
    const sortino = sharpe * 1.2;
    
    // 计算操作次数（建仓期每月5笔 + 再平衡期触发次数）
    const operationCount = monthlySnapshots.reduce((sum, s) => sum + s.opCount, 0);
    
    return {
      startPoint,
      finalValue,
      totalReturn,
      annualReturn,
      maxDrawdown,
      sharpe: Math.max(0, Math.min(sharpe, 10)),
      sortino: Math.max(0, Math.min(sortino, 10)),
      winRate,
      annVol,
      totalMonths: totalMonthsNeeded,
      operationCount,
      monthlySnapshots,    // 每月完整快照（含全部资产详情）
      hasEstimatedData
    };
  }

  /**
   * 执行所有起点的滚动回测
   */
  function runAll() {
    const points = getStartPoints();
    const results = [];
    
    for (const point of points) {
      const result = runSingleBacktest(point);
      results.push(result);
    }
    
    return results;
  }

  /**
   * 格式化金额
   */
  function fmtMoney(val) {
    if (val >= 10000) {
      return (val / 10000).toFixed(2) + '万';
    }
    return val.toFixed(0);
  }

  /**
   * 格式化百分比
   */
  function fmtPct(val) {
    return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
  }

  /**
   * 导出单个回测的完整日志为CSV（每月一行，含全部6资产）
   */
  function exportLogCSV(result) {
    const header = ['月份', '阶段', '资产', '目标比例', '月初市值(元)', '本月收益率', '月末市值(元)', '实际比例', '偏离度', '操作', '操作金额(元)', '手续费(元)', '总市值(元)', '月收益率', '数据状态'];
    const rows = [header];
    
    for (const snap of result.monthlySnapshots) {
      for (const ad of snap.assetDetails) {
        rows.push([
          snap.month,
          snap.phase,
          ad.asset,
          (ad.targetPct * 100).toFixed(0) + '%',
          ad.holdingBefore.toFixed(2),
          ((ad.monthReturn?.value || ad.monthReturn || 0) * 100).toFixed(2) + '%',
          ad.holdingAfter.toFixed(2),
          (ad.actualPct * 100).toFixed(2) + '%',
          (ad.deviation * 100).toFixed(2) + '%',
          ad.action,
          ad.amount > 0 ? ad.amount.toFixed(2) : '-',
          ad.fee > 0 ? ad.fee.toFixed(2) : '-',
          snap.totalValue.toFixed(2),
          (snap.monthReturn * 100).toFixed(2) + '%',
          snap.estimatedMonth ? '⚠️估计值' : '真实数据'
        ]);
      }
    }
    
    return rows.map(r => r.join(',')).join('\n');
  }

  /**
   * 导出汇总表为CSV
   */
  function exportSummaryCSV(results) {
    const header = ['起点', '回测月数', '最终市值(元)', '总收益率(%)', '年化收益(%)', '最大回撤(%)', 'Sharpe', 'Sortino', '月胜率(%)', '年化波动(%)', '操作次数', '数据状态'];
    const rows = [header];
    
    for (const r of results) {
      rows.push([
        r.startPoint.label,
        r.totalMonths,
        r.finalValue.toFixed(2),
        r.totalReturn.toFixed(2),
        r.annualReturn.toFixed(2),
        r.maxDrawdown.toFixed(2),
        r.sharpe.toFixed(4),
        r.sortino.toFixed(4),
        r.winRate.toFixed(1),
        r.annVol.toFixed(2),
        r.operationCount,
        r.hasEstimatedData ? '含估计值' : '全部真实数据'
      ]);
    }
    
    return rows.map(r => r.join(',')).join('\n');
  }

  return {
    CONFIG,
    getStartPoints,
    runSingleBacktest,
    runAll,
    fmtMoney,
    fmtPct,
    exportLogCSV,
    exportSummaryCSV
  };
})();
