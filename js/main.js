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
  //   currentResult = 当前配置（含当月估算，若已拿到进行中快照）
  //   lockedResult  = 锁定配置（同样含当月，保证与当前配置可比）
  //   frozenResult  = 当前配置的固化口径（截至最新完整月），仅用于 hover 对照
  function updateMetrics(currentResult, lockedResult, frozenResult) {
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

    // 总收益标题里的月数跟随口径（含当月估算时 +1 个月），避免写死「132个月」
    const totalLabel = document.getElementById('metric-total-label');
    if (totalLabel && m.totalMonths != null) totalLabel.textContent = `总收益（${m.totalMonths}个月）`;

    // 「含当月估算」悬浮说明
    if (LIVE_INFO) {
      const fr = (frozenResult && frozenResult.metrics) ? frozenResult.metrics : null;
      const p1 = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
      const p2 = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
      const L = `含 ${LIVE_INFO.month}（估算）`;
      const B = `截至 ${LIVE_INFO.baseMonth}（固化）`;
      tipLive('metric-annual', [[L, p2(m.annual)], [B, fr ? p2(fr.annual) : '—']]);
      tipLive('metric-dd', [[L, m.maxDd.toFixed(2) + '%'], [B, fr ? fr.maxDd.toFixed(2) + '%' : '—']]);
      tipLive('metric-sharpe', [[L, m.sharpe.toFixed(4)], [B, fr ? fr.sharpe.toFixed(4) : '—']]);
      tipLive('metric-total', [[L, p1(m.total)], [B, fr ? p1(fr.total) : '—']]);
      bindTips();
    }

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

  // --- 首屏 Hero 统计卡片（动态；有进行中快照时显示「含当月估算」，悬停可看固化值）---
  function updateHeroStats(result, frozen) {
    if (!result || !result.metrics) return;
    const m = result.metrics;
    const f = (frozen && frozen.metrics) ? frozen.metrics : null;
    const capital = APP_DATA.finalConfig?.total_capital || 500000;
    const wan = (v) => (v / 10000).toFixed(1) + '万';
    const pct = (v, d) => (v >= 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%';

    const elFinal = document.getElementById('hero-final-value');
    const elFinalSub = document.getElementById('hero-final-sub');
    if (elFinal) elFinal.textContent = wan(m.finalValue);
    if (elFinalSub && m.totalMonths != null) {
      const ratio = m.finalValue / capital;
      const gainLabel = ratio >= 2 ? '翻倍' : (ratio >= 1 ? '增长' : '亏损');
      elFinalSub.textContent = `${Math.round(m.totalMonths / 12)}年${gainLabel} · 年化${m.annual.toFixed(1)}%`;
    }
    if (f) {
      tipLive('hero-final', [
        [`含 ${LIVE_INFO.month}（估算）`, `¥${wan(m.finalValue)} · 累计 ${pct(m.total, 2)} · 年化 ${m.annual.toFixed(2)}%`],
        [`截至 ${LIVE_INFO.baseMonth}（固化）`, `¥${wan(f.finalValue)} · 累计 ${pct(f.total, 2)} · 年化 ${f.annual.toFixed(2)}%`]
      ]);
    }

    const elWinLabel = document.getElementById('hero-winrate-label');
    const elWinValue = document.getElementById('hero-winrate-value');
    if (elWinLabel && m.monthlyWinRate != null) elWinLabel.textContent = `📅 月胜率 ${(m.monthlyWinRate * 100).toFixed(1)}%`;
    if (elWinValue && m.positiveMonths != null && m.totalMonths != null) {
      elWinValue.textContent = `${m.positiveMonths} / ${m.totalMonths}月`;
    }
    if (f) {
      tipLive('hero-winrate', [
        [`含 ${LIVE_INFO.month}（估算）`, `${(m.monthlyWinRate * 100).toFixed(1)}%（赚钱 ${m.positiveMonths} / 共 ${m.totalMonths} 个月）`],
        [`截至 ${LIVE_INFO.baseMonth}（固化）`, `${(f.monthlyWinRate * 100).toFixed(1)}%（赚钱 ${f.positiveMonths} / 共 ${f.totalMonths} 个月）`]
      ]);
    }

    const elWinSub = document.getElementById('hero-winrate-sub');
    if (elWinSub && m.yearly) {
      elWinSub.textContent = `${m.yearly.fullYears}年有${m.yearly.negativeYears}年亏损 · 最多亏${Math.abs(m.yearly.worstYear * 100).toFixed(1)}%`;
    }

    const elDd = document.getElementById('hero-dd-value');
    const elDdSub = document.getElementById('hero-dd-sub');
    if (elDd) elDd.textContent = m.maxDd.toFixed(1) + '%';
    if (elDdSub) elDdSub.textContent = `50万最多浮亏约${Math.abs(capital * m.maxDd / 100 / 10000).toFixed(1)}万`;
    if (f) {
      tipLive('hero-dd', [
        [`含 ${LIVE_INFO.month}（估算）`, m.maxDd.toFixed(2) + '%'],
        [`截至 ${LIVE_INFO.baseMonth}（固化）`, f.maxDd.toFixed(2) + '%']
      ]);
    }

    const elCash = document.getElementById('hero-cash-value');
    if (elCash) elCash.textContent = Math.round((result.alloc?.['现金·货币基金'] || 0) * 100) + '%';

    document.body.classList.toggle('has-live-estimate', !!LIVE_INFO);
    renderLiveNotes();
    bindTips();
  }

  // --- 回测回调 ---
  let lastBacktestArgs = null;    // ['当前配置', '锁定配置']，供拿到进行中快照后重算

  function onBacktestChange(currentValues, lockedValues) {
    lastBacktestArgs = [currentValues, lockedValues];
    const currentResult = BacktestEngine.compute(currentValues);
    const frozenResult = BacktestEngine.compute(currentValues, { liveOverlay: false });
    let lockedResult = null;
    if (lockedValues) {
      lockedResult = BacktestEngine.compute(lockedValues);
    }

    updateMetrics(currentResult, lockedResult, frozenResult);
    ChartManager.updateEquityCurve(currentResult, lockedResult);
    ChartManager.updateDrawdownCurve(currentResult, lockedResult);
  }

  // 拿到进行中快照（live overlay 生效）后，把所有「以最新数据算出」的展示重渲染一遍
  function refreshLiveDisplay() {
    const live = BacktestEngine.getDefaultResult();
    const frozen = BacktestEngine.getDefaultResult({ liveOverlay: false });
    updateHeroStats(live, frozen);
    initComparisonCards();
    ChartManager.updateRadarChart();
    ChartManager.updateCompareBarChart();
    if (lastBacktestArgs) onBacktestChange(lastBacktestArgs[0], lastBacktestArgs[1]);
    else {
      updateMetrics(live, null, frozen);
      ChartManager.updateEquityCurve(live, null);
      ChartManager.updateDrawdownCurve(live, null);
    }
    bindTips();
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
    const actualEndDate = '2026-08';

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

  // --- 方案对比卡片填充（动态：直算 simulateCMV，数据更新即反映）---
  // 三档配置的唯一事实来源在 engine.js 的 BacktestEngine.PLANS
  function initComparisonCards() {
    for (const id of ['conservative', 'balanced', 'aggressive']) {
      const alloc = BacktestEngine.PLANS[id];
      const res = BacktestEngine.simulateCMV(alloc);
      // 固化口径（截至最新完整月）：只用于 hover 提示里的对照值
      const resFrozen = BacktestEngine.simulateCMV(alloc, { liveOverlay: false });

      // 真实数据缺失时回退到静态 comparisons，保证页面不空白
      if (!res) {
        const comp = APP_DATA.comparisons?.['三档方案对比']?.[id];
        if (!comp) continue;
        setCompareCard(id, {
          annual: comp.annual, dd: comp.dd, sharpe: comp.sharpe,
          sortino: comp.sortino, total: comp.total_return,
          alloc: comp.alloc, featured: id === 'balanced'
        });
        continue;
      }

      setCompareCard(id, {
        annual: res.annual,
        dd: res.maxDd,
        sharpe: res.sharpe,
        sortino: res.sortino,
        total: res.total,
        alloc,
        frozen: resFrozen,
        featured: id === 'balanced'
      });
    }
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

    // 「含当月估算」悬浮说明（拿不到进行中快照时 tipLive 内部直接跳过）
    if (LIVE_INFO) {
      const pct = (v, d) => (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
      // 注意字段名：卡片对象用的是 dd（= maxDd），引擎 metrics 用的是 maxDd
      const line = (annual, total, dd) =>
        `年化 ${annual.toFixed(2)}% · 总收益 ${pct(total, 1)} · 回撤 ${dd.toFixed(2)}%`;
      const pairs = [[`含 ${LIVE_INFO.month}（估算）`, line(data.annual, data.total, data.dd)]];
      if (data.frozen) {
        pairs.push([`截至 ${LIVE_INFO.baseMonth}（固化）`,
          line(data.frozen.annual, data.frozen.total, data.frozen.maxDd)]);
      }
      tipLive(`plan-${id}`, pairs);
      bindTips(card);
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

    // 初始回测（此时还没拿到进行中快照 → 先按固化口径渲染，避免数字闪动两遍）
    const defaultResult = BacktestEngine.getDefaultResult();
    updateMetrics(defaultResult, null, null);
    updateHeroStats(defaultResult, null);
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

    // 进行中月份进度快照：拿到后 ① 追加日志「🟡 进行中」行 ② 让引擎叠加该月并重渲染「含当月」指标
    ensureLiveProgress().then((d) => {
      if (d && LIVE_INFO) refreshLiveDisplay();
    });

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
      business: 'css/style.css?v=19',   // ⚠️ 必须与 index.html 的 <link id=theme-style> 版本号一致（否则切回商务风会命中旧缓存）
      modern: 'css/modern.css?v=18',
      tech: 'css/tech.css?v=18'
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

  // ============================================================
  //  进行中月份进度快照（数据源 js/progress.json）
  //  ⚠️ 只读快照：绝不写入 APP_DATA，绝不进 data.js。
  //     两个用途：
  //       A. 『完整持仓日志』表格末尾（正序）/ 开头（倒序）追加一行「🟡 进行中」；
  //       B. 作为引擎的 live overlay（BacktestEngine.setLiveOverlay），让所有由引擎算出的
  //          指标都显示「含当月 MTD 估算」值，鼠标悬停可看「截至上月末的固化值」。
  //     取不到数据 / 非进行中 / 基准月与主数据末月不符 → 全部退回固化口径，静默降级。
  //     正式月末定稿仍由 scripts/monthly_update.js 写入 data.js 主回测。
  // ============================================================
  let liveProgressData = null;
  let LIVE_INFO = null;          // { month, asOf, baseMonth } —— 有进行中估算时才非空
  let liveProgressPromise = null;

  // 主回测数据末月（= 日志表格最后一个完整月），用于判断进度快照是否与之同步
  function lastDataMonth() {
    try {
      const m = (typeof APP_DATA !== 'undefined' && APP_DATA.realReturns && APP_DATA.realReturns.months) || null;
      return (m && m.length) ? m[m.length - 1] : null;
    } catch (e) { return null; }
  }

  function ensureLiveProgress() {
    if (!liveProgressPromise) {
      // 10 分钟粒度的查询参数：兼顾新鲜度与缓存友好（配合 worker.js 的短缓存头）
      const bust = Math.floor(Date.now() / 600000);
      liveProgressPromise = fetch(`js/progress.json?t=${bust}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d || !d.in_progress || !Array.isArray(d.assets) || !d.assets.length) return null;
          liveProgressData = d;
          // 只在「快照基准月 == 主数据末月」时提示（此时日志里才会真的多出「进行中行」）
          if (!d.base_month || d.base_month === lastDataMonth()) {
            markLiveBadges(d);
            applyLiveOverlay(d);
          }
          return d;
        })
        .catch(() => null); // 静默降级：不影响任何既有功能
    }
    return liveProgressPromise;
  }

  // 把进行中月份接进引擎（live overlay）：之后所有 simulateCMV / compute 调用都会
  // 自动多算一个月「MTD 估算」，与 progress.json 的 est_total、日志末行完全同源。
  // ⚠️ 该叠加月不触发再平衡，故结果严格等于「上月末持仓 × (1+MTD)」。
  function applyLiveOverlay(d) {
    const returns = {};
    for (const a of d.assets) {
      const v = (a.mtd_raw != null) ? Number(a.mtd_raw) : (Number(a.mtd) / 100);
      if (!isFinite(v)) return null;      // 任一资产数值异常 → 整体不启用，宁可不显示
      returns[a.name] = v;
    }
    const applied = BacktestEngine.setLiveOverlay({
      month: d.in_progress_month,
      asOf: d.data_as_of || '',
      returns
    });
    if (!applied) return null;
    LIVE_INFO = { month: applied.month, asOf: applied.asOf, baseMonth: applied.baseMonth };
    return LIVE_INFO;
  }

  // 滚动汇总表里每个「查看操作记录」按钮打上 🟡 角标，提示日志内含进行中数据
  // 用 body 级 class + CSS 伪元素实现（而非逐个按钮加 class），
  // 这样"先取到进度、后渲染按钮"或"重算后重建按钮"都不会丢角标
  function markLiveBadges(d) {
    document.body.classList.add('has-live-progress');
    document.querySelectorAll('.btn-detail').forEach((b) => {
      b.title = `${d.in_progress_month} 尚在进行中（MTD 估算），已追加为日志末行`;
    });
  }

  // ============================================================
  //  站内通用「悬浮说明」层（含当月估算 vs 截至上月末固化）
  //  —— 元素加 data-tip-key，内容由 tipLive() 写入 TIPS 表；
  //     没拿到进行中快照（TIPS 为空）时不显示任何提示，也不显示「含当月」小标。
  //  —— 单例浮层 + fixed 定位 + 视口边界收敛，三套皮肤走同一套 CSS 变量。
  // ============================================================
  const TIPS = {};
  let tipLayer = null;
  let tipAnchor = null;

  function tipLive(key, pairs) {
    if (!LIVE_INFO) { delete TIPS[key]; return; }
    const rows = pairs.map((p) =>
      `<div class="tip-row"><span class="tip-k">${p[0]}</span><span class="tip-v">${p[1]}</span></div>`
    ).join('');
    TIPS[key] =
      `<div class="tip-title">🟡 含 ${LIVE_INFO.month} 未完整月（MTD 估算）</div>` +
      rows +
      `<div class="tip-note">数据截至 ${LIVE_INFO.asOf || '—'}（本月最后交易日收盘）。` +
      `官方回测指标仍以「截至 ${LIVE_INFO.baseMonth}」的固化口径为准，月末定稿后本估算会被真实数据替换。</div>`;
  }

  function ensureTipLayer() {
    if (!tipLayer) {
      tipLayer = document.createElement('div');
      tipLayer.className = 'site-tip';
      document.body.appendChild(tipLayer);
    }
    return tipLayer;
  }

  function showTip(el) {
    const key = el.getAttribute('data-tip-key');
    const html = key ? TIPS[key] : null;
    if (!html) return;
    const layer = ensureTipLayer();
    tipAnchor = el;
    layer.innerHTML = html;
    layer.classList.add('show');
    const r = el.getBoundingClientRect();
    const lw = layer.offsetWidth;
    const lh = layer.offsetHeight;
    let left = r.left + r.width / 2 - lw / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - lw - 10));
    // 锚点在视口上方 35% 以内 → 放卡片下方，避免遮住导航栏
    let top = (r.top < window.innerHeight * 0.35) ? r.bottom + 10 : r.top - lh - 10;
    if (top + lh > window.innerHeight - 10) top = Math.max(10, r.top - lh - 10);
    if (top < 10) top = r.bottom + 10;
    layer.style.left = left + 'px';
    layer.style.top = top + 'px';
  }

  function hideTip() { if (tipLayer) tipLayer.classList.remove('show'); tipAnchor = null; }

  // 绑定（幂等：data-tip-bound 标记；可安全地对局部容器重复调用）
  function bindTips(root) {
    (root || document).querySelectorAll('[data-tip-key]').forEach((el) => {
      if (el.getAttribute('data-tip-bound')) return;
      el.setAttribute('data-tip-bound', '1');
      el.addEventListener('mouseenter', () => showTip(el));
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('focusin', () => showTip(el));
      el.addEventListener('focusout', hideTip);
    });
  }

  // 板块级说明行（只在有进行中估算时显示，由 body.has-live-estimate 控制显隐）
  function renderLiveNotes() {
    if (!LIVE_INFO) return;
    const tail = `未完整月（月至今 MTD 估算，数据截至 ${LIVE_INFO.asOf || '—'}）；` +
      `鼠标移到卡片上可看「截至 ${LIVE_INFO.baseMonth} 的固化值」。官方回测口径仍以固化值为准。`;
    const hero = document.getElementById('hero-live-note');
    if (hero) hero.innerHTML = `🟡 上方统计卡已含 <b>${LIVE_INFO.month}</b> ${tail}`;
    const bt = document.getElementById('backtest-live-note');
    if (bt) bt.innerHTML = `🟡 以下指标与曲线已含 <b>${LIVE_INFO.month}</b> ${tail}`;
    const cmp = document.getElementById('compare-live-note');
    if (cmp) {
      cmp.innerHTML = `🟡 上方三档卡片的年化 / 总收益已含 <b>${LIVE_INFO.month}</b> 未完整月（MTD 估算，数据截至 ${LIVE_INFO.asOf || '—'}）；` +
        `下方「数据说明」中的年化与回撤为截至 ${LIVE_INFO.baseMonth} 的固化口径。悬停卡片可对比两者。`;
    }
  }


  function initLogModal() {
    const modal = document.getElementById('log-modal');
    const closeBtn = document.getElementById('log-modal-close');
    const closeBtn2 = document.getElementById('btn-log-modal-close');
    const maximizeBtn = document.getElementById('btn-log-modal-maximize');
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
      const box = modal.querySelector('.log-modal-content');
      if (box && box.classList.contains('maximized')) {
        box.classList.remove('maximized');
        if (maximizeBtn) { maximizeBtn.textContent = '⤢'; maximizeBtn.title = '放大 / 还原窗口'; }
      }
    }

    closeBtn?.addEventListener('click', closeModal);
    closeBtn2?.addEventListener('click', closeModal);
    modal?.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });

    // 放大 / 还原窗口（最大化接近全屏）
    maximizeBtn?.addEventListener('click', function() {
      const box = modal.querySelector('.log-modal-content');
      if (!box) return;
      const on = box.classList.toggle('maximized');
      maximizeBtn.textContent = on ? '⤡' : '⤢';
      maximizeBtn.title = on ? '还原窗口' : '放大 / 还原窗口';
    });

    // 导出CSV — 授权拦截逻辑统一在 initAuthGate() 中实现

    // ESC关闭
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        closeModal();
      }
    });
  }

  // 日志渲染轮次标记：异步补齐「进行中月份行」时用于防止插到过期的渲染上
  let logRenderToken = 0;

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
    tableHTML += '<th style="cursor:pointer;" id="log-sort-btn" title="点击切换正序/倒序">月份 <span id="log-sort-icon">↓</span></th><th>阶段</th><th>资产</th><th>目标市值</th><th>月初市值</th><th>月收益率</th><th>月末市值</th><th>占总额%</th><th>偏离目标</th><th>操作</th><th>金额</th><th>总市值</th><th>月收益</th><th>累计收益</th><th>年度收益率</th><th>仓位</th>';
    tableHTML += '</tr></thead><tbody>';

    // 读取排序偏好（默认正序 = 最旧在上）
    const sortDesc = (sessionStorage.getItem('log_sort_desc') === '1');
    const snapshots = sortDesc ? [...result.monthlySnapshots].reverse() : result.monthlySnapshots;

    // 年度收益率：按日历年聚合。yearStartValue = 上一年末总市值（首年=初始资金 50万）
    // 用于计算每条记录对应年份的「年收益金额 + 年收益比例」（区别于年化均值）
    const yearStartMap = {};
    let prevSnap = null;
    for (const s of result.monthlySnapshots) {
      const y = s.month.substring(0, 4);
      if (!(y in yearStartMap)) {
        yearStartMap[y] = prevSnap ? prevSnap.totalValue : RollingBacktest.CONFIG.totalCapital;
      }
      prevSnap = s;
    }

    // 月收益金额：每月「该月末总市值 − 上月末总市值」（首月基准 = 初始本金 50万）
    const monthPrevMap = {};
    let prevMonthValue = null;
    for (const s of result.monthlySnapshots) {
      monthPrevMap[s.month] = (prevMonthValue === null) ? RollingBacktest.CONFIG.totalCapital : prevMonthValue;
      prevMonthValue = s.totalValue;
    }

    // 累计月序：按时间正序编号，**入场月即第 1 个月**
    //   入场月（2015-08，无收益）= 第 1 个月；末月 = 第 N 个月（N = 快照条数）
    //   按正序建立映射，因此倒序展示时编号依然正确
    const monthNoMap = {};
    result.monthlySnapshots.forEach((s, i) => { monthNoMap[s.month] = i + 1; });

    const SEP_ROW = '<tr class="month-separator"><td colspan="16" style="padding:0;border:none;height:4px;background:var(--color-bg);"></td></tr>';

    // ============================================================
    //  进行中月份行（MTD 估算）—— 追加到日志末行，数据源 js/progress.json
    //  口径：
    //    · 各资产「估算现值」= 该次回测末月持仓 × (1 + 该资产本月至今 MTD%)
    //      （progress.json 只提供 MTD%，持仓取本次回测自身，因此任意起点都能自洽）
    //    · 收益比例一律 ÷ 固定基准本金 50 万（与「累计收益」「年度收益率」两列同口径）
    //    · 无操作（恒市值法在月末才调仓，进行中不产生任何买卖）
    //  ⚠️ 仅供进度参考，不参与任何官方回测指标（年化/回撤/胜率仍截至基准月）
    // ============================================================
    function buildLiveRows(d) {
      const snaps = result.monthlySnapshots;
      if (!snaps.length) return '';
      const last = snaps[snaps.length - 1];
      // 基准月必须正好是日志最后一个完整月，否则说明数据已定稿 / 不同步 → 不展示
      if (!d.base_month || d.base_month !== last.month) return '';

      const mtdMap = {};
      d.assets.forEach((a) => { mtdMap[a.name] = Number(a.mtd) || 0; });

      const est = {};
      let estTotal = 0;
      ASSETS.forEach((name) => {
        const hold = last.holdings[name] || 0;
        const m = (name in mtdMap) ? mtdMap[name] : 0;
        est[name] = hold * (1 + m / 100);
        estTotal += est[name];
      });

      const baseCapital = RollingBacktest.CONFIG.totalCapital || 500000;
      const targetValMap = {};
      const targetPctMap = {};
      last.assetDetails.forEach((ad) => {
        targetValMap[ad.asset] = ad.targetVal;
        targetPctMap[ad.asset] = ad.targetPct;
      });

      const liveMonth = d.in_progress_month || '';
      const lParts = liveMonth.split('-');
      const ly = lParts[0] || last.month.substring(0, 4);
      const lm = parseInt(lParts[1], 10) || 0;

      const monthAmount = estTotal - last.totalValue;
      // 口径（用户指定）：本月至今收益金额 ÷ 固定基准本金 50 万
      //   -1.04万 / 50万 = -2.07%（不是 ÷上月末总市值 的 -0.94%，后者仅作参考对照）
      const mtdBasePct = baseCapital > 0 ? (monthAmount / baseCapital) * 100 : 0;
      const yearStartValue = yearStartMap[ly] || baseCapital;
      const annAmount = estTotal - yearStartValue;
      const annPct = baseCapital > 0 ? (annAmount / baseCapital) * 100 : 0;
      const cumNo = snaps.length + 1;                            // 入场月=第1个月 → 进行中月 = 条数+1
      const cumAmount = estTotal - baseCapital;
      const cumPct = (estTotal / baseCapital - 1) * 100;
      const cashEst = est['现金·货币基金'] || 0;
      const positionPct = estTotal > 0 ? ((estTotal - cashEst) / estTotal * 100) : 0;

      const mCls = mtdBasePct > 0 ? 'action-buy' : (mtdBasePct < 0 ? 'action-sell' : '');
      const cumCls = cumPct >= 0 ? 'action-buy' : 'action-sell';
      const annCls = annAmount >= 0 ? 'action-buy' : 'action-sell';
      const posCls = positionPct >= 75 ? 'action-buy' : (positionPct < 50 ? 'action-sell' : '');
      const sgn = (v) => (v >= 0 ? '+' : '-');
      const yuan = (v) => `${sgn(v)}¥${Math.round(Math.abs(v)).toLocaleString('zh-CN')}`;

      let html = '';
      ASSETS.forEach((name, ai) => {
        const m = (name in mtdMap) ? mtdMap[name] : 0;
        const mRowCls = m > 0 ? 'action-buy' : (m < 0 ? 'action-sell' : '');
        const pctOfTotal = estTotal > 0 ? (est[name] / estTotal) : 0;
        const dev = (pctOfTotal - (targetPctMap[name] || 0)) * 100;

        html += '<tr class="live-month-row">';

        if (ai === 0) {
          html += `<td rowspan="6" style="font-weight:700;color:var(--color-warning,#c05600);">${liveMonth}` +
            `<div style="font-size:0.66rem;font-weight:600;opacity:0.9;">🟡 进行中</div></td>`;
          html += `<td rowspan="6" style="color:var(--color-warning,#c05600);font-weight:600;">进行中` +
            `<div style="font-size:0.64rem;font-weight:400;opacity:0.85;">MTD 估算</div></td>`;
        }

        html += `<td style="text-align:left;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ASSET_COLORS[name]};margin-right:4px;"></span>${name}</td>`;
        html += `<td style="font-weight:600;">¥${(targetValMap[name] || 0).toFixed(0)}</td>`;
        html += `<td>¥${(last.holdings[name] || 0).toFixed(0)}</td>`;
        html += `<td class="${mRowCls}">${m >= 0 ? '+' : ''}${m.toFixed(2)}%</td>`;
        html += `<td style="font-weight:600;">¥${est[name].toFixed(0)}</td>`;
        html += `<td>${(pctOfTotal * 100).toFixed(1)}%</td>`;
        html += `<td class="${Math.abs(dev) > 5 ? 'action-sell' : ''}">${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%</td>`;
        html += `<td style="color:var(--color-text-muted);">—</td>`;
        html += `<td style="color:var(--color-text-muted);">—</td>`;

        if (ai === 0) {
          html += `<td rowspan="6" style="font-weight:700;">¥${estTotal.toFixed(0)}</td>`;
          // 月收益：月份 + 比例（口径 = 本月金额 ÷ 固定基准 50 万）+ 金额
          html += `<td rowspan="6" class="${mCls}" style="font-weight:700;text-align:right;">` +
            `<div style="font-size:0.7rem;font-weight:500;opacity:0.7;line-height:1.3;">${ly}年${lm}月 MTD</div>` +
            `${mtdBasePct >= 0 ? '+' : ''}${mtdBasePct.toFixed(2)}%` +
            `<div style="font-size:0.64rem;font-weight:400;opacity:0.85;line-height:1.3;">${yuan(monthAmount)}</div></td>`;
          // 累计收益：第 N 个月 + 比例 + 金额（均为估算）
          html += `<td rowspan="6" class="${cumCls}" style="font-weight:600;text-align:right;">` +
            `<div style="font-size:0.7rem;font-weight:500;opacity:0.7;line-height:1.3;">第 ${cumNo} 个月</div>` +
            `${cumPct >= 0 ? '+' : ''}${cumPct.toFixed(2)}%` +
            `<div style="font-size:0.64rem;font-weight:400;opacity:0.85;line-height:1.3;">${yuan(cumAmount)}</div></td>`;
          // 年度收益率：当年至今 + 比例 + 金额
          html += `<td rowspan="6" class="${annCls}" style="font-weight:600;text-align:right;">` +
            `<div style="font-size:0.7rem;font-weight:500;opacity:0.7;line-height:1.3;">${ly}年至今</div>` +
            `${annPct >= 0 ? '+' : ''}${annPct.toFixed(2)}%` +
            `<div style="font-size:0.64rem;font-weight:400;opacity:0.85;line-height:1.3;">${yuan(annAmount)}</div></td>`;
          html += `<td rowspan="6" class="${posCls}" style="font-weight:600;">${positionPct.toFixed(0)}%</td>`;
        }

        html += '</tr>';
      });

      return html;
    }

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

        // 月收益率（monthReturn 可能是对象{value,estimated}或数字；value 为 0 时不能用 || 兜底，否则得 NaN）
        const mrObj = ad.monthReturn;
        const mrVal = (mrObj && typeof mrObj === 'object') ? (mrObj.value || 0) : (mrObj || 0);
        const mr = mrVal * 100;
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
          // 月收益 = 组合当月「月份 + 月收益率 + 实际收益金额」竖向排列（免视线跳回第一列）
          const mrSnap = snap.monthReturn * 100;
          const mrSnapClass = mrSnap > 0 ? 'action-buy' : (mrSnap < 0 ? 'action-sell' : '');
          const mPrevValue = (snap.month in monthPrevMap) ? monthPrevMap[snap.month] : RollingBacktest.CONFIG.totalCapital;
          const mAmount = snap.totalValue - mPrevValue;
          const mLabel = snap.month.substring(0, 4) + '年' + parseInt(snap.month.substring(5, 7), 10) + '月';
          tableHTML += `<td rowspan="${rowSpan}" class="${mrSnapClass}" style="font-weight:700;text-align:right;">` +
            `<div style="font-size:0.7rem;font-weight:500;opacity:0.7;line-height:1.3;">${mLabel}</div>` +
            `${mrSnap >= 0 ? '+' : ''}${mrSnap.toFixed(2)}%` +
            `<div style="font-size:0.7rem;font-weight:400;opacity:0.85;">¥${mAmount >= 0 ? '+' : ''}${Math.round(mAmount).toLocaleString()}</div></td>`;
          // 累计收益 = 组合「累计月序 + 累计收益率 + 累计收益金额」竖向三行
          //   累计收益率 = (当前总市值 / 初始本金 50万 − 1) × 100%
          //   累计收益金额 = 当前总市值 − 初始本金 50万（首行入场月为 0，自身即基准）
          const cumNo = (snap.month in monthNoMap) ? monthNoMap[snap.month] : 1;
          const cumLabel = cumNo === 1 ? '第 1 个月 · 入场' : `第 ${cumNo} 个月`;
          const cumReturn = (snap.totalValue / RollingBacktest.CONFIG.totalCapital - 1) * 100;
          const cumAmount = snap.totalValue - RollingBacktest.CONFIG.totalCapital;
          const cumClass = cumReturn >= 0 ? 'action-buy' : 'action-sell';
          tableHTML += `<td rowspan="${rowSpan}" class="${cumClass}" style="font-weight:600;text-align:right;">` +
            `<div style="font-size:0.7rem;font-weight:500;opacity:0.7;line-height:1.3;">${cumLabel}</div>` +
            `${cumReturn >= 0 ? '+' : ''}${cumReturn.toFixed(2)}%` +
            `<div style="font-size:0.7rem;font-weight:400;opacity:0.85;">¥${cumAmount >= 0 ? '+' : ''}${Math.round(cumAmount).toLocaleString()}</div></td>`;
          // 年度收益率 = 对应日历年至今的「收益金额 + 收益比例」（区别于年化均值）
          // 单元格内直接标注年份，避免视线来回跳回第一列
          // 比例口径：年收益金额 ÷ 固定基准本金 50万（CONFIG.totalCapital）
          //   → 各年比例可加，逐年累加恰好等于「累计收益」；与"÷上年末总市值"的复合口径不同。
          const annYear = snap.month.substring(0, 4);
          const yearStartValue = yearStartMap[annYear] || RollingBacktest.CONFIG.totalCapital;
          const annAmount = snap.totalValue - yearStartValue;
          const baseCapital = RollingBacktest.CONFIG.totalCapital || 500000;
          const annPct = baseCapital > 0 ? (annAmount / baseCapital) * 100 : 0;
          const annClass = annAmount >= 0 ? 'action-buy' : 'action-sell';
          tableHTML += `<td rowspan="${rowSpan}" class="${annClass}" style="font-weight:600;text-align:right;">` +
            `<div style="font-size:0.7rem;font-weight:500;opacity:0.7;line-height:1.3;">${annYear}年</div>` +
            `${annPct >= 0 ? '+' : ''}${annPct.toFixed(2)}%` +
            `<div style="font-size:0.7rem;font-weight:400;opacity:0.85;">¥${annAmount >= 0 ? '+' : ''}${Math.round(annAmount).toLocaleString()}</div></td>`;
          // 仓位占比 = 排除现金后的权益 / 总市值
          const cashHolding = snap.holdings['现金·货币基金'] || 0;
          const positionPct = snap.totalValue > 0 ? ((snap.totalValue - cashHolding) / snap.totalValue * 100) : 0;
          const posClass = positionPct >= 75 ? 'action-buy' : (positionPct < 50 ? 'action-sell' : '');
          tableHTML += `<td rowspan="${rowSpan}" class="${posClass}" style="font-weight:600;">${positionPct.toFixed(0)}%</td>`;
        }

        tableHTML += '</tr>';
      });

      // 每月之间加分隔线（16 列：含新增的「年度收益率」）
      tableHTML += SEP_ROW;
    }

    tableHTML += '</tbody></table></div>';

    // 图例说明
    tableHTML += `
      <div style="margin-top:12px;font-size:0.75rem;color:var(--color-text-muted);display:flex;flex-wrap:wrap;gap:12px;">
        <span>📘 蓝色行 = 建仓期</span>
        <span>📋 白色行 = 再平衡期</span>
        <span style="color:var(--color-warning,#c05600);">🟡 进行中行 = 本月尚未结束的 MTD 估算（不参与官方指标）</span>
        <span style="color:var(--color-success);">🔴 买入（涨）</span>
        <span style="color:var(--color-danger);">🟢 卖出（跌）</span>
        <span>— = 无操作</span>
        <span>偏离≥±5% → 触发调仓</span>
        <span>收益比例口径：÷固定基准本金 ¥50 万（进行中行亦然，故与各段收益可加）</span>
      </div>
    `;

    body.innerHTML = summaryHTML + tableHTML;
    modal.style.display = 'flex';

    // ---- 进行中月份（MTD 估算）行：追加到表格首/末（跟随排序方向）----
    const liveToken = ++logRenderToken;
    function insertLiveRow() {
      if (liveToken !== logRenderToken) return;              // 已被更新的渲染取代
      if (modal.style.display === 'none') return;            // 弹窗已关闭
      const d = liveProgressData;
      if (!d) return;                                        // 无进度数据 → 静默不展示
      const tb = document.querySelector('#log-modal-body .log-table tbody');
      if (!tb || tb.querySelector('.live-month-row')) return; // 已插入过
      const html = buildLiveRows(d);
      if (!html) return;
      if (sortDesc) {
        tb.insertAdjacentHTML('afterbegin', html + SEP_ROW);
      } else {
        const lastEl = tb.lastElementChild;
        const needSep = !(lastEl && lastEl.classList.contains('month-separator'));
        tb.insertAdjacentHTML('beforeend', (needSep ? SEP_ROW : '') + html);
      }
    }
    if (liveProgressData) insertLiveRow();
    else ensureLiveProgress().then(insertLiveRow);

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
      if (input) { input.value = '377162882@sugas'; input.classList.remove('auth-shake'); }
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

/**
 * 显示隐私政策弹窗（全局函数，供 Footer 链接调用）
 */
function showPrivacyPolicy() {
  const modal = document.getElementById('privacy-policy-modal');
  if (modal) modal.style.display = 'flex';
}

/**
 * 显示用户协议弹窗（全局函数，供 Footer 链接调用）
 */
function showUserAgreement() {
  const modal = document.getElementById('user-agreement-modal');
  if (modal) modal.style.display = 'flex';
}
