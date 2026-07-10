/**
 * 主入口
 * 初始化所有板块、绑定事件
 */

(function () {
  'use strict';

  // --- 导航栏滚动效果 ---
  function initNav() {
    const nav = document.querySelector('.nav');
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    // 滚动阴影
    window.addEventListener('scroll', () => {
      if (window.scrollY > 10) {
        nav?.classList.add('scrolled');
      } else {
        nav?.classList.remove('scrolled');
      }
    });

    // 移动端菜单
    navToggle?.addEventListener('click', () => {
      navLinks?.classList.toggle('open');
    });

    // 点击链接关闭菜单
    navLinks?.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
      });
    });
  }

  // --- 滚动渐入动画 ---
  function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
  }

  // --- 更新指标卡片 ---
  function updateMetrics(currentResult, lockedResult) {
    if (!currentResult) return;

    const m = currentResult.metrics;

    // 更新5个指标卡片
    const setMetric = (id, value, fmt, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = typeof fmt === 'function' ? fmt(value) : value;
      el.className = 'metric-value ' + (cls || '');
    };

    setMetric('metric-annual', m.annual, v => v.toFixed(2) + '%', m.annual >= 0 ? 'positive' : 'negative');
    setMetric('metric-dd', m.maxDd, v => v.toFixed(2) + '%', 'negative');
    setMetric('metric-sharpe', m.sharpe, v => v.toFixed(4), 'neutral');
    setMetric('metric-sortino', m.sortino, v => v.toFixed(4), 'neutral');
    setMetric('metric-total', m.total, v => v.toFixed(1) + '%', m.total >= 0 ? 'positive' : 'negative');

    // 更新匹配指示器
    const matchEl = document.getElementById('match-indicator');
    if (matchEl && currentResult.match) {
      matchEl.textContent = currentResult.match.label;
      matchEl.className = 'match-indicator ' + currentResult.match.level;
    }

    // 更新对比差异（如果有锁定配置）
    if (lockedResult) {
      const diffAnnual = document.getElementById('diff-annual');
      const diffDd = document.getElementById('diff-dd');
      const diffSharpe = document.getElementById('diff-sharpe');

      if (diffAnnual) {
        const d = m.annual - lockedResult.metrics.annual;
        diffAnnual.textContent = (d >= 0 ? '+' : '') + d.toFixed(2) + '%';
        diffAnnual.className = 'metric-diff ' + (d >= 0 ? 'better' : 'worse');
      }
      if (diffDd) {
        const d = m.maxDd - lockedResult.metrics.maxDd;
        diffDd.textContent = (d >= 0 ? '+' : '') + d.toFixed(2) + '%';
        diffDd.className = 'metric-diff ' + (d <= 0 ? 'better' : 'worse');
      }
      if (diffSharpe) {
        const d = m.sharpe - lockedResult.metrics.sharpe;
        diffSharpe.textContent = (d >= 0 ? '+' : '') + d.toFixed(4);
        diffSharpe.className = 'metric-diff ' + (d >= 0 ? 'better' : 'worse');
      }
    } else {
      // 清除差异
      ['diff-annual', 'diff-dd', 'diff-sharpe'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
      });
    }
  }

  // --- 回测回调 ---
  function onBacktestChange(currentValues, lockedValues) {
    const currentResult = BacktestEngine.compute(currentValues);
    let lockedResult = null;
    if (lockedValues) {
      lockedResult = BacktestEngine.compute(lockedValues);
    }

    updateMetrics(currentResult, lockedResult);
    ChartManager.updateEquityCurve(currentResult, lockedResult);
    ChartManager.updateDrawdownCurve(currentResult, lockedResult);
  }

  // --- 基金表格填充 ---
  function initFundTable() {
    const tbody = document.getElementById('fund-table-body');
    if (!tbody) return;

    const assetTypeMap = {
      'A股': 'a-stock',
      '美股': 'us-stock',
      '黄金': 'gold',
      '现金': 'cash',
      '债券': 'bond'
    };

    const assetClassMap = {
      '510300': 'A股', '160706': 'A股', '512500': 'A股', '160119': 'A股',
      '513650': '美股', '513500': '美股', '096001': '美股', '159659': '美股', '513100': '美股', '270042': '美股',
      '518660': '黄金', '518880': '黄金', '320013': '黄金',
      '510880': 'A股', '511010': '债券'
    };

    const assetNameMap = {
      '510300': '华泰柏瑞沪深300ETF', '160706': '嘉实沪深300ETF联接', '512500': '华夏中证500ETF', '160119': '南方中证500ETF联接',
      '513650': '南方标普500ETF', '513500': '博时标普500ETF', '096001': '大成标普500等权重', '159659': '招商纳斯达克100ETF', '513100': '国泰纳斯达克100ETF', '270042': '广发纳斯达克100ETF',
      '518660': '工银黄金ETF', '518880': '华安黄金ETF',
      '320013': '诺安全球黄金',
      '510880': '华泰柏瑞红利ETF', '511010': '国泰5年国债ETF'
    };

    // 回测用途说明
    const usageMap = {
      '510300': '沪深300指数合成', '160706': '沪深300指数合成',
      '512500': '中证500指数合成', '160119': '中证500指数合成',
      '513650': '标普500指数合成', '513500': '标普500指数合成', '096001': '标普500指数合成',
      '159659': '纳斯达克100指数合成', '513100': '纳斯达克100指数合成', '270042': '纳斯达克100指数合成',
      '518660': '黄金指数合成', '518880': '黄金指数合成', '320013': '黄金指数合成',
      '510880': '备选评估（未纳入）', '511010': '备选评估（未纳入）'
    };

    const funds = APP_DATA.funds || [];
    // 回测实际截止日期
    const actualEndDate = '2026-07';

    funds.forEach(fund => {
      const code = fund.code || fund.fund_code || '';
      const assetType = assetClassMap[code] || '其他';
      const tagClass = assetTypeMap[assetType] || 'cash';
      const name = assetNameMap[code] || fund.name || code;
      const usage = usageMap[code] || '—';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code style="font-size:0.8125rem;color:var(--color-primary);">${code}</code></td>
        <td>${name}</td>
        <td><span class="asset-tag ${tagClass}">${assetType}</span></td>
        <td>${fund.date_start || fund.start || '-'}</td>
        <td>${actualEndDate}</td>
        <td>${fund.record_count || fund.records || fund.count || '-'}</td>
        <td style="font-size:0.8rem;color:var(--color-text-secondary);">${usage}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // --- 方案对比卡片填充 ---
  function initComparisonCards() {
    const comp = APP_DATA.comparisons?.['三档方案对比'];
    if (!comp) return;

    // 保守型
    setCompareCard('conservative', {
      name: '保守型',
      annual: comp.conservative.annual,
      dd: comp.conservative.dd,
      sharpe: comp.conservative.sharpe,
      sortino: comp.conservative.sortino,
      total: comp.conservative.total_return,
      alloc: comp.conservative.alloc
    });

    // 稳健型 ★推荐
    setCompareCard('balanced', {
      name: '稳健型',
      annual: comp.balanced.annual,
      dd: comp.balanced.dd,
      sharpe: comp.balanced.sharpe,
      sortino: comp.balanced.sortino,
      total: comp.balanced.total_return,
      alloc: comp.balanced.alloc,
      featured: true
    });

    // 进取型
    setCompareCard('aggressive', {
      name: '进取型',
      annual: comp.aggressive.annual,
      dd: comp.aggressive.dd,
      sharpe: comp.aggressive.sharpe,
      sortino: comp.aggressive.sortino,
      total: comp.aggressive.total_return,
      alloc: comp.aggressive.alloc
    });
  }

  function setCompareCard(id, data) {
    const card = document.getElementById(`compare-${id}`);
    if (!card) return;

    if (data.featured) card.classList.add('featured');

    const annualEl = card.querySelector('.compare-annual');
    if (annualEl) {
      annualEl.textContent = data.annual?.toFixed(2) + '%';
      annualEl.style.color = data.annual >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    }

    const metricsEl = card.querySelector('.compare-metrics');
    if (metricsEl) {
      metricsEl.innerHTML = `
        <div class="compare-metric-row"><span class="label">最大回撤</span><span class="value" style="color:var(--color-danger)">${data.dd?.toFixed(2)}%</span></div>
        <div class="compare-metric-row"><span class="label">Sharpe比率</span><span class="value">${data.sharpe?.toFixed(4)}</span></div>
        <div class="compare-metric-row"><span class="label">Sortino比率</span><span class="value">${data.sortino?.toFixed(4)}</span></div>
        <div class="compare-metric-row"><span class="label">总收益</span><span class="value" style="color:var(--color-success)">${data.total?.toFixed(1)}%</span></div>
      `;
    }

    // 分配柱状条
    const barsEl = card.querySelector('.alloc-bars');
    if (barsEl && data.alloc) {
      const assets = ['沪深300', '中证500', '标普500', '纳斯达克100', '黄金', '现金·货币基金'];
      const colors = ['hs300', 'zz500', 'sp500', 'nasdaq', 'gold', 'cash'];
      barsEl.innerHTML = assets.map((name, i) => `
        <div class="alloc-bar-row">
          <span class="alloc-bar-label">${name}</span>
          <div class="alloc-bar-track">
            <div class="alloc-bar-fill ${colors[i]}" style="width:${(data.alloc[name] || 0) * 100}%"></div>
          </div>
          <span class="alloc-bar-pct">${((data.alloc[name] || 0) * 100).toFixed(0)}%</span>
        </div>
      `).join('');
    }
  }

  function setMiniCompare(id, data) {
    const el = document.getElementById(id);
    if (!el || !data) return;

    const annual = data.annual || data.lt_annual || 0;
    const dd = data.dd || data.lt_dd || 0;
    const sharpe = data.sharpe || data.lt_sharpe || 0;

    el.innerHTML = `
      <div class="val" style="color:${annual >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${annual.toFixed(2)}%</div>
      <div class="lbl">年化收益</div>
      <div class="val" style="color:var(--color-danger);font-size:1rem;margin-top:4px">${dd.toFixed(2)}%</div>
      <div class="lbl">最大回撤</div>
      <div class="val" style="font-size:1rem;margin-top:4px">${sharpe.toFixed(4)}</div>
      <div class="lbl">Sharpe</div>
    `;
  }

  // --- 初始化 ---
  function init() {
    initNav();
    initScrollAnimations();
    initFundTable();
    initComparisonCards();

    // 移动端滑块面板折叠
    initSliderCollapse();

    // 初始化图表
    ChartManager.init();
    ChartManager.updatePieChart(APP_DATA.finalConfig.allocations);
    ChartManager.updateRadarChart();
    ChartManager.updateCompareBarChart();

    // 初始化滑块
    SliderPanel.init(onBacktestChange);

    // 初始回测
    const defaultResult = BacktestEngine.getDefaultResult();
    updateMetrics(defaultResult, null);
    ChartManager.updateEquityCurve(defaultResult, null);
    ChartManager.updateDrawdownCurve(defaultResult, null);

    // 响应式
    window.addEventListener('resize', () => {
      ChartManager.resize();
    });

    // CTA 按钮滚动到回测板块
    document.getElementById('btn-explore')?.addEventListener('click', () => {
      document.getElementById('backtest')?.scrollIntoView({ behavior: 'smooth' });
    });

    // 主题切换
    initThemeSwitcher();

    // 滚动回测
    initRollingBacktest();

    // 分享图生成按钮
    if (typeof ShareImage !== 'undefined') {
      ShareImage.init();
    }
  }

  // --- 移动端滑块折叠 ---
  function initSliderCollapse() {
    const toggle = document.getElementById('slider-toggle');
    const panel = document.getElementById('slider-panel');
    if (!toggle || !panel) return;

    // 仅移动端可折叠
    const isMobile = () => window.innerWidth <= 640;

    toggle.addEventListener('click', () => {
      if (!isMobile()) return;
      panel.classList.toggle('expanded');
    });

    // 桌面端始终展开
    const handleResize = () => {
      if (!isMobile()) {
        panel.classList.add('expanded');
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
  }

  // --- 主题切换 ---
  function initThemeSwitcher() {
    const styleLink = document.getElementById('theme-style');
    const buttons = document.querySelectorAll('.theme-btn');
    const toggleBtn = document.getElementById('theme-toggle-btn');
    const optionsPanel = document.getElementById('theme-options');

    const themeMap = {
      business: 'css/style.css?v=14',
      modern: 'css/modern.css?v=14',
      tech: 'css/tech.css?v=14'
    };

    // 优先级：URL 参数 > localStorage > 默认值
    const urlParams = new URLSearchParams(window.location.search);
    const urlTheme = urlParams.get('theme');
    const validThemes = Object.keys(themeMap);
    const initialTheme = (urlTheme && validThemes.includes(urlTheme))
      ? urlTheme
      : (localStorage.getItem('investment-advisor-theme') || 'business');

    setTheme(initialTheme, false);

    // Toggle 按钮：点击展开/收起主题选项
    if (toggleBtn && optionsPanel) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        optionsPanel.classList.toggle('open');
      });
      // 点击其他地方关闭
      document.addEventListener('click', () => {
        optionsPanel.classList.remove('open');
      });
      optionsPanel.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        setTheme(theme, true);
        localStorage.setItem('investment-advisor-theme', theme);
        if (optionsPanel) optionsPanel.classList.remove('open');
        // 更新 toggle 按钮图标为当前主题
        if (toggleBtn) toggleBtn.textContent = btn.textContent;
      });
    });

    function setTheme(theme, updateUrl) {
      if (!styleLink || !themeMap[theme]) return;
      styleLink.href = themeMap[theme];

      // 更新 URL 参数（不刷新页面）
      if (updateUrl !== false) {
        const url = new URL(window.location);
        url.searchParams.set('theme', theme);
        window.history.replaceState({}, '', url);
      }

      // 短暂延迟后重建 ECharts（等 CSS 变量生效）
      setTimeout(() => {
        if (typeof echarts !== 'undefined') {
          const chartIds = ['chart-equity', 'chart-drawdown', 'chart-pie', 'chart-radar', 'chart-bar-annual', 'chart-bar-dd', 'chart-bar-sharpe', 'chart-bar-winrate'];
          chartIds.forEach(id => {
            const dom = document.getElementById(id);
            if (dom) {
              const instance = echarts.getInstanceByDom(dom);
              if (instance) instance.dispose();
            }
          });

          ChartManager.init();
          ChartManager.updatePieChart(APP_DATA.finalConfig.allocations);
          ChartManager.updateRadarChart();
          ChartManager.updateCompareBarChart();

          const currentResult = BacktestEngine.getDefaultResult();
          ChartManager.updateEquityCurve(currentResult, null);
          ChartManager.updateDrawdownCurve(currentResult, null);
        }
      }, 100);

      // 更新按钮状态
      buttons.forEach(b => {
        b.classList.toggle('active', b.dataset.theme === theme);
      });
    }
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================================
  //  滚动回测模块
  // ============================================================

  let rollingResults = null;
  let rollingCharts = {};

  function initRollingBacktest() {
    // 异步运行回测（避免阻塞UI）
    setTimeout(() => {
      try {
        rollingResults = RollingBacktest.runAll();
        renderRollingSummary(rollingResults);
        renderRollingEquityChart(rollingResults);
        initLogModal();
      } catch (e) {
        console.error('滚动回测运行失败:', e);
        const tbody = document.getElementById('rolling-summary-body');
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--color-danger);">❌ 回测运行失败: ${e.message}</td></tr>`;
        }
      }
    }, 200);
  }

  function renderRollingSummary(results) {
    const tbody = document.getElementById('rolling-summary-body');
    if (!tbody || !results || results.length === 0) return;

    // 找最佳值用于高亮
    const bestAnnual = Math.max(...results.map(r => r.annualReturn));
    const bestSharpe = Math.max(...results.map(r => r.sharpe));
    const bestDD = Math.max(...results.map(r => r.maxDrawdown)); // 最大回撤（最不负面）

    tbody.innerHTML = results.map((r, i) => {
      const isEstimated = r.hasEstimatedData;
      const startLabel = r.startPoint.label;
      const yearsAgo = r.startPoint.yearsAgo;
      const buildMonths = r.startPoint.buildMonths || 12;
      
      // 高亮最佳值
      const annualClass = r.annualReturn === bestAnnual ? 'cell-positive' : (r.annualReturn >= 0 ? 'cell-positive' : 'cell-negative');
      const sharpeClass = r.sharpe === bestSharpe ? 'cell-positive' : '';
      const ddClass = r.maxDrawdown === bestDD ? 'cell-negative' : 'cell-negative';
      
      // 构建周期字符串 + 建仓方式
      const endLabel = `${RollingBacktest.CONFIG.endYear}年${RollingBacktest.CONFIG.endMonth}月`;
      const periodStr = `${startLabel} → ${endLabel}`;
      const buildStr = buildMonths === 1
        ? `${r.totalMonths}个月 · <span style="display:inline-block;background:#c53030;color:#fff;font-size:0.7rem;padding:2px 7px;border-radius:4px;font-weight:600;">⚡一次建仓</span>`
        : (r.startPoint.isComparison
          ? `${r.totalMonths}个月 · <span style="display:inline-block;background:#e8890c;color:#fff;font-size:0.7rem;padding:2px 7px;border-radius:4px;font-weight:600;">🔶分批建仓(${buildMonths}次)</span>`
          : `${r.totalMonths}个月 · <span style="display:inline-block;background:#5a9fd4;color:#fff;font-size:0.7rem;padding:2px 7px;border-radius:4px;">📅分批建仓(${buildMonths}次)</span>`);
      
      return `
        <tr>
          <td class="cell-start">${startLabel}<br><small style="color:var(--color-text-muted)">${yearsAgo != null ? yearsAgo + '年前入场' : '数据最早月 · 完整回测'}</small></td>
          <td>${periodStr}<br><small style="color:var(--color-text-muted)">${buildStr}</small></td>
          <td class="${r.finalValue >= 500000 ? 'cell-positive' : 'cell-negative'}">¥${RollingBacktest.fmtMoney(r.finalValue)}</td>
          <td class="${r.totalReturn >= 0 ? 'cell-positive' : 'cell-negative'}">${RollingBacktest.fmtPct(r.totalReturn)}</td>
          <td class="${annualClass}">${r.annualReturn.toFixed(2)}%</td>
          <td class="${ddClass}">${r.maxDrawdown.toFixed(2)}%</td>
          <td class="${sharpeClass}">${r.sharpe.toFixed(4)}</td>
          <td>${r.winRate.toFixed(1)}%<br><small style="color:var(--color-text-muted);font-size:0.7rem;">年${r.yearWinRate.toFixed(0)}%</small></td>
          <td>${r.operationCount}次<br><small style="color:var(--color-text-muted);font-size:0.7rem;">${r.activeMonths}个月有交易</small></td>
          <td><span style="font-weight:600;">${(r.finalPosition * 100).toFixed(0)}%</span><br><small style="color:var(--color-text-muted);font-size:0.7rem;">期末仓位</small></td>
          <td class="${isEstimated ? 'cell-estimated' : 'cell-all-real'}">${isEstimated ? '⚠️含估计值' : '✓ 真实数据<br><small style="color:var(--color-text-muted);font-size:0.65rem;">真实模拟</small>'}</td>
          <td><button class="btn-detail" onclick="window.showRollingLog(${i})">📋 查看操作记录</button></td>
        </tr>
      `;
    }).join('');
  }

  function renderRollingEquityChart(results) {
    const dom = document.getElementById('chart-rolling-equity');
    if (!dom || !results || results.length === 0) return;

    if (rollingCharts.equity) {
      rollingCharts.equity.dispose();
    }

    const chart = echarts.init(dom);
    rollingCharts.equity = chart;

    // 调色板：一次建仓=红色系，分批建仓=蓝绿渐深
    const series = results.map((r, i) => {
      const snapshots = r.monthlySnapshots;
      const data = [];
      for (let j = 0; j < snapshots.length; j++) {
        data.push([j, (snapshots[j].totalValue / RollingBacktest.CONFIG.totalCapital - 1) * 100]);
      }

      const isEarliest = r.startPoint.isEarliest;
      const isComparison = r.startPoint.isComparison;
      const depth = (isEarliest || isComparison) ? 0 : (r.startPoint.yearsAgo / 10);

      return {
        name: r.startPoint.label + (r.hasEstimatedData ? ' ⚠️' : '') + (isComparison ? ' 分批' : (isEarliest ? ' 一次' : '')),
        type: 'line',
        data: data,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          width: isEarliest ? 3 : (isComparison ? 2 : 1.5),
          color: isEarliest
            ? '#c53030'
            : (isComparison ? '#e8890c' : `hsl(${200 + depth * 30}, ${60 - depth * 20}%, ${45 + depth * 20}%)`),
          type: isComparison ? 'dashed' : 'solid'
        },
        emphasis: { focus: 'series' },
        // 终点打点
        markPoint: isEarliest ? {
          data: [{
            name: '终点',
            coord: [data.length - 1, data[data.length - 1][1]],
            symbol: 'pin',
            symbolSize: 38,
            itemStyle: { color: '#c53030' },
            label: {
              show: true,
              formatter: function() { return `+${data[data.length - 1][1].toFixed(0)}%`; },
              fontSize: 10,
              fontWeight: 'bold',
              color: '#fff'
            }
          }],
          animation: false
        } : undefined
      };
    });

    // 找出最近和最早起点的数据，用于标注
    const latestResult = results[results.length - 1]; // 2025-07
    const earliestResult = results[0]; // 2015-08

    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: '#e8e8ed',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { fontSize: 12, color: '#333' },
        formatter: function(params) {
          const monthIdx = params[0].axisValue;
          // 推算年份月份
          const baseYear = results[0].startPoint.year;
          const baseMonth = results[0].startPoint.month;
          const totalM = baseMonth - 1 + monthIdx;
          const y = baseYear + Math.floor(totalM / 12);
          const m = (totalM % 12) + 1;
          let html = `<strong>${y}年${m}月 · 第${monthIdx + 1}个月</strong><br/>`;
          params.sort((a, b) => b.value[1] - a.value[1]);
          for (const p of params) {
            html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px;"></span>`;
            html += `${p.seriesName}: <strong>${p.value[1] >= 0 ? '+' : ''}${p.value[1].toFixed(1)}%</strong><br/>`;
          }
          return html;
        }
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        itemWidth: 14,
        itemHeight: 3,
        textStyle: { fontSize: 10, color: '#666' },
        pageTextStyle: { color: '#999' },
        pageIconSize: 10
      },
      grid: { left: 55, right: 35, top: 25, bottom: 45 },
      xAxis: {
        type: 'value',
        name: '回测月数',
        nameTextStyle: { fontSize: 11, color: '#aaa' },
        axisLabel: {
          fontSize: 10, color: '#999',
          formatter: function(v) {
            // 每隔12个月标年份
            if (v % 12 === 0 || v === 131) {
              const baseYear = results[0].startPoint.year;
              const baseMonth = results[0].startPoint.month;
              const totalM = baseMonth - 1 + v;
              const y = baseYear + Math.floor(totalM / 12);
              return y + '年';
            }
            return '';
          }
        },
        min: 0,
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } }
      },
      yAxis: {
        type: 'value',
        name: '累计收益率',
        nameTextStyle: { fontSize: 11, color: '#aaa' },
        axisLabel: { fontSize: 10, color: '#999', formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
        // 0% 基准线加粗
        min: function(v) { return Math.min(v.min, -15); }
      },
      // 0% 水平参考线
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#ccc', type: 'solid', width: 1 },
        data: [{ yAxis: 0 }],
        label: { show: false }
      },
      series: series
    };

    // 手动添加 markLine（ECharts 的 markLine 不能在 option 根级）
    option.series[0].markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: '#d0d0d0', type: 'solid', width: 1.5 },
      data: [{ yAxis: 0, label: { show: true, formatter: '0%', position: 'start', fontSize: 10, color: '#999' } }]
    };

    chart.setOption(option);

    // 响应式
    window.addEventListener('resize', () => {
      if (rollingCharts.equity) rollingCharts.equity.resize();
    });
  }

  function initLogModal() {
    const modal = document.getElementById('log-modal');
    const closeBtn = document.getElementById('log-modal-close');
    const closeBtn2 = document.getElementById('btn-log-modal-close');
    const exportLogBtn = document.getElementById('btn-export-log-csv');
    const exportSummaryBtn = document.getElementById('btn-export-summary-csv');

    // 暴露到全局
    window.showRollingLog = function(index) {
      if (!rollingResults || index >= rollingResults.length) return;
      const result = rollingResults[index];
      showLogDetail(result, index);
    };

    function closeModal() {
      modal.style.display = 'none';
    }

    closeBtn?.addEventListener('click', closeModal);
    closeBtn2?.addEventListener('click', closeModal);
    modal?.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });

    // 导出CSV — 授权拦截逻辑统一在 initAuthGate() 中实现

    // ESC关闭
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        closeModal();
      }
    });
  }

  function showLogDetail(result, index) {
    const modal = document.getElementById('log-modal');
    const title = document.getElementById('log-modal-title');
    const body = document.getElementById('log-modal-body');

    if (!modal || !title || !body) return;

    modal.dataset.logIndex = index;
    const yearsLabel = result.startPoint.yearsAgo != null ? ` · ${result.startPoint.yearsAgo}年前` : ' · 数据最早月（完整回测）';
    const buildTag = result.startPoint.buildLabel ? ` · ${result.startPoint.buildLabel}` : '';
    title.textContent = `📋 完整持仓日志 — ${result.startPoint.label}入场${yearsLabel}${buildTag}`;

    // 汇总信息
    const summaryHTML = `
      <div class="log-summary">
        <div class="log-summary-item">
          <div class="label">起点</div>
          <div class="value accent">${result.startPoint.label}</div>
        </div>
        <div class="log-summary-item">
          <div class="label">回测月数</div>
          <div class="value">${result.totalMonths}个月</div>
        </div>
        <div class="log-summary-item">
          <div class="label">最终市值</div>
          <div class="value ${result.finalValue >= 500000 ? 'green' : 'red'}">¥${RollingBacktest.fmtMoney(result.finalValue)}</div>
        </div>
        <div class="log-summary-item">
          <div class="label">总收益率</div>
          <div class="value ${result.totalReturn >= 0 ? 'green' : 'red'}">${RollingBacktest.fmtPct(result.totalReturn)}</div>
        </div>
        <div class="log-summary-item">
          <div class="label">年化收益</div>
          <div class="value ${result.annualReturn >= 0 ? 'green' : 'red'}">${result.annualReturn.toFixed(2)}%</div>
        </div>
        <div class="log-summary-item">
          <div class="label">最大回撤</div>
          <div class="value red">${result.maxDrawdown.toFixed(2)}%</div>
        </div>
        <div class="log-summary-item">
          <div class="label">总操作次数</div>
          <div class="value accent">${result.operationCount}次</div>
        </div>
        <div class="log-summary-item">
          <div class="label">数据质量</div>
          <div class="value ${result.hasEstimatedData ? 'red' : 'green'}">${result.hasEstimatedData ? '⚠️含估计值' : '✓全部真实'}</div>
        </div>
      </div>
    `;

    // 每月完整持仓表格：每月一行，展开显示6个资产
    const ASSETS = ['沪深300', '中证500', '标普500', '纳斯达克100', '黄金', '现金·货币基金'];
    const ASSET_COLORS = {
      '沪深300': '#3b82f6', '中证500': '#60a5fa',
      '标普500': '#06b6d4', '纳斯达克100': '#22d3ee',
      '黄金': '#c9a84c', '现金·货币基金': '#94a3b8'
    };
    const TARGET_PCTS = RollingBacktest.CONFIG.allocations;

    let tableHTML = '<div class="log-table-wrap"><table class="log-table"><thead><tr>';
    tableHTML += '<th style="cursor:pointer;" id="log-sort-btn" title="点击切换正序/倒序">月份 <span id="log-sort-icon">↓</span></th><th>阶段</th><th>资产</th><th>目标市值</th><th>月初市值</th><th>月收益率</th><th>月末市值</th><th>占总额%</th><th>偏离目标</th><th>操作</th><th>金额</th><th>总市值</th><th>月收益</th><th>累计收益</th><th>仓位</th>';
    tableHTML += '</tr></thead><tbody>';

    // 读取排序偏好（默认正序 = 最旧在上）
    const sortDesc = (sessionStorage.getItem('log_sort_desc') === '1');
    const snapshots = sortDesc ? [...result.monthlySnapshots].reverse() : result.monthlySnapshots;

    for (const snap of snapshots) {
      const phaseClass = snap.phase.includes('建仓') ? 'phase-build' : 'phase-rebalance';
      const rowSpan = 6; // 6个资产

      snap.assetDetails.forEach((ad, ai) => {
        const isFirstAsset = ai === 0;
        const hasAction = ad.action !== '无操作';

        tableHTML += '<tr class="' + phaseClass + (hasAction ? ' has-action' : '') + '">';

        if (isFirstAsset) {
          tableHTML += `<td rowspan="${rowSpan}" style="font-weight:700;color:var(--color-primary);">${snap.month}</td>`;
          tableHTML += `<td rowspan="${rowSpan}">${snap.phase}</td>`;
        }

        // 资产名
        tableHTML += `<td style="text-align:left;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ASSET_COLORS[ad.asset]};margin-right:4px;"></span>${ad.asset}</td>`;

        // 目标市值（恒定！）
        tableHTML += `<td style="font-weight:600;">¥${(ad.targetVal || 0).toFixed(0)}</td>`;

        // 月初市值
        tableHTML += `<td>¥${ad.holdingBefore.toFixed(0)}</td>`;

        // 月收益率
        const mr = (ad.monthReturn?.value || ad.monthReturn || 0) * 100;
        const mrClass = mr > 0 ? 'action-buy' : (mr < 0 ? 'action-sell' : '');
        tableHTML += `<td class="${mrClass}">${mr >= 0 ? '+' : ''}${mr.toFixed(2)}%</td>`;

        // 月末市值
        tableHTML += `<td>¥${ad.holdingAfter.toFixed(0)}</td>`;

        // 占总市值%
        tableHTML += `<td>${(ad.actualPct * 100).toFixed(1)}%</td>`;

        // 偏离目标市值
        const devPct = (ad.deviationFromTarget || 0) * 100;
        tableHTML += `<td class="${Math.abs(devPct) > 5 ? 'action-sell' : ''}">${devPct >= 0 ? '+' : ''}${devPct.toFixed(1)}%</td>`;

        // 操作
        if (hasAction) {
          tableHTML += `<td class="${ad.action.includes('买入') ? 'action-buy' : 'action-sell'}">${ad.action}</td>`;
          tableHTML += `<td>¥${ad.amount.toFixed(0)}</td>`;
        } else {
          tableHTML += `<td style="color:var(--color-text-muted);">—</td>`;
          tableHTML += `<td style="color:var(--color-text-muted);">—</td>`;
        }

        // 总市值（第一行时显示）
        if (isFirstAsset) {
          tableHTML += `<td rowspan="${rowSpan}" style="font-weight:700;">¥${snap.totalValue.toFixed(0)}</td>`;
          const mrSnap = snap.monthReturn * 100;
          const mrSnapClass = mrSnap > 0 ? 'action-buy' : (mrSnap < 0 ? 'action-sell' : '');
          tableHTML += `<td rowspan="${rowSpan}" class="${mrSnapClass}" style="font-weight:700;">${mrSnap >= 0 ? '+' : ''}${mrSnap.toFixed(2)}%</td>`;
          // 累计收益 = (当前总市值 / 初始资金 - 1) × 100%
          const cumReturn = (snap.totalValue / RollingBacktest.CONFIG.totalCapital - 1) * 100;
          const cumClass = cumReturn >= 0 ? 'action-buy' : 'action-sell';
          tableHTML += `<td rowspan="${rowSpan}" class="${cumClass}" style="font-weight:600;">${cumReturn >= 0 ? '+' : ''}${cumReturn.toFixed(1)}%</td>`;
          // 仓位占比 = 排除现金后的权益 / 总市值
          const cashHolding = snap.holdings['现金·货币基金'] || 0;
          const positionPct = snap.totalValue > 0 ? ((snap.totalValue - cashHolding) / snap.totalValue * 100) : 0;
          const posClass = positionPct >= 75 ? 'action-buy' : (positionPct < 50 ? 'action-sell' : '');
          tableHTML += `<td rowspan="${rowSpan}" class="${posClass}" style="font-weight:600;">${positionPct.toFixed(0)}%</td>`;
        }

        tableHTML += '</tr>';
      });

      // 每月之间加分隔线
      tableHTML += '<tr class="month-separator"><td colspan="15" style="padding:0;border:none;height:4px;background:var(--color-bg);"></td></tr>';
    }

    tableHTML += '</tbody></table></div>';

    // 图例说明
    tableHTML += `
      <div style="margin-top:12px;font-size:0.75rem;color:var(--color-text-muted);display:flex;flex-wrap:wrap;gap:12px;">
        <span>📘 蓝色行 = 建仓期</span>
        <span>📋 白色行 = 再平衡期</span>
        <span style="color:var(--color-success);">🔴 买入（涨）</span>
        <span style="color:var(--color-danger);">🟢 卖出（跌）</span>
        <span>— = 无操作</span>
        <span>偏离≥±5% → 触发调仓</span>
      </div>
    `;

    body.innerHTML = summaryHTML + tableHTML;
    modal.style.display = 'flex';

    // 绑定排序按钮
    setTimeout(() => {
      const sortBtn = document.getElementById('log-sort-btn');
      const sortIcon = document.getElementById('log-sort-icon');
      if (sortBtn && sortIcon) {
        sortIcon.textContent = sortDesc ? '↑' : '↓';
        sortBtn.addEventListener('click', function() {
          const current = sessionStorage.getItem('log_sort_desc') === '1';
          sessionStorage.setItem('log_sort_desc', current ? '0' : '1');
          // 重新渲染同一个日志
          showLogDetail(result, index);
        });
      }
    }, 0);
  }

  function downloadCSV(csvContent, filename) {
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ============================================================
  //  下载授权弹窗（抖音号引导 · 加密口令）
  // ============================================================

  // 加密口令（XOR + 十六进制 + Base64 混淆，避免静态明文暴露）
  const _AK = (() => {
    const _h = 'NTc1ODQyNDg1ZjVjNWM1NzQ3MzkxYTFiMDMwZTA2';
    const _k = [100,111,117,121,105,110].map(c => String.fromCharCode(c)).join('');
    const _hex = atob(_h);
    let _r = '';
    for (let i = 0; i < _hex.length; i += 2) {
      _r += String.fromCharCode(parseInt(_hex.substring(i, i + 2), 16) ^ _k.charCodeAt((i / 2) % _k.length));
    }
    return _r;
  })();

  const AUTH_STORAGE_KEY = 'auth_douyin_unlocked';
  let authPendingAction = null;     // 待执行动作
  let authPendingPayload = null;    // 动作参数

  /**
   * 校验授权码（与加密口令比对）
   */
  function verifyAuthCode(input) {
    return String(input || '').trim() === _AK;
  }

  /**
   * 检查是否已解锁（5分钟内有效）
   */
  function isAuthUnlocked() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const now = Date.now();
      // 5分钟 = 300000ms
      if (now - data.timestamp > 300000) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return false;
      }
      return data.status === '1';
    } catch (e) { return false; }
  }

  /**
   * 标记已解锁（记录时间戳）
   */
  function markAuthUnlocked() {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        status: '1',
        timestamp: Date.now()
      }));
    } catch (e) { /* ignore */ }
  }

  /**
   * 清除授权
   */
  function clearAuth() {
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch (e) {}
  }

  /**
   * 切换弹窗 UI：未解锁 ⇄ 已解锁
   */
  function setAuthUI(unlocked) {
    const formInput = document.getElementById('auth-form-input');
    const formDownload = document.getElementById('auth-form-download');
    const hintLock = document.getElementById('auth-hint-lock');
    const hintUnlock = document.getElementById('auth-hint-unlock');
    const promptTitle = document.getElementById('auth-prompt-title');

    if (unlocked) {
      if (formInput) formInput.style.display = 'none';
      if (formDownload) formDownload.style.display = 'flex';
      if (hintLock) hintLock.style.display = 'none';
      if (hintUnlock) hintUnlock.style.display = 'block';
      if (promptTitle) promptTitle.textContent = '已解锁 · 点击下载';
    } else {
      if (formInput) formInput.style.display = 'flex';
      if (formDownload) formDownload.style.display = 'none';
      if (hintLock) hintLock.style.display = 'block';
      if (hintUnlock) hintUnlock.style.display = 'none';
      if (promptTitle) promptTitle.textContent = '解锁下载需要授权码';
    }
  }

  /**
   * 显示授权弹窗（每次点击都弹）
   */
  function showAuthModal(action, payload) {
    authPendingAction = action;
    authPendingPayload = payload;
    const modal = document.getElementById('auth-modal');
    const input = document.getElementById('auth-code-input');
    const errEl = document.getElementById('auth-error');
    if (!modal) return;

    const unlocked = isAuthUnlocked();
    setAuthUI(unlocked);
    if (!unlocked) {
      if (input) { input.value = ''; input.classList.remove('auth-shake'); }
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    }
    modal.style.display = 'flex';
    setTimeout(() => {
      if (!unlocked && input) input.focus();
    }, 100);
  }

  /**
   * 关闭授权弹窗
   */
  function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'none';
    authPendingAction = null;
    authPendingPayload = null;
  }

  /**
   * 执行待定动作（解锁后或已解锁直接调用）
   */
  function executePendingAction() {
    const action = authPendingAction;
    const payload = authPendingPayload;
    closeAuthModal();
    if (typeof action === 'function') {
      action(payload);
    }
  }

  /**
   * 处理授权提交
   */
  function handleAuthSubmit() {
    const input = document.getElementById('auth-code-input');
    const errEl = document.getElementById('auth-error');
    const submitBtn = document.getElementById('auth-submit');
    const code = input?.value || '';

    if (!verifyAuthCode(code)) {
      if (errEl) {
        errEl.textContent = '❌ 授权码不正确，请关注抖音号后私信领取';
        errEl.style.display = 'block';
      }
      if (input) {
        input.classList.remove('auth-shake');
        void input.offsetWidth;
        input.classList.add('auth-shake');
      }
      return;
    }

    // 校验通过
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '✓ 解锁成功';
    }
    markAuthUnlocked();
    setAuthUI(true);

    // 0.6s 后自动关闭
    setTimeout(() => {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🎁 立即解锁';
      }
      // 不自动关闭：让用户点击下载按钮
    }, 600);
  }

  /**
   * 处理已解锁状态下的下载按钮点击
   */
  function handleDownloadClick() {
    executePendingAction();
  }

  /**
   * 拦截入口
   */
  function gateAction(action, payload) {
    showAuthModal(action, payload);
  }

  /**
   * 编程式触发文件下载
   */
  function triggerFileDownload(href, downloadName) {
    const link = document.createElement('a');
    link.href = href;
    link.download = downloadName || '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * 初始化授权拦截
   */
  function initAuthGate() {
    // 1. 绑定弹窗事件
    const closeBtn = document.getElementById('auth-close');
    const submitBtn = document.getElementById('auth-submit');
    const input = document.getElementById('auth-code-input');
    const modal = document.getElementById('auth-modal');
    const downloadBtn = document.getElementById('auth-download-btn');
    const resetBtn = document.getElementById('auth-reset-btn');

    closeBtn?.addEventListener('click', closeAuthModal);
    submitBtn?.addEventListener('click', handleAuthSubmit);
    downloadBtn?.addEventListener('click', handleDownloadClick);
    resetBtn?.addEventListener('click', function() {
      clearAuth();
      setAuthUI(false);
      const inp = document.getElementById('auth-code-input');
      const errEl = document.getElementById('auth-error');
      if (inp) { inp.value = ''; inp.focus(); }
      if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    });
    input?.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') handleAuthSubmit();
    });
    modal?.addEventListener('click', function(e) {
      if (e.target === modal) closeAuthModal();
    });

    // 2. 拦截所有 <a download> 链接 — 每次点击都弹窗
    document.querySelectorAll('a[download]').forEach(a => {
      const href = a.getAttribute('href');
      const filename = a.getAttribute('download') || '';
      a.addEventListener('click', function(e) {
        e.preventDefault();
        if (isAuthUnlocked()) {
          // 已解锁：弹窗但显示下载按钮
          gateAction(() => triggerFileDownload(href, filename));
        } else {
          gateAction(() => triggerFileDownload(href, filename));
        }
      });
    });

    // 3. 拦截日志弹窗 CSV 导出按钮
    const exportLogBtn = document.getElementById('btn-export-log-csv');
    const exportSummaryBtn = document.getElementById('btn-export-summary-csv');

    if (exportLogBtn) {
      exportLogBtn.addEventListener('click', function(e) {
        e.preventDefault();
        const idx = parseInt(document.getElementById('log-modal')?.dataset?.logIndex, 10);
        if (isNaN(idx) || !rollingResults || idx >= rollingResults.length) return;
        gateAction(() => {
          const csv = RollingBacktest.exportLogCSV(rollingResults[idx]);
          downloadCSV(csv, `恒市值法_操作日志_${rollingResults[idx].startPoint.key}.csv`);
        });
      });
    }
    if (exportSummaryBtn) {
      exportSummaryBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (!rollingResults) return;
        gateAction(() => {
          const csv = RollingBacktest.exportSummaryCSV(rollingResults);
          downloadCSV(csv, '恒市值法_滚动回测汇总.csv');
        });
      });
    }
  }

  // DOM Ready 后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthGate);
  } else {
    initAuthGate();
  }
})();
