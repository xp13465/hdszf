/**
 * ECharts 图表管理
 */

const ChartManager = (() => {
  let equityChart = null;
  let ddChart = null;
  let pieChart = null;
  let radarChart = null;
  let compareBarChart = null;

  function init() {
    initEquityChart();
    initDrawdownChart();
    initPieChart();
    initRadarChart();
    initCompareBarChart();
  }

  function initEquityChart() {
    const dom = document.getElementById('chart-equity');
    if (!dom) return;
    equityChart = echarts.init(dom);
  }

  function initDrawdownChart() {
    const dom = document.getElementById('chart-drawdown');
    if (!dom) return;
    ddChart = echarts.init(dom);
  }

  function initPieChart() {
    const dom = document.getElementById('chart-pie');
    if (!dom) return;
    pieChart = echarts.init(dom);
  }

  function initRadarChart() {
    const dom = document.getElementById('chart-radar');
    if (!dom) return;
    radarChart = echarts.init(dom);
  }

  function initCompareBarChart() {
    const dom = document.getElementById('chart-compare-bar');
    if (!dom) return;
    compareBarChart = echarts.init(dom);
  }

  /**
   * 更新收益曲线图
   */
  function updateEquityCurve(currentResult, lockedResult) {
    if (!equityChart) return;

    const curAlloc = currentResult?.alloc || {};
    const curData = BacktestEngine.generateMonthlyReturns(curAlloc);

    const series = [{
      name: '当前配置',
      type: 'line',
      data: curData.equityCurve,
      smooth: true,
      lineStyle: { width: 3, color: '#1a3a5c' },
      itemStyle: { color: '#1a3a5c' },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(26,58,92,0.15)' },
          { offset: 1, color: 'rgba(26,58,92,0.02)' }
        ])
      }
    }];

    if (lockedResult) {
      const lockAlloc = lockedResult?.alloc || {};
      const lockData = BacktestEngine.generateMonthlyReturns(lockAlloc);
      series.push({
        name: '锁定配置',
        type: 'line',
        data: lockData.equityCurve,
        smooth: true,
        lineStyle: { width: 2, type: 'dashed', color: '#c9a84c' },
        itemStyle: { color: '#c9a84c' }
      });
    }

    const monthLabels = curData.monthLabels || [];
    // X轴：起点 + 每月标签，和 equityCurve 长度一致（1 + N个月）
    const xLabels = ['起点'];
    for (let i = 0; i < monthLabels.length; i++) {
      const m = monthLabels[i];
      if (i === 0) {
        xLabels.push(m.slice(0, 7)); // 第一个月显示完整
      } else if (m.endsWith('-01')) {
        xLabels.push(m.slice(0, 4)); // 每年1月显示年份
      } else {
        xLabels.push('');
      }
    }

    equityChart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0];
          const idx = p.axisIndex;
          if (idx === 0) return `起点<br/>${p.seriesName}: ${p.value.toFixed(1)}%`;
          const label = idx <= monthLabels.length ? monthLabels[idx - 1] : '';
          return `${label}<br/>${p.seriesName}: ${p.value.toFixed(1)}%`;
        }
      },
      grid: { left: 50, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: xLabels,
        name: '时间',
        nameLocation: 'middle',
        nameGap: 25,
        axisLabel: {
          interval: 0,
          rotate: 0,
          fontSize: 10,
          formatter: (v) => v || ''
        }
      },
      yAxis: {
        type: 'value',
        name: '累计收益 (%)',
        axisLabel: { formatter: '{value}%' }
      },
      series
    }, true);
  }

  /**
   * 更新回撤曲线图
   */
  function updateDrawdownCurve(currentResult, lockedResult) {
    if (!ddChart) return;

    const curAlloc = currentResult?.alloc || {};
    const curData = BacktestEngine.generateMonthlyReturns(curAlloc);

    const series = [{
      name: '当前配置回撤',
      type: 'line',
      data: curData.drawdownCurve,
      smooth: true,
      lineStyle: { width: 2, color: '#c62828' },
      itemStyle: { color: '#c62828' },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: 'rgba(198,40,40,0.25)' },
          { offset: 1, color: 'rgba(198,40,40,0.02)' }
        ])
      }
    }];

    if (lockedResult) {
      const lockAlloc = lockedResult?.alloc || {};
      const lockData = BacktestEngine.generateMonthlyReturns(lockAlloc);
      series.push({
        name: '锁定配置回撤',
        type: 'line',
        data: lockData.drawdownCurve,
        smooth: true,
        lineStyle: { width: 2, type: 'dashed', color: '#f57c00' },
        itemStyle: { color: '#f57c00' }
      });
    }

    const ddMonthLabels = curData.monthLabels || [];
    const ddXLabels = ['起点'];
    for (let i = 0; i < ddMonthLabels.length; i++) {
      const m = ddMonthLabels[i];
      if (i === 0) {
        ddXLabels.push(m.slice(0, 7));
      } else if (m.endsWith('-01')) {
        ddXLabels.push(m.slice(0, 4));
      } else {
        ddXLabels.push('');
      }
    }

    ddChart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const p = params[0];
          const idx = p.axisIndex;
          if (idx === 0) return `起点<br/>${p.seriesName}: ${p.value.toFixed(2)}%`;
          const label = idx <= ddMonthLabels.length ? ddMonthLabels[idx - 1] : '';
          return `${label}<br/>${p.seriesName}: ${p.value.toFixed(2)}%`;
        }
      },
      grid: { left: 50, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: 'category',
        data: ddXLabels,
        name: '时间',
        nameLocation: 'middle',
        nameGap: 25,
        axisLabel: {
          interval: 0,
          rotate: 0,
          fontSize: 10,
          formatter: (v) => v || ''
        }
      },
      yAxis: {
        type: 'value',
        name: '回撤 (%)',
        axisLabel: { formatter: '{value}%' },
        max: 0
      },
      series
    }, true);
  }

  /**
   * 更新配置饼图（板块6）
   */
  function updatePieChart(alloc) {
    if (!pieChart) return;

    const colors = {
      '沪深300': '#3b82f6',
      '中证500': '#60a5fa',
      '标普500': '#06b6d4',
      '纳斯达克100': '#22d3ee',
      '黄金': '#c9a84c',
      '现金·货币基金': '#94a3b8'
    };

    const data = Object.entries(alloc || APP_DATA.finalConfig.allocations).map(([name, value]) => ({
      name,
      value: Math.round(value * 100),
      itemStyle: { color: colors[name] || '#ccc' }
    }));

    pieChart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {d}% (¥{c}万)',
        valueFormatter: (v) => (v / 100 * 50).toFixed(1)
      },
      series: [{
        type: 'pie',
        radius: ['45%', '75%'],
        center: ['50%', '50%'],
        itemStyle: {
          borderRadius: 6,
          borderColor: '#fff',
          borderWidth: 3
        },
        label: {
          formatter: '{b}\n{d}%',
          fontSize: 12,
          lineHeight: 18
        },
        emphasis: {
          label: { fontSize: 16, fontWeight: 'bold' },
          scaleSize: 10
        },
        data
      }]
    }, true);
  }

  /**
   * 更新雷达图（板块5对比）
   */
  function updateRadarChart() {
    if (!radarChart) return;

    const comp = APP_DATA.comparisons?.['三档方案对比'];
    if (!comp) return;
    const cons = comp.conservative;
    const bal = comp.balanced;
    const agg = comp.aggressive;

    const maxAnnual = Math.max(cons.annual || 0, bal.annual || 0, agg.annual || 0);
    const maxSharpe = Math.max(cons.sharpe || 0, bal.sharpe || 0, agg.sharpe || 0);
    const maxWinRate = Math.max(cons.win_rate || 0, bal.win_rate || 0, agg.win_rate || 0) / 100;

    // 抗回撤 = 用回撤越小越好的逻辑，maxDd 取最大回撤作为上限
    const absDdCons = Math.abs(cons.dd || 0);
    const absDdBal = Math.abs(bal.dd || 0);
    const absDdAgg = Math.abs(agg.dd || 0);
    const maxDd = Math.max(absDdCons, absDdBal, absDdAgg);

    // 抗回撤能力 = maxDd - 实际回撤（越大越好）
    const resilience = (dd) => parseFloat((maxDd - Math.abs(dd)).toFixed(1));

    radarChart.setOption({
      radar: {
        center: ['50%', '55%'],
        radius: '65%',
        indicator: [
          { name: '年化收益(%)', max: Math.ceil(maxAnnual) },
          { name: 'Sharpe比率', max: Math.ceil(maxSharpe * 10) / 10 },
          { name: '月胜率(%)', max: Math.ceil(maxWinRate * 100) },
          { name: '抗回撤能力', max: Math.ceil(maxDd) },
          { name: '月波动率(%)', max: Math.ceil(Math.max(cons.monthly_vol || 0, bal.monthly_vol || 0, agg.monthly_vol || 0)) }
        ]
      },
      series: [{
        type: 'radar',
        data: [
          {
            name: '保守型',
            value: [
              parseFloat(cons.annual?.toFixed(1)) || 0,
              parseFloat(cons.sharpe?.toFixed(2)) || 0,
              parseFloat((cons.win_rate).toFixed(1)) || 0,
              resilience(cons.dd),
              parseFloat((cons.monthly_vol || 0).toFixed(1))
            ],
            lineStyle: { color: '#3B82F6', width: 2 },
            areaStyle: { color: 'rgba(59,130,246,0.1)' },
            itemStyle: { color: '#3B82F6' }
          },
          {
            name: '稳健型 ★',
            value: [
              parseFloat(bal.annual?.toFixed(1)) || 0,
              parseFloat(bal.sharpe?.toFixed(2)) || 0,
              parseFloat((bal.win_rate).toFixed(1)) || 0,
              resilience(bal.dd),
              parseFloat((bal.monthly_vol || 0).toFixed(1))
            ],
            lineStyle: { color: '#10B981', width: 2 },
            areaStyle: { color: 'rgba(16,185,129,0.15)' },
            itemStyle: { color: '#10B981' }
          },
          {
            name: '进取型',
            value: [
              parseFloat(agg.annual?.toFixed(1)) || 0,
              parseFloat(agg.sharpe?.toFixed(2)) || 0,
              parseFloat((agg.win_rate).toFixed(1)) || 0,
              resilience(agg.dd),
              parseFloat((agg.monthly_vol || 0).toFixed(1))
            ],
            lineStyle: { color: '#EF4444', width: 2 },
            areaStyle: { color: 'rgba(239,68,68,0.08)' },
            itemStyle: { color: '#EF4444' }
          }
        ]
      }]
    }, true);
  }

  /**
   * 更新对比柱状图
   */
  function updateCompareBarChart() {
    if (!compareBarChart) return;

    const comp = APP_DATA.comparisons?.['三档方案对比'];
    if (!comp) return;
    const cons = comp.conservative;
    const bal = comp.balanced;
    const agg = comp.aggressive;

    compareBarChart.setOption({
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['保守型', '稳健型 ★', '进取型'],
        bottom: 0
      },
      grid: { left: 40, right: 20, top: 20, bottom: 50 },
      xAxis: {
        type: 'category',
        data: ['年化收益(%)', '最大回撤(%)', 'Sharpe', '赚钱月占比(%)']
      },
      yAxis: { type: 'value', min: 0 },
      series: [
        {
          name: '保守型',
          type: 'bar',
          data: [
            parseFloat(cons.annual.toFixed(1)),
            parseFloat(Math.abs(cons.dd).toFixed(1)),
            parseFloat(cons.sharpe.toFixed(2)),
            parseFloat(cons.win_rate.toFixed(1))
          ],
          itemStyle: { color: '#3B82F6', borderRadius: [4, 4, 0, 0] }
        },
        {
          name: '稳健型 ★',
          type: 'bar',
          data: [
            parseFloat(bal.annual.toFixed(1)),
            parseFloat(Math.abs(bal.dd).toFixed(1)),
            parseFloat(bal.sharpe.toFixed(2)),
            parseFloat(bal.win_rate.toFixed(1))
          ],
          itemStyle: { color: '#10B981', borderRadius: [4, 4, 0, 0] }
        },
        {
          name: '进取型',
          type: 'bar',
          data: [
            parseFloat(agg.annual.toFixed(1)),
            parseFloat(Math.abs(agg.dd).toFixed(1)),
            parseFloat(agg.sharpe.toFixed(2)),
            parseFloat(agg.win_rate.toFixed(1))
          ],
          itemStyle: { color: '#EF4444', borderRadius: [4, 4, 0, 0] }
        }
      ]
    }, true);
  }

  /**
   * 响应式处理
   */
  function resize() {
    equityChart?.resize();
    ddChart?.resize();
    pieChart?.resize();
    radarChart?.resize();
    compareBarChart?.resize();
  }

  return {
    init,
    updateEquityCurve,
    updateDrawdownCurve,
    updatePieChart,
    updateRadarChart,
    updateCompareBarChart,
    resize
  };
})();
