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
    endMonth: 8
  };

  const ASSETS = ['沪深300', '中证500', '标普500', '纳斯达克100', '黄金', '现金·货币基金'];
  const CASH_ASSET = '现金·货币基金';

  // ============================================================
  //  进行中月份叠加层（live overlay）—— 与 engine.js#simulateCMV 同源同口径
  //  ● 由 js/progress.json 的 MTD 驱动；months 之外的「未完整月」按 MTD 重估，
  //    该月**不触发再平衡**（恒市值法只在月末调仓），故结果 = 上月末持仓 × (1+MTD)。
  //  ● 本引擎的 monthlySnapshots **保持固化**（绝不 append 叠加月）：
  //    完整持仓日志表格 / CSV 导出 / 既有图表仍走已定稿口径，零回归风险；
  //    叠加结果单独挂在 result.live 上，供「弹窗顶部汇总 / 滚动汇总表 / 折线图」使用。
  //  ● 校验：月份格式合法、必须**晚于**数据末月、且**不在** months 里，否则静默拒绝。
  // ============================================================
  let LIVE_OVERLAY = null;

  function setLiveOverlay(o) {
    LIVE_OVERLAY = null;
    if (!o || !o.month || !o.mtd) return null;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(o.month))) return null;
    const rr = (typeof APP_DATA !== 'undefined' && APP_DATA) ? APP_DATA.realReturns : null;
    if (!rr || !rr.months || !rr.months.length) return null;
    const lastMonth = rr.months[rr.months.length - 1];
    // 晚于数据末月 + 未定稿（不在 months 里）——两者缺一都说明快照过期或数据已收口
    if (rr.months.indexOf(o.month) >= 0 || String(o.month) <= String(lastMonth)) return null;
    // 数值闸门：null / undefined / '' / 布尔 / 数组 / 非有限数一律拒绝。
    // ⚠️ 必须显式拦住 null —— Number(null) === 0，会把「没有数据」当成「当月持平」。
    const mtd = {};
    const keys = Object.keys(o.mtd);
    if (!keys.length) return null;
    for (const k of keys) {
      const v = o.mtd[k];
      if (v === null || v === undefined || v === '' || typeof v === 'boolean' || Array.isArray(v)) return null;
      const n = Number(v);
      if (!isFinite(n)) return null;   // 任一资产数值异常 → 整体不启用，宁可不显示
      mtd[k] = n;
    }
    LIVE_OVERLAY = { month: String(o.month), asOf: o.asOf || '', mtd, baseMonth: lastMonth };
    return LIVE_OVERLAY;
  }

  function getLiveOverlay() { return LIVE_OVERLAY; }
  function clearLiveOverlay() { LIVE_OVERLAY = null; }

  /**
   * 获取所有回测起点（数据最早月 ~ 1年前，按月对齐）
   * 起点列表: 2015-08 (132个月), 2016-07, 2017-07, ..., 2025-08
   */
  function getStartPoints() {
    const points = [];
    const rr = APP_DATA.realReturns;
    const endDate = new Date(CONFIG.endYear, CONFIG.endMonth - 1, 1);
    
    // 1. 先添加数据最早月作为起点（2015-08）— 一次建仓版
    const earliestKey = rr.months[0]; // "2015-08"
    const [ey, em] = earliestKey.split('-').map(Number);
    const earliestMonthIdx = rr.months.indexOf(earliestKey); // 0
    // 覆盖到 months 末位（最新真实收益月，含），inclusive
    const earliestMonthsNeeded = rr.months.length - earliestMonthIdx;
    points.push({
      yearsAgo: null,
      label: `${ey}年${em}月`,
      key: earliestKey,
      year: ey,
      month: em,
      inDataRange: true,
      monthIdx: earliestMonthIdx,
      totalMonthsNeeded: earliestMonthsNeeded,
      dataMonthsAvailable: rr.months.length,
      isEarliest: true,
      buildMonths: 1,
      buildLabel: '一次建仓版'
    });

    // 1b. 同起点（2015-08）— 分批建仓版（公平对比）
    points.push({
      yearsAgo: null,
      label: `${ey}年${em}月`,
      key: earliestKey,
      year: ey,
      month: em,
      inDataRange: true,
      monthIdx: 0,
      totalMonthsNeeded: earliestMonthsNeeded,
      dataMonthsAvailable: rr.months.length,
      isEarliest: false,
      isComparison: true,         // 标记为对比版本
      buildMonths: 12,
      buildLabel: '分批建仓版'
    });
    
    // 2. 再添加常规起点（10年前 ~ 1年前）
    for (let yearsAgo = 10; yearsAgo >= 1; yearsAgo--) {
      const startDate = new Date(endDate);
      startDate.setFullYear(startDate.getFullYear() - yearsAgo);
      const y = startDate.getFullYear();
      const m = startDate.getMonth() + 1;
      const label = `${y}年${m}月`;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      
      // 跳过与最早起点重复的月份
      if (key === earliestKey) continue;
      
      const monthIdx = rr.months.indexOf(key);
      const inDataRange = monthIdx >= 0;
      // 覆盖到 months 末位（最新真实收益月，含），inclusive
      const totalMonthsNeeded = rr.months.length - monthIdx;
      
      points.push({
        yearsAgo,
        label,
        key,
        year: y,
        month: m,
        inDataRange,
        monthIdx,
        totalMonthsNeeded,
        dataMonthsAvailable: inDataRange ? (rr.months.length - monthIdx) : 0,
        buildMonths: CONFIG.buildMonths,  // 12个月分批建仓
        buildLabel: '分批建仓版'           // 版本标签
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
    // 约定：returns[i] 对应 months[i+1]，months[0] 是入场标记月（无收益）
    // 故 monthKey 的真实收益索引 = idx - 1；入场标记月（idx===0）无收益
    const idx = rr.months.indexOf(monthKey);
    if (idx < 1) return null;

    const ret = {};
    for (const asset of ASSETS) {
      if (asset === CASH_ASSET) {
        ret[asset] = rr.cash_monthly || 0.00083;
      } else if (rr.asset_returns[asset]) {
        ret[asset] = rr.asset_returns[asset][idx - 1] || 0;
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

    // 约定：returns[i] 对应 months[i+1]，months[0] 是入场标记月（无真实收益）
    // 故 monthKey 对应的真实收益索引 = idx - 1
    // 入场标记月（idx===0）无真实收益 → 走估计分支
    const ridx = idx - 1;

    for (const asset of ASSETS) {
      if (asset === CASH_ASSET) {
        ret[asset] = { value: rr.cash_monthly || 0.00083, estimated: false };
      } else if (idx >= 1 && rr.asset_returns[asset] && ridx < rr.asset_returns[asset].length) {
        ret[asset] = { value: rr.asset_returns[asset][ridx] || 0, estimated: false };
      } else if (idx === 0) {
        // 入场标记月（months[0]）无真实收益，按 0 处理（不计入估计，保持"全部真实"）
        ret[asset] = { value: 0, estimated: false };
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
  function runSingleBacktest(startPoint, opts) {
    const { year, month, totalMonthsNeeded } = startPoint;
    const allocations = CONFIG.allocations;
    const totalCapital = CONFIG.totalCapital;
    const buildMonths = startPoint.buildMonths || CONFIG.buildMonths;
    const threshold = CONFIG.threshold;
    
    // 初始化状态
    const holdings = {};      // 各资产当前持有市值
    const targetValues = {};  // 各资产目标市值（恒定不变！）
    for (const asset of ASSETS) {
      holdings[asset] = 0;
      targetValues[asset] = totalCapital * allocations[asset];
    }
    
    let cashBalance = totalCapital;  // 初始现金（第1个月月初会合并到 holdings[CASH_ASSET]）
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
      
      // 月初：把现金余额合并到现金·货币基金持仓（统一处理）
      holdings[CASH_ASSET] += cashBalance;
      cashBalance = 0;
      
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
        const ret = monthReturns[asset]?.value ?? monthReturns[asset] ?? 0;
        holdings[asset] *= (1 + ret);
      }
      
      // === 第2步：如果是建仓期，投入当月建仓金额 ===
      const buildFraction = Math.min(1, (t + 1) / buildMonths);
      const opEntries = [];
      
      if (isBuildPhase) {
        // 建仓阶段标签：一次建仓 vs 分批建仓
        const buildPhaseLabel = buildMonths === 1 
          ? '一次建仓(第1个月全仓买入)' 
          : `分批建仓(${t + 1}/${buildMonths})`;
        for (const asset of ASSETS) {
          if (asset === CASH_ASSET) continue; // 现金不需要建仓，保持当前市值
          
          // 恒定市值法建仓：每月目标 = 最终目标市值 × 建仓进度
          const currentTarget = targetValues[asset] * buildFraction;
          const currentHolding = holdings[asset];
          const diff = currentTarget - currentHolding;
          
          if (Math.abs(diff) > 1) {
            const fee = Math.abs(diff) * CONFIG.feeRate;
            
            if (diff > 0) {
              // 买入：从现金持仓扣（现金不足时只买能买的部分）
              const needed = diff + fee;
              const available = Math.max(0, Math.min(holdings[CASH_ASSET], needed));
              if (available > 1) {
                holdings[CASH_ASSET] -= available;
                holdings[asset] += (available - fee);
              }
            } else {
              // 卖出：回款到现金持仓
              holdings[CASH_ASSET] += (Math.abs(diff) - fee);
              holdings[asset] = currentTarget;
            }
            
            opEntries.push({
              asset,
              action: diff > 0 ? '买入建仓' : '卖出调整',
              amount: Math.abs(diff),
              fee,
              holdingAfter: holdings[asset],
              reason: buildMonths === 1
                ? `一次建仓：目标市值 ¥${targetValues[asset].toFixed(0)}，一次性买入到位`
                : `分批建仓第${t + 1}/${buildMonths}月，目标市值 ¥${targetValues[asset].toFixed(0)} × ${(buildFraction * 100).toFixed(0)}% = ¥${currentTarget.toFixed(0)}`
            });
          }
        }
      }
      
      // === 第3步：再平衡检查（恒定市值法） ===
      if (!isBuildPhase) {
        totalValue = Object.values(holdings).reduce((a, b) => a + b, 0);
        
        for (const asset of ASSETS) {
          const targetVal = targetValues[asset]; // 恒定市值法：目标市值永远不变！
          const currentHolding = holdings[asset];
          
          // 偏离 = (当前市值 - 目标市值) / 目标市值，超过 ±5% 触发
          const deviationFromTarget = targetVal > 0 ? (currentHolding - targetVal) / targetVal : 0;
          
          if (Math.abs(deviationFromTarget) > threshold) {
            const diff = targetVal - currentHolding;
            const fee = Math.abs(diff) * CONFIG.feeRate;
            
            if (asset === CASH_ASSET) {
              // 现金资产偏离目标：从其他资产调仓过来/过去会自然调整
              // 此处不做操作，现金由其他资产的买卖自动调整
              // 但如果其他资产都没有触发，现金独自偏离则需要单独处理
              // 实际上现金的偏离会在其他资产调仓后自动接近目标
              continue;
            } else {
              if (diff > 0) {
                // 市值低于目标 → 买入补仓，从现金持仓扣
                const needed = diff + fee;
                const available = Math.min(holdings[CASH_ASSET], needed);
                if (available > 1) {
                  holdings[CASH_ASSET] -= available;
                  holdings[asset] += (available - fee);
                }
              } else {
                // 市值高于目标 → 卖出获利，回款到现金持仓
                holdings[CASH_ASSET] += (Math.abs(diff) - fee);
                holdings[asset] = targetVal;
              }
            }
            
            opEntries.push({
              asset,
              action: deviationFromTarget > 0 ? '卖出（超目标市值）' : '买入（低于目标市值）',
              amount: Math.abs(diff),
              fee,
              holdingAfter: holdings[asset],
              deviationBefore: (deviationFromTarget * 100).toFixed(1) + '%',
              reason: `当前市值 ¥${currentHolding.toFixed(0)} 偏离目标 ¥${targetVal.toFixed(0)} 达 ${(deviationFromTarget * 100).toFixed(1)}%，超过±5%阈值`
            });
          }
        }
      }
      
      // === 第4步：计算本月总市值（全部在 holdings 中） ===
      totalValue = Object.values(holdings).reduce((a, b) => a + b, 0);
      
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
      
      // === 第5步：构建每月完整持仓快照 ===
      const assetDetails = ASSETS.map(asset => {
        const actualPct = totalValue > 0 ? holdings[asset] / totalValue : 0;
        const targetPct = allocations[asset];
        const targetVal = targetValues[asset];
        const deviationFromTarget = targetVal > 0 ? (holdings[asset] - targetVal) / targetVal : 0;
        const op = opEntries.find(e => e.asset === asset);
        return {
          asset,
          targetPct,
          targetVal,
          holdingBefore: holdingsBeforeReturns[asset],
          monthReturn: monthReturns[asset],
          holdingAfter: holdings[asset],
          actualPct,
          deviationFromTarget,
          triggered: op != null,
          action: op ? op.action : '无操作',
          amount: op ? op.amount : 0,
          fee: op ? op.fee : 0,
          reason: op ? op.reason : ''
        };
      });
      
      const snapshot = {
        month: monthKey,
        monthIndex: t + 1,
        phase: isBuildPhase 
          ? (buildMonths === 1 ? '一次建仓' : `分批建仓(${t + 1}/${buildMonths})`)
          : '再平衡期',
        holdings: { ...holdings },
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
    
    // ============================================================
    //  进行中月份叠加层（live overlay）—— 与 engine.js#simulateCMV 同源同口径
    //  ⚠️ 绝不动 monthlySnapshots：叠加结果只挂在 result.live 上，
    //     日志表格 / CSV 导出 / 既有图表因此保持已定稿口径、零回归。
    // ============================================================
    let live = null;
    const ov = (opts && opts.liveOverlay === false) ? null : LIVE_OVERLAY;
    if (ov) {
      const anchorSnap = monthlySnapshots[monthlySnapshots.length - 1];
      // 只在本次回测确实跑到叠加月起点（= 数据末月）时才叠加；
      // 否则说明该起点序列没覆盖到末月，硬接尾会得出错误口径。
      if (anchorSnap && anchorSnap.month === ov.baseMonth) {
        const before = {};
        for (const asset of ASSETS) before[asset] = holdings[asset];

        let liveTotal = 0;
        const liveDetails = [];
        for (const asset of ASSETS) {
          const r = Number(ov.mtd[asset]) || 0;
          const after = before[asset] * (1 + r);
          holdings[asset] = after;
          liveTotal += after;
          liveDetails.push({
            asset,
            targetPct: allocations[asset],
            targetVal: targetValues[asset],
            holdingBefore: before[asset],
            monthReturn: { value: r, estimated: false },
            holdingAfter: after,
            actualPct: 0,
            deviationFromTarget: 0,
            triggered: false,        // 未完整月不调仓：恒市值法只在月末再平衡
            action: '无操作',
            amount: 0,
            fee: 0,
            reason: '进行中月份：恒市值法仅在月末调仓，本月不产生任何买卖'
          });
        }
        for (const d of liveDetails) {
          d.actualPct = liveTotal > 0 ? d.holdingAfter / liveTotal : 0;
          d.deviationFromTarget = d.targetVal > 0 ? (d.holdingAfter - d.targetVal) / d.targetVal : 0;
        }

        const liveMonthReturn = prevTotalValue > 0 ? (liveTotal / prevTotalValue - 1) : 0;
        if (liveTotal > peakValue) peakValue = liveTotal;
        const liveDd = (liveTotal / peakValue - 1) * 100;   // 同主循环：负数百分比

        const liveSnap = {
          month: ov.month,
          monthIndex: monthlySnapshots.length + 1,   // 累计月序（入场月 = 第 1 个月）
          phase: '进行中',
          holdings: { ...holdings },
          totalValue: liveTotal,
          drawdown: liveDd,
          peakValue,
          assetDetails: liveDetails,
          monthReturn: liveMonthReturn,
          estimatedMonth: false,     // 未完成月不是「历史数据回退估计」，不污染数据质量判定
          isLiveEstimate: true,
          hasOperations: false,
          opCount: 0
        };

        live = Object.assign({
          month: ov.month,
          asOf: ov.asOf || '',
          baseMonth: ov.baseMonth,
          snapshot: liveSnap
        }, computeMetrics(monthlySnapshots.concat([liveSnap]), totalCapital));
      }
    }

    const metrics = computeMetrics(monthlySnapshots, totalCapital);
    return {
      startPoint,
      finalValue: metrics.finalValue,
      totalReturn: metrics.totalReturn,
      annualReturn: metrics.annualReturn,
      maxDrawdown: metrics.maxDrawdown,
      sharpe: metrics.sharpe,
      sortino: metrics.sortino,
      winRate: metrics.winRate,
      yearWinRate: metrics.yearWinRate,
      annVol: metrics.annVol,
      totalMonths: metrics.totalMonths,
      operationCount: metrics.operationCount,
      activeMonths: metrics.activeMonths,
      finalPosition: metrics.finalPosition,
      monthlySnapshots,    // 每月完整快照（含全部资产详情）—— 恒为固化序列
      hasEstimatedData,
      live,                // 含本月至今估算的口径（无叠加时为 null）
      overlayMonth: live ? live.month : null,
      frozenMonths: monthlySnapshots.length
    };
  }

  /**
   * 由月度快照序列计算全部指标
   * 已定稿口径与叠加口径共用同一函数 —— 从根上杜绝「两套数字」再次分叉。
   * @param {Array} snaps 月度快照序列（month / totalValue / drawdown / monthReturn / holdings / opCount）
   * @param {number} totalCapital 固定基准本金（50 万）
   */
  function computeMetrics(snaps, totalCapital) {
    const n = snaps.length;
    const finalValue = n ? snaps[n - 1].totalValue : totalCapital;
    const totalReturn = (finalValue / totalCapital - 1) * 100;
    const nYears = n / 12;
    const annualReturn = nYears > 0 ? (Math.pow(finalValue / totalCapital, 1 / nYears) - 1) * 100 : 0;

    // 赚钱月占比
    const positiveMonths = snaps.filter(s => s.monthReturn > 0).length;
    const winRate = n > 0 ? (positiveMonths / n) * 100 : 0;

    // 自然年胜率（每年收益率汇总后判断）
    const yearReturns = {};
    for (const snap of snaps) {
      const y = parseInt(snap.month.substring(0, 4));
      if (!yearReturns[y]) yearReturns[y] = 1;
      yearReturns[y] *= (1 + snap.monthReturn);
    }
    const years = Object.keys(yearReturns);
    const positiveYears = years.filter(y => yearReturns[y] > 1).length;
    const yearWinRate = years.length > 0 ? (positiveYears / years.length) * 100 : 0;

    // Sharpe
    const monthlyReturns = snaps.map(s => s.monthReturn);
    const meanR = n > 0 ? monthlyReturns.reduce((a, b) => a + b, 0) / n : 0;
    const variance = n > 1
      ? monthlyReturns.reduce((s, r) => s + (r - meanR) ** 2, 0) / (n - 1)
      : 0;
    const annVol = Math.sqrt(Math.max(0, variance)) * Math.sqrt(12);
    const sharpe = annVol > 0 ? (annualReturn / 100 - 0.02) / annVol : 0;

    // Sortino: 只对负收益率计算下行标准差
    const negReturns = monthlyReturns.filter(r => r < 0);
    const downVariance = negReturns.length > 1
      ? negReturns.reduce((s, r) => s + r ** 2, 0) / (negReturns.length - 1)
      : (negReturns.length === 1 ? negReturns[0] ** 2 : 0);
    const annDownVol = Math.sqrt(Math.max(0, downVariance)) * Math.sqrt(12);
    const sortino = annDownVol > 0 ? (annualReturn / 100 - 0.02) / annDownVol : 0;

    // 最大回撤（快照 drawdown 为负数百分比，取最小值；全 0 时为 0）
    const maxDrawdown = snaps.reduce((m, s) => Math.min(m, s.drawdown || 0), 0);

    const operationCount = snaps.reduce((sum, s) => sum + s.opCount, 0);
    const activeMonths = snaps.filter(s => s.opCount > 0).length;

    // 期末仓位（排除现金·货币基金后的权益占比）
    const lastSnap = snaps[n - 1];
    const finalEquity = lastSnap ? lastSnap.totalValue - (lastSnap.holdings[CASH_ASSET] || 0) : 0;
    const finalPosition = (lastSnap && lastSnap.totalValue > 0) ? finalEquity / lastSnap.totalValue : 0;

    return {
      finalValue, totalReturn, annualReturn, maxDrawdown,
      sharpe: Math.max(0, Math.min(sharpe, 10)),
      sortino: Math.max(0, Math.min(sortino, 10)),
      winRate, yearWinRate, annVol,
      totalMonths: n, operationCount, activeMonths, finalPosition
    };
  }

  /**
   * 执行所有起点的滚动回测
   */
  function runAll(opts) {
    const points = getStartPoints();
    const results = [];
    
    for (const point of points) {
      const result = runSingleBacktest(point, opts);
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
    const header = ['月份', '阶段', '资产', '目标比例', '月初市值(元)', '本月收益率', '月末市值(元)', '实际比例', '偏离度', '操作', '操作金额(元)', '手续费(元)', '总市值(元)', '月收益率', '月收益金额(元)', '年度收益率(%)', '年收益金额(元)', '累计月份', '累计收益率(%)', '累计收益金额(元)', '数据状态'];
    const rows = [header];

    // 年度收益率：按日历年聚合，yearStartValue = 上一年末总市值（首年=初始资金）
    const yearStartMap = {};
    let prevSnap = null;
    for (const s of result.monthlySnapshots) {
      const y = s.month.substring(0, 4);
      if (!(y in yearStartMap)) {
        yearStartMap[y] = prevSnap ? prevSnap.totalValue : CONFIG.totalCapital;
      }
      prevSnap = s;
    }

    // 月收益金额：每月「该月末总市值 − 上月末总市值」（首月基准 = 初始本金）
    const monthPrevMap = {};
    let prevMonthValue = null;
    for (const s of result.monthlySnapshots) {
      monthPrevMap[s.month] = (prevMonthValue === null) ? CONFIG.totalCapital : prevMonthValue;
      prevMonthValue = s.totalValue;
    }

    // 累计月序：**入场月即第 1 个月**（与前端「第 N 个月」口径一致，1-based）
    const monthNoMap = {};
    result.monthlySnapshots.forEach((s, i) => { monthNoMap[s.month] = i + 1; });

    for (const snap of result.monthlySnapshots) {
      const yearStartValue = yearStartMap[snap.month.substring(0, 4)] || CONFIG.totalCapital;
      const annAmount = snap.totalValue - yearStartValue;
      const mPrevValue = (snap.month in monthPrevMap) ? monthPrevMap[snap.month] : CONFIG.totalCapital;
      const mAmount = snap.totalValue - mPrevValue;
      // 年度收益率口径与前端一致：年收益金额 ÷ 固定基准本金（区别于 ÷上年末总市值的复合口径）
      const annPct = CONFIG.totalCapital > 0 ? (annAmount / CONFIG.totalCapital) * 100 : 0;
      for (const ad of snap.assetDetails) {
        // monthReturn 可能为对象{value,estimated}或数字；value 为 0 时不能用 || 兜底（会得 NaN）
        const mrObj = ad.monthReturn;
        const mrVal = (mrObj && typeof mrObj === 'object') ? (mrObj.value || 0) : (mrObj || 0);
        rows.push([
          snap.month,
          snap.phase,
          ad.asset,
          (ad.targetPct * 100).toFixed(0) + '%',
          ad.holdingBefore.toFixed(2),
          (mrVal * 100).toFixed(2) + '%',
          ad.holdingAfter.toFixed(2),
          (ad.actualPct * 100).toFixed(2) + '%',
          ((ad.deviationFromTarget || 0) * 100).toFixed(2) + '%',
          ad.action,
          ad.amount > 0 ? ad.amount.toFixed(2) : '-',
          ad.fee > 0 ? ad.fee.toFixed(2) : '-',
          snap.totalValue.toFixed(2),
          // 组合层「月收益率」口径铁律：本月收益金额 ÷ 固定基准本金 50 万（= mAmount / totalCapital），
          // 与弹窗日志表、滚动汇总表、折线图提示环比同源；各段可加（Σ月 = 年，Σ年 = 累计）。
          // ⚠️ 不要改回 snap.monthReturn（÷上月末总市值的复合口径，数值只有约一半）。
          (CONFIG.totalCapital > 0 ? (mAmount / CONFIG.totalCapital) * 100 : 0).toFixed(2) + '%',
          (mAmount >= 0 ? '+' : '') + mAmount.toFixed(2),
          (annPct >= 0 ? '+' : '') + annPct.toFixed(2),
          (annAmount >= 0 ? '+' : '') + annAmount.toFixed(2),
          (monthNoMap[snap.month] ?? 1),
          ((snap.totalValue / CONFIG.totalCapital - 1) * 100 >= 0 ? '+' : '') + ((snap.totalValue / CONFIG.totalCapital - 1) * 100).toFixed(2),
          (snap.totalValue - CONFIG.totalCapital >= 0 ? '+' : '') + (snap.totalValue - CONFIG.totalCapital).toFixed(2),
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
    ASSETS,
    CASH_ASSET,
    getStartPoints,
    runSingleBacktest,
    runAll,
    computeMetrics,
    setLiveOverlay,
    getLiveOverlay,
    clearLiveOverlay,
    fmtMoney,
    fmtPct,
    exportLogCSV,
    exportSummaryCSV
  };
})();
