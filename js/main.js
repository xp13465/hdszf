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
      '518660': '黄金', '518880': '黄金',
      '320013': '现金',
      '510880': 'A股', '511010': '债券'
    };

    const assetNameMap = {
      '510300': '华泰柏瑞沪深300ETF', '160706': '嘉实沪深300ETF联接', '512500': '华夏中证500ETF', '160119': '南方中证500ETF联接',
      '513650': '南方标普500ETF', '513500': '博时标普500ETF', '096001': '大成标普500等权重', '159659': '招商纳斯达克100ETF', '513100': '国泰纳斯达克100ETF', '270042': '广发纳斯达克100ETF',
      '518660': '工银黄金ETF', '518880': '华安黄金ETF',
      '320013': '诺安货币基金',
      '510880': '华泰柏瑞红利ETF', '511010': '国泰5年国债ETF'
    };

    const funds = APP_DATA.funds || [];
    funds.forEach(fund => {
      const code = fund.code || fund.fund_code || '';
      const assetType = assetClassMap[code] || '其他';
      const tagClass = assetTypeMap[assetType] || 'cash';
      const name = assetNameMap[code] || fund.name || code;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code style="font-size:0.8125rem;color:var(--color-primary);">${code}</code></td>
        <td>${name}</td>
        <td><span class="asset-tag ${tagClass}">${assetType}</span></td>
        <td>${fund.date_start || fund.start || '-'}</td>
        <td>${fund.date_end || fund.end || '-'}</td>
        <td>${fund.record_count || fund.records || fund.count || '-'}</td>
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

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        setTheme(theme, true);
        localStorage.setItem('investment-advisor-theme', theme);
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
})();
