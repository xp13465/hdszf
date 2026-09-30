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
  //   currentResult = 当前配置（本月至今（MTD），若已拿到进行中快照）
  //   lockedResult  = 锁定配置（同样含本月至今，保证与当前配置可比）
  //   frozenResult  = 当前配置的已定稿口径（截至最新完整月），仅用于 hover 对照
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

    // 总收益标题里的月数跟随口径（本月至今（MTD）时 +1 个月），避免写死「132个月」
    const totalLabel = document.getElementById('metric-total-label');
    if (totalLabel && m.totalMonths != null) totalLabel.textContent = `总收益（${m.totalMonths}个月）`;

    // 「本月至今（MTD）」悬浮说明
    if (LIVE_INFO) {
      const fr = (frozenResult && frozenResult.metrics) ? frozenResult.metrics : null;
      const p1 = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
      const p2 = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
      const L = `本月至今（${LIVE_INFO.month}）`;
      const B = `已定稿（${LIVE_INFO.baseMonth}）`;
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

  // --- 首屏 Hero 统计卡片（动态；有进行中快照时显示「本月至今（MTD）」，悬停可看已定稿值）---
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
        [`本月至今（${LIVE_INFO.month}）`, `¥${wan(m.finalValue)} · 累计 ${pct(m.total, 2)} · 年化 ${m.annual.toFixed(2)}%`],
        [`已定稿（${LIVE_INFO.baseMonth}）`, `¥${wan(f.finalValue)} · 累计 ${pct(f.total, 2)} · 年化 ${f.annual.toFixed(2)}%`]
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
        [`本月至今（${LIVE_INFO.month}）`, `${(m.monthlyWinRate * 100).toFixed(1)}%（赚钱 ${m.positiveMonths} / 共 ${m.totalMonths} 个月）`],
        [`已定稿（${LIVE_INFO.baseMonth}）`, `${(f.monthlyWinRate * 100).toFixed(1)}%（赚钱 ${f.positiveMonths} / 共 ${f.totalMonths} 个月）`]
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
        [`本月至今（${LIVE_INFO.month}）`, m.maxDd.toFixed(2) + '%'],
        [`已定稿（${LIVE_INFO.baseMonth}）`, f.maxDd.toFixed(2) + '%']
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
  // 滚动回测状态（声明上移：refreshLiveDisplay 在异步回调里会读到它们，避免 TDZ）
  let rollingReady = false;       // 首轮渲染已完成（弹窗绑定只做一次）
  let rollingModalInited = false;

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
    // 滚动回测：汇总表 / 完整持仓日志弹窗 / 折线图也要切到「本月至今（MTD）」口径
    if (rollingReady) rerunRollingLive();
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
      // 已定稿口径（截至最新完整月）：只用于 hover 提示里的对照值
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

    // 「本月至今（MTD）」悬浮说明（拿不到进行中快照时 tipLive 内部直接跳过）
    if (LIVE_INFO) {
      const pct = (v, d) => (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
      // 注意字段名：卡片对象用的是 dd（= maxDd），引擎 metrics 用的是 maxDd
      const line = (annual, total, dd) =>
        `年化 ${annual.toFixed(2)}% · 总收益 ${pct(total, 1)} · 回撤 ${dd.toFixed(2)}%`;
      const pairs = [[`本月至今（${LIVE_INFO.month}）`, line(data.annual, data.total, data.dd)]];
      if (data.frozen) {
        pairs.push([`已定稿（${LIVE_INFO.baseMonth}）`,
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

    // 初始回测（此时还没拿到进行中快照 → 先按已定稿口径渲染，避免数字闪动两遍）
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

    // 进行中月份进度快照：拿到后 ① 追加日志「🟡 进行中」行 ② 让引擎叠加该月并重渲染「含本月至今」指标
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

  // 折线图横轴口径（2026-09-30 用户要求「两套语义切换看」）：
  //   'date'   → x = 全局日历月序：「同一天，各起点的累计收益差多少」
  //   'tenure' → x = 入场后第 N 个月：「都持有到第 N 个月，各起点表现差多少」（曲线左对齐）
  // 两套都对，只是回答不同问题 → 交给用户切换，不替他选。刻度/提示文案随模式同步改写。
  let equityXMode = 'date';

  // 滚动回测统一渲染入口：已定稿与「本月至今（MTD）」都走这里，避免两条路径分叉
  function renderRollingAll() {
    rollingResults = RollingBacktest.runAll();
    renderRollingSummary(rollingResults);
    renderLiveProgressBlock(rollingResults);
    renderRollingEquityChart(rollingResults);
    if (!rollingModalInited) { initLogModal(); rollingModalInited = true; }
    rollingReady = true;
    bindTips();
  }

  // 进行中快照到达后重算（叠加层已在引擎上生效，这里只负责重新渲染）
  function rerunRollingLive() {
    try {
      renderRollingAll();
      // 弹窗开着就按新口径重渲染当前这条，避免屏幕上是旧数字
      const modal = document.getElementById('log-modal');
      if (modal && modal.style.display !== 'none') {
        const i = parseInt(modal.dataset.logIndex, 10);
        if (isFinite(i) && rollingResults[i]) showLogDetail(rollingResults[i], i);
      }
    } catch (e) {
      console.error('滚动回测（本月至今（MTD））重算失败:', e);
    }
  }

  function initRollingBacktest() {
    // 折线图横轴口径切换（「按日期看」/「按持有月数看」）
    const xSwitch = document.getElementById('equity-x-mode');
    if (xSwitch) {
      xSwitch.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn || !rollingResults) return;
        const mode = btn.dataset.mode;
        if (mode === equityXMode || (mode !== 'date' && mode !== 'tenure')) return;
        equityXMode = mode;
        [...xSwitch.querySelectorAll('[data-mode]')].forEach((b) => {
          const on = b.dataset.mode === mode;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        // 说明行跟着切换，避免图注与当前口径不符
        const noteDate = document.getElementById('equity-chart-note');
        const noteTenure = document.getElementById('equity-chart-note-tenure');
        if (noteDate) noteDate.style.display = mode === 'date' ? '' : 'none';
        if (noteTenure) noteTenure.style.display = mode === 'tenure' ? '' : 'none';
        renderRollingEquityChart(rollingResults);
      });
    }

    // 异步运行回测（避免阻塞UI）
    setTimeout(() => {
      try {
        renderRollingAll();
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

    // 显示口径：有本月至今数据（r.live）就用含本月至今结果，否则用固化结果
    const shown = results.map(r => r.live || r);

    // 找最佳值用于高亮（按显示口径，保证与页面数字一致）
    const bestAnnual = Math.max(...shown.map(r => r.annualReturn));
    const bestSharpe = Math.max(...shown.map(r => r.sharpe));
    const bestDD = Math.max(...shown.map(r => r.maxDrawdown)); // 最大回撤（最不负面）

    const rowsHTML = results.map((r, i) => {
      const isEstimated = r.hasEstimatedData;
      const d = shown[i];                      // 显示用指标（本月至今（MTD））
      const hasLive = !!r.live;
      const startLabel = r.startPoint.label;
      const yearsAgo = r.startPoint.yearsAgo;
      const buildMonths = r.startPoint.buildMonths || 12;

      // 本月至今（MTD） → 悬停对照已定稿值（与首屏 Hero / 三档卡同口径同提示）
      if (hasLive) {
        tipLive('roll-' + i, [
          ['本月至今 终值', '¥' + RollingBacktest.fmtMoney(d.finalValue)],
          ['已定稿 终值', '¥' + RollingBacktest.fmtMoney(r.finalValue)],
          ['本月至今 累计', RollingBacktest.fmtPct(d.totalReturn)],
          ['已定稿 累计', RollingBacktest.fmtPct(r.totalReturn)],
          ['本月至今 年化', d.annualReturn.toFixed(2) + '%'],
          ['已定稿 年化', r.annualReturn.toFixed(2) + '%'],
          ['本月至今 回撤', d.maxDrawdown.toFixed(2) + '%'],
          ['已定稿 回撤', r.maxDrawdown.toFixed(2) + '%'],
          ['本月至今 月胜率', d.winRate.toFixed(1) + '%'],
          ['已定稿 月胜率', r.winRate.toFixed(1) + '%'],
          ['回测月数', d.totalMonths + '（已定稿 ' + r.frozenMonths + '）']
        ]);
      } else {
        delete TIPS['roll-' + i];
      }

      // 高亮最佳值
      const annualClass = d.annualReturn === bestAnnual ? 'cell-positive' : (d.annualReturn >= 0 ? 'cell-positive' : 'cell-negative');
      const sharpeClass = d.sharpe === bestSharpe ? 'cell-positive' : '';
      const ddClass = d.maxDrawdown === bestDD ? 'cell-negative' : 'cell-negative';

      // 构建周期字符串 + 建仓方式（含本月至今时终点顺延到进行中月）
      const endYM = hasLive ? r.live.month : (RollingBacktest.CONFIG.endYear + '-' + String(RollingBacktest.CONFIG.endMonth).padStart(2, '0'));
      const endParts = endYM.split('-');
      const endLabel = endParts[0] + '年' + parseInt(endParts[1], 10) + '月';
      const periodStr = startLabel + ' → ' + endLabel;
      const liveTag = hasLive ? '<span class="live-tag tag-inline">含本月至今</span>' : '';
      const buildTag = buildMonths === 1
        ? '<span style="display:inline-block;background:#c53030;color:#fff;font-size:0.7rem;padding:2px 7px;border-radius:4px;font-weight:600;">⚡一次建仓</span>'
        : (r.startPoint.isComparison
          ? '<span style="display:inline-block;background:#e8890c;color:#fff;font-size:0.7rem;padding:2px 7px;border-radius:4px;font-weight:600;">🔶分批建仓(' + buildMonths + '次)</span>'
          : '<span style="display:inline-block;background:#5a9fd4;color:#fff;font-size:0.7rem;padding:2px 7px;border-radius:4px;">📅分批建仓(' + buildMonths + '次)</span>');
      // 月数 + 「含本月至今」小标 + 建仓方式挤在同一行，避免格子被撑高
      const buildStr = d.totalMonths + '个月' + liveTag + ' · ' + buildTag;

      return `
        <tr${hasLive ? ' data-tip-key="roll-' + i + '"' : ''}>
          <td class="cell-start">${startLabel}<br><small style="color:var(--color-text-muted)">${yearsAgo != null ? yearsAgo + '年前入场' : '数据最早月 · 完整回测'}</small></td>
          <td>${periodStr}<br><small style="color:var(--color-text-muted)">${buildStr}</small></td>
          <td class="${d.finalValue >= 500000 ? 'cell-positive' : 'cell-negative'}">¥${RollingBacktest.fmtMoney(d.finalValue)}</td>
          <td class="${d.totalReturn >= 0 ? 'cell-positive' : 'cell-negative'}">${RollingBacktest.fmtPct(d.totalReturn)}</td>
          <td class="${annualClass}">${d.annualReturn.toFixed(2)}%</td>
          <td class="${ddClass}">${d.maxDrawdown.toFixed(2)}%</td>
          <td class="${sharpeClass}">${d.sharpe.toFixed(4)}</td>
          <td>${d.winRate.toFixed(1)}%<br><small style="color:var(--color-text-muted);font-size:0.7rem;">年${d.yearWinRate.toFixed(0)}%</small></td>
          <td>${d.operationCount}次<br><small style="color:var(--color-text-muted);font-size:0.7rem;">${d.activeMonths}个月有交易</small></td>
          <td><span style="font-weight:600;">${(d.finalPosition * 100).toFixed(0)}%</span><br><small style="color:var(--color-text-muted);font-size:0.7rem;">期末仓位</small></td>
          <td class="${isEstimated ? 'cell-estimated' : 'cell-all-real'}">${isEstimated ? '⚠️含估计值' : '✓ 真实数据<br><small style="color:var(--color-text-muted);font-size:0.65rem;">真实模拟</small>'}</td>
          <td><button class="btn-detail" onclick="window.showRollingLog(${i})">📋 查看操作记录</button></td>
        </tr>
      `;
    }).join('');

    // ---- 表末追加「进行中月份」行 ----
    // 本表原本只按「N 年前入场」聚合，本月口径的差异只能靠悬停才看得出；
    // 单独成行后，访客在表内一眼就能找到最新数据（用户 2026-09-29 要求的「外部可见」）。
    // 取值：完整历史 · 一次建仓那条（results[0]，与首屏 Hero 同源）的 live 口径。
    let liveRowHTML = '';
    const refIdx = results.findIndex((r) => r.live && r.startPoint && r.startPoint.isEarliest);
    if (refIdx >= 0) {
      const ref = results[refIdx];
      const lv = ref.live;
      const lStart = ref.startPoint.label;
      const lParts = String(lv.month).split('-');
      const lPeriod = lStart + ' → ' + lParts[0] + '年' + parseInt(lParts[1], 10) + '月';
      const lBuildTag = (ref.startPoint.buildMonths === 1)
        ? '⚡一次建仓'
        : '📅分批建仓(' + ref.startPoint.buildMonths + '次)';
      tipLive('roll-live', [
        ['本月至今 终值', '¥' + RollingBacktest.fmtMoney(lv.finalValue)],
        ['已定稿 终值', '¥' + RollingBacktest.fmtMoney(ref.finalValue)],
        ['本月至今 累计', RollingBacktest.fmtPct(lv.totalReturn)],
        ['已定稿 累计', RollingBacktest.fmtPct(ref.totalReturn)],
        ['本月至今 年化', lv.annualReturn.toFixed(2) + '%'],
        ['已定稿 年化', ref.annualReturn.toFixed(2) + '%'],
        ['本月至今 回撤', lv.maxDrawdown.toFixed(2) + '%'],
        ['已定稿 回撤', ref.maxDrawdown.toFixed(2) + '%'],
        ['本月至今 月胜率', lv.winRate.toFixed(1) + '%'],
        ['已定稿 月胜率', ref.winRate.toFixed(1) + '%'],
        ['回测月数', lv.totalMonths + '（已定稿 ' + ref.frozenMonths + '）']
      ]);
      liveRowHTML = `
        <tr class="live-month-row" data-tip-key="roll-live">
          <td class="cell-start">🟡 进行中月份<br><small style="color:var(--color-text-muted)">${lv.month} · 截至 ${lv.asOf || '—'}</small></td>
          <td>${lPeriod}<br><small style="color:var(--color-text-muted)">${lv.totalMonths}个月<span class="live-tag tag-inline">含本月至今</span> · ${lBuildTag}</small></td>
          <td class="${lv.finalValue >= 500000 ? 'cell-positive' : 'cell-negative'}">¥${RollingBacktest.fmtMoney(lv.finalValue)}</td>
          <td class="${lv.totalReturn >= 0 ? 'cell-positive' : 'cell-negative'}">${RollingBacktest.fmtPct(lv.totalReturn)}</td>
          <td class="${lv.annualReturn >= 0 ? 'cell-positive' : 'cell-negative'}">${lv.annualReturn.toFixed(2)}%</td>
          <td class="cell-negative">${lv.maxDrawdown.toFixed(2)}%</td>
          <td>${lv.sharpe.toFixed(4)}</td>
          <td>${lv.winRate.toFixed(1)}%<br><small style="color:var(--color-text-muted);font-size:0.7rem;">年${lv.yearWinRate.toFixed(0)}%</small></td>
          <td>0次<br><small style="color:var(--color-text-muted);font-size:0.7rem;">本月不调仓</small></td>
          <td><span style="font-weight:600;">${(lv.finalPosition * 100).toFixed(0)}%</span><br><small style="color:var(--color-text-muted);font-size:0.7rem;">期末仓位</small></td>
          <td class="cell-estimated">本月至今<br><small style="color:var(--color-text-muted);font-size:0.65rem;">真实行情</small></td>
          <td><button class="btn-detail" onclick="window.showRollingLog(${refIdx})">📋 查看进行中月</button></td>
        </tr>`;
    } else {
      delete TIPS['roll-live'];
    }
    tbody.innerHTML = rowsHTML + liveRowHTML;
  }

  // ============================================================
  //  本月至今（MTD）明细块 —— 页面外部直接可见，无需点开「完整持仓日志」弹窗
  //   数据源：results[0].live.snapshot.assetDetails（完整历史 · 一次建仓，与首屏 Hero 同源）
  //   恒市值法仅在月末调仓 → 进行中月份不产生任何买卖；该月未定稿，不参与官方指标。
  //   无 live 数据（未取到 / 降级 / 基准月不匹配）时内容清空，整块由 body.has-live-estimate 隐藏。
  // ============================================================
  function renderLiveProgressBlock(results) {
    const titleEl = document.getElementById('live-progress-title');
    const bodyEl = document.getElementById('live-progress-body');
    const footEl = document.getElementById('live-progress-foot');
    if (!titleEl || !bodyEl || !footEl) return;

    const ref = (results || []).find((r) => r.live && r.startPoint && r.startPoint.isEarliest);
    if (!ref) { titleEl.innerHTML = ''; bodyEl.innerHTML = ''; footEl.innerHTML = ''; return; }

    const lv = ref.live;
    const snap = lv.snapshot;
    const details = snap.assetDetails || [];
    const cap = RollingBacktest.CONFIG.totalCapital;

    const money = (v) => '¥' + RollingBacktest.fmtMoney(v);
    // 涨红跌绿（A 股习惯），配色走 CSS 变量以适配三套皮肤
    const cls = (v) => (v > 0 ? 'up' : (v < 0 ? 'down' : ''));
    const signed = (v, d) => (v >= 0 ? '+' : '') + v.toFixed(d) + '%';

    titleEl.innerHTML =
      `🟡 ${lv.month} 本月至今（MTD）· 组合实时持仓` +
      `<span class="asof">数据截至 ${lv.asOf || '—'}（本月最后交易日收盘）· 与首屏统计卡同源</span>`;

    bodyEl.innerHTML = details.map((d) => {
      const mtdPct = ((d.monthReturn && d.monthReturn.value) || 0) * 100;
      const dev = (d.deviationFromTarget || 0) * 100;
      return `<tr>
        <td style="text-align:left;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${LIVE_ASSET_COLORS[d.asset] || '#94a3b8'};margin-right:4px;"></span>${d.asset}</td>
        <td>${(d.targetPct * 100).toFixed(0)}%</td>
        <td>${money(d.holdingBefore)}</td>
        <td class="${cls(mtdPct)}">${signed(mtdPct, 2)}</td>
        <td style="font-weight:600;">${money(d.holdingAfter)}</td>
        <td>${(d.actualPct * 100).toFixed(1)}%</td>
        <td class="${Math.abs(dev) > 5 ? 'warn' : ''}">${signed(dev, 1)}</td>
      </tr>`;
    }).join('');

    // 组合合计：月初市值 = 各资产 holdingBefore 之和（锚定月度基准）
    // ⚠️ 收益比例统一 ÷固定基准本金 50 万（项目铁律），不用「上月末总市值」当分母，
    //    这样月/年/累计各分段口径一致、可直接相加。
    const baseTotal = details.reduce((s, d) => s + d.holdingBefore, 0);
    const delta = snap.totalValue - baseTotal;
    const deltaPctBase = cap > 0 ? (delta / cap) * 100 : 0;
    const cumPctBase = cap > 0 ? (snap.totalValue / cap - 1) * 100 : 0;
    const yuan = (v) => (v >= 0 ? '+' : '-') + '¥' + Math.round(Math.abs(v)).toLocaleString('zh-CN');
    footEl.innerHTML = `<tr>
      <td style="text-align:left;">合计（组合）</td>
      <td>100%</td>
      <td>${money(baseTotal)}</td>
      <td class="${cls(deltaPctBase)}">${signed(deltaPctBase, 2)}<div style="font-size:0.66rem;font-weight:400;opacity:0.85;">${yuan(delta)}</div></td>
      <td>${money(snap.totalValue)}</td>
      <td>100%</td>
      <td>—</td>
    </tr>
    <tr>
      <td colspan="7" style="text-align:left;font-weight:500;background:transparent;border-top:none;">自 ${ref.startPoint.label} 入场累计 <b class="${cls(cumPctBase)}">${signed(cumPctBase, 2)}</b> · 第 ${snap.monthIndex} 个月 · 本月无交易（恒市值法仅在月末调仓）</td>
    </tr>`;
  }

  function renderRollingEquityChart(results) {
    const dom = document.getElementById('chart-rolling-equity');
    if (!dom || !results || results.length === 0) return;

    if (rollingCharts.equity) {
      rollingCharts.equity.dispose();
    }

    const chart = echarts.init(dom);
    rollingCharts.equity = chart;

    // 横轴口径 = **全局日历月序**（最早起点月 = 0），不是「各曲线自己的局部下标」。
    // ⚠️ 旧实现用局部下标 j：12 条曲线视觉上全部左对齐到 x=0，而刻度年份却按最早起点换算，
    //    两种语义打架 → 悬停最右侧（最新月份）只有最早起点那 1~2 条曲线有值（用户报的 bug）。
    //    正确形态：同一日历月上，各曲线从各自入场月延伸过来，都该有点。
    const basePoint = results[0].startPoint;   // 最早起点（2015-08）→ 全局月序 0
    const toGlobalX = (ym) => {
      const [y, m] = String(ym).split('-').map(Number);
      return (y - basePoint.year) * 12 + (m - basePoint.month);
    };
    const xToYm = (x) => {
      const totalM = basePoint.month - 1 + x;
      return { y: basePoint.year + Math.floor(totalM / 12), m: (totalM % 12) + 1 };
    };

    // 两套横轴口径共用同一份数据，只是 x 的算法不同（由 equityXMode 决定，见文件上方说明）
    const isTenure = equityXMode === 'tenure';

    // 调色板：一次建仓=红色系，分批建仓=蓝绿渐深
    const offsets = [];                        // 各曲线的全局起点月序（date 模式：x = offsets[i] + j）
    const lengths = [];                        // 各曲线的点数上限（tenure 模式：x = j，末点 = lengths[i]）
    const series = results.map((r, i) => {
      const snapshots = r.monthlySnapshots;
      const offset = snapshots.length ? toGlobalX(snapshots[0].month) : toGlobalX(r.startPoint.key);
      offsets.push(offset);
      lengths.push(snapshots.length);
      const data = [];
      for (let j = 0; j < snapshots.length; j++) {
        const x = isTenure ? j : offset + j;
        data.push([x, (snapshots[j].totalValue / RollingBacktest.CONFIG.totalCapital - 1) * 100]);
      }

      // 本月至今（MTD）（live overlay）：把进行中月作为末点接上。
      // 该点是 本月至今 MTD，末端用空心圆标出，与固化月区分（表头说明行 + 悬停提示同步解释）。
      let liveCoord = null;
      if (r.live) {
        liveCoord = [
          isTenure ? snapshots.length : toGlobalX(r.live.month),
          (r.live.finalValue / RollingBacktest.CONFIG.totalCapital - 1) * 100,
        ];
        data.push(liveCoord);
      }

      const isEarliest = r.startPoint.isEarliest;
      const isComparison = r.startPoint.isComparison;
      const depth = (isEarliest || isComparison) ? 0 : (r.startPoint.yearsAgo / 10);
      const lineColor = isEarliest
        ? '#c53030'
        : (isComparison ? '#e8890c' : `hsl(${200 + depth * 30}, ${60 - depth * 20}%, ${45 + depth * 20}%)`);

      return {
        name: r.startPoint.label + (r.hasEstimatedData ? ' ⚠️' : '') + (isComparison ? ' 分批' : (isEarliest ? ' 一次' : '')),
        type: 'line',
        data: data,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          width: isEarliest ? 3 : (isComparison ? 2 : 1.5),
          color: lineColor,
          type: isComparison ? 'dashed' : 'solid'
        },
        emphasis: { focus: 'series' },
        // 终点打点：最早起点用 pin（带 +X% 标签，含本月至今时自动落在估算点上）；
        // 其余起点含本月至今时用空心圆，标出「这个末点是本月至今」
        markPoint: isEarliest ? {
          data: [{
            name: '终点',
            coord: [data[data.length - 1][0], data[data.length - 1][1]],
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
        } : (liveCoord ? {
          data: [{ coord: liveCoord, symbol: 'emptyCircle', symbolSize: 7, itemStyle: { color: lineColor, borderColor: lineColor, borderWidth: 2 } }],
          label: { show: false },
          animation: false
        } : undefined)
      };
    });

    // 进行中月的位置：date 模式下所有曲线末点共用同一个 x；tenure 模式下各曲线在自己的持有期上收尾
    const liveRes = results.find((r) => r.live);
    const liveX = (!isTenure && liveRes) ? toGlobalX(liveRes.live.month) : null;

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
          const x = params[0].axisValue;
          // 表头 = 当前口径下的横轴含义
          let html;
          if (isTenure) {
            html = `<strong>入场后第 ${x + 1} 个月</strong>`;
          } else {
            const { y, m } = xToYm(x);
            html = `<strong>${y}年${m}月</strong>`;
          }
          // 该 x 上是否存在「本月至今」点：date 模式看全局末点；tenure 模式各曲线在自己的持有期上收尾
          const liveHere = isTenure
            ? params.some((p) => x === lengths[p.seriesIndex])
            : (liveX !== null && x === liveX);
          html += `<span style="color:#999;">　${params.length} 个起点${liveHere ? ' · 本月至今（MTD）' : ''}</span><br/>`;
          params.sort((a, b) => b.value[1] - a.value[1]);
          for (const p of params) {
            // 每行附**另一套口径**的对照：date 模式标持有月数，tenure 模式标对应日历月
            const other = isTenure
              ? (() => { const t = xToYm(offsets[p.seriesIndex] + x); return `${t.y}年${t.m}月`; })()
              : `入场后第${x - offsets[p.seriesIndex] + 1}个月`;
            const isLiveP = isTenure ? (x === lengths[p.seriesIndex]) : (liveX !== null && x === liveX);
            html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px;"></span>`;
            html += `${p.seriesName}: <strong>${p.value[1] >= 0 ? '+' : ''}${p.value[1].toFixed(1)}%</strong>`;
            html += `<span style="color:#999;">　${other}${isLiveP && isTenure ? '（本月至今）' : ''}</span><br/>`;
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
        name: isTenure ? '入场后时长' : '日历时间',
        nameTextStyle: { fontSize: 11, color: '#aaa' },
        axisLabel: {
          fontSize: 10, color: '#999',
          formatter: function(v) {
            if (v % 12 !== 0) return '';
            if (isTenure) return v === 0 ? '入场' : `第${v / 12}年`;
            // date 模式：v 是全局月序 → 换算出的年份对**所有**曲线都成立
            return xToYm(v).y + '年';
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
  //          指标都显示「本月至今 MTD」值，鼠标悬停可看「截至上月末的已定稿值」。
  //     取不到数据 / 非进行中 / 基准月与主数据末月不符 → 全部退回已定稿口径，静默降级。
  //     正式月末定稿仍由 scripts/monthly_update.js 写入 data.js 主回测。
  // ============================================================
  let liveProgressData = null;
  let LIVE_INFO = null;          // { month, asOf, baseMonth } —— 有本月至今数据时才非空
  let liveProgressPromise = null;

  // 资产配色（与弹窗日志表格一致），用于「本月至今」明细块
  const LIVE_ASSET_COLORS = {
    '沪深300': '#3b82f6', '中证500': '#60a5fa',
    '标普500': '#06b6d4', '纳斯达克100': '#22d3ee',
    '黄金': '#c9a84c', '现金·货币基金': '#94a3b8'
  };

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
          // 降级快照（本月行情取数不完整、估算字段为 null）→ 一律不展示任何估算：
          // 不叠加 live overlay、不加 🟡 角标、不插日志末行，站点回退到已定稿口径。
          // 若照常展示，会把「当月持平」这种由 0 拼出来的假数字当成估算发到全站
          // （项目铁律：不凭空造月收益）。
          if (d.degraded) {
            console.warn('[progress] 进度快照为降级状态（' + (d.in_progress_month || '?') +
              ' 行情取数不完整）→ 不展示本月至今数据，回退到已定稿口径');
            return d;
          }
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
  // 自动多算一个月「本月至今 MTD」，与 progress.json 的 est_total、日志末行完全同源。
  // ⚠️ 该叠加月不触发再平衡，故结果严格等于「上月末持仓 × (1+MTD)」。
  function applyLiveOverlay(d) {
    if (d.degraded) return null;      // 降级快照不含真实 MTD → 绝不叠加（双保险）
    const returns = {};
    for (const a of d.assets) {
      const raw = (a.mtd_raw != null) ? a.mtd_raw : a.mtd;
      // ⚠️ 必须显式拦住空值：Number(null) === 0 会把「没有数据」当成「当月持平」
      if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
      const n = Number(raw);
      if (!isFinite(n)) return null;      // 任一资产数值异常 → 整体不启用，宁可不显示
      // mtd_raw 是小数收益率；旧字段 mtd 是百分比 → 两者口径不同，不能混用
      returns[a.name] = (a.mtd_raw != null) ? n : n / 100;
    }
    const payload = {
      month: d.in_progress_month,
      asOf: d.data_as_of || '',
      returns
    };
    const applied = BacktestEngine.setLiveOverlay(payload);
    if (!applied) return null;
    // 滚动引擎（弹窗顶部汇总 / 滚动汇总表 / 折线图）用同一份 MTD，字段名不同（mtd）
    if (typeof RollingBacktest !== 'undefined') {
      RollingBacktest.setLiveOverlay({
        month: payload.month,
        asOf: payload.asOf,
        mtd: Object.assign({}, returns)
      });
    }
    LIVE_INFO = { month: applied.month, asOf: applied.asOf, baseMonth: applied.baseMonth };
    return LIVE_INFO;
  }

  // 滚动汇总表里每个「查看操作记录」按钮打上 🟡 角标，提示日志内含进行中数据
  // 用 body 级 class + CSS 伪元素实现（而非逐个按钮加 class），
  // 这样"先取到进度、后渲染按钮"或"重算后重建按钮"都不会丢角标
  function markLiveBadges(d) {
    document.body.classList.add('has-live-progress');
    document.querySelectorAll('.btn-detail').forEach((b) => {
      b.title = `${d.in_progress_month} 尚在进行中（本月至今 MTD），已追加为日志末行`;
    });
  }

  // ============================================================
  //  站内通用「悬浮说明」层（本月至今（MTD） vs 截至上月末固化）
  //  —— 元素加 data-tip-key，内容由 tipLive() 写入 TIPS 表；
  //     没拿到进行中快照（TIPS 为空）时不显示任何提示，也不显示「含本月至今」小标。
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
      `<div class="tip-title">🟡 含 ${LIVE_INFO.month} 本月至今（MTD）</div>` +
      rows +
      `<div class="tip-note">本月至今 = 真实已发生的每日行情累积，数据截至 ${LIVE_INFO.asOf || '—'}（本月最后交易日收盘）。` +
      `该月尚未定稿（恒市值法仅在月末调仓），故不计入官方回测指标 —— 官方口径为「已定稿（${LIVE_INFO.baseMonth}）」。` +
      `月末定稿后本行会被替换为月末正式数据。</div>`;
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

  // 板块级说明行（只在有进行中数据时显示，由 body.has-live-estimate 控制显隐）
  function renderLiveNotes() {
    if (!LIVE_INFO) return;
    const tail = `本月至今（MTD，数据截至 ${LIVE_INFO.asOf || '—'}，真实已发生行情）。` +
      `该月尚未定稿，故官方回测口径仍为「已定稿（${LIVE_INFO.baseMonth}）」；鼠标移到卡片上可对比两者。`;
    const hero = document.getElementById('hero-live-note');
    if (hero) hero.innerHTML = `🟡 上方统计卡已含 <b>${LIVE_INFO.month}</b> ${tail}`;
    const bt = document.getElementById('backtest-live-note');
    if (bt) bt.innerHTML = `🟡 以下指标与曲线已含 <b>${LIVE_INFO.month}</b> ${tail}`;
    const cmp = document.getElementById('compare-live-note');
    if (cmp) {
      cmp.innerHTML = `🟡 上方三档卡片的年化 / 总收益已含 <b>${LIVE_INFO.month}</b> 本月至今（MTD，数据截至 ${LIVE_INFO.asOf || '—'}）；` +
        `下方「数据说明」中的年化与回撤为「已定稿（${LIVE_INFO.baseMonth}）」口径。悬停卡片可对比两者。`;
    }
    const roll = document.getElementById('rolling-live-note');
    if (roll) {
      roll.innerHTML = `🟡 下方汇总表、曲线<b>末点</b>、表末「进行中月份」行、以及本月至今明细块，均为 <b>${LIVE_INFO.month}</b> 本月至今（MTD，数据截至 ${LIVE_INFO.asOf || '—'}）；` +
        `悬停任意一行可看「已定稿（${LIVE_INFO.baseMonth}）」对照。` +
        `弹窗内「完整持仓日志」正文与 CSV 导出仍为已定稿口径，仅额外标注一行「🟡 进行中」。`;
    }
    const lp = document.getElementById('live-progress-note');
    if (lp) {
      lp.innerHTML = `🟡 上表是 <b>${LIVE_INFO.month}</b> 本月至今（MTD）的实时持仓，数据截至 <b>${LIVE_INFO.asOf || '—'}</b> —— ` +
        `由每日真实行情累积得出，不是预测值。因其月末尚未收口、且恒市值法只在月末调仓，故<b>本月不产生任何买卖</b>，` +
        `也不计入官方回测指标；月末定稿后再由月度更新流程写入正式回测数据。` +
        `<br>注：恒定市值法把每个风险资产的目标市值钉死，超额收益持续切出到「现金·货币基金」池，` +
        `因此现金的「偏离目标」天然为正且会逐年放大（属正常现象，非异常）。`;
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
    // 顶部汇总口径：拿到本月至今数据（result.live）就显示「含本月至今」，悬停看固化对照；
    // 否则纯固化展示。与首屏 Hero / 三档卡 / 滚动汇总表同一套口径与提示。
    const dsum = result.live || result;
    const hasLive = !!result.live;
    if (hasLive) {
      tipLive('log-months', [
        ['本月至今 回测月数', dsum.totalMonths + ' 个月'],
        ['已定稿 回测月数', result.totalMonths + ' 个月'],
        ['进行中月', result.live.month + '（第 ' + result.live.snapshot.monthIndex + ' 个月）']
      ]);
      tipLive('log-final', [
        ['本月至今 最终市值', '¥' + RollingBacktest.fmtMoney(dsum.finalValue)],
        ['已定稿 最终市值', '¥' + RollingBacktest.fmtMoney(result.finalValue)],
        ['本月至今 累计收益', RollingBacktest.fmtPct(dsum.totalReturn)],
        ['已定稿 累计收益', RollingBacktest.fmtPct(result.totalReturn)]
      ]);
      tipLive('log-annual', [
        ['本月至今 年化收益', dsum.annualReturn.toFixed(2) + '%'],
        ['已定稿 年化收益', result.annualReturn.toFixed(2) + '%'],
        ['本月至今 月胜率', dsum.winRate.toFixed(1) + '%'],
        ['已定稿 月胜率', result.winRate.toFixed(1) + '%']
      ]);
      tipLive('log-dd', [
        ['本月至今 最大回撤', dsum.maxDrawdown.toFixed(2) + '%'],
        ['已定稿 最大回撤', result.maxDrawdown.toFixed(2) + '%']
      ]);
    } else {
      ['log-months', 'log-final', 'log-annual', 'log-dd'].forEach((k) => delete TIPS[k]);
    }

    const summaryHTML = `
      <div class="log-summary">
        <div class="log-summary-item">
          <div class="label">起点</div>
          <div class="value accent">${result.startPoint.label}</div>
        </div>
        <div class="log-summary-item"${hasLive ? ' data-tip-key="log-months"' : ''}>
          <div class="label">回测月数${hasLive ? '<span class="live-tag tag-inline">含本月至今</span>' : ''}</div>
          <div class="value">${dsum.totalMonths}个月</div>
        </div>
        <div class="log-summary-item"${hasLive ? ' data-tip-key="log-final"' : ''}>
          <div class="label">最终市值${hasLive ? '<span class="live-tag tag-inline">含本月至今</span>' : ''}</div>
          <div class="value ${dsum.finalValue >= 500000 ? 'green' : 'red'}">¥${RollingBacktest.fmtMoney(dsum.finalValue)}</div>
        </div>
        <div class="log-summary-item"${hasLive ? ' data-tip-key="log-final"' : ''}>
          <div class="label">总收益率${hasLive ? '<span class="live-tag tag-inline">含本月至今</span>' : ''}</div>
          <div class="value ${dsum.totalReturn >= 0 ? 'green' : 'red'}">${RollingBacktest.fmtPct(dsum.totalReturn)}</div>
        </div>
        <div class="log-summary-item"${hasLive ? ' data-tip-key="log-annual"' : ''}>
          <div class="label">年化收益${hasLive ? '<span class="live-tag tag-inline">含本月至今</span>' : ''}</div>
          <div class="value ${dsum.annualReturn >= 0 ? 'green' : 'red'}">${dsum.annualReturn.toFixed(2)}%</div>
        </div>
        <div class="log-summary-item"${hasLive ? ' data-tip-key="log-dd"' : ''}>
          <div class="label">最大回撤${hasLive ? '<span class="live-tag tag-inline">含本月至今</span>' : ''}</div>
          <div class="value red">${dsum.maxDrawdown.toFixed(2)}%</div>
        </div>
        <div class="log-summary-item">
          <div class="label">总操作次数</div>
          <div class="value accent">${dsum.operationCount}次</div>
        </div>
        <div class="log-summary-item">
          <div class="label">数据质量</div>
          <div class="value ${result.hasEstimatedData ? 'red' : 'green'}">${result.hasEstimatedData ? '⚠️含估计值' : '✓全部真实'}</div>
        </div>
      </div>
      ${(hasLive && LIVE_INFO) ? `<div class="live-note-line" style="display:block;margin-top:0.6rem;">` +
        `🟡 上方汇总的「回测月数 / 最终市值 / 总收益率 / 年化收益 / 最大回撤」已含 <b>${LIVE_INFO.month}</b> 本月至今` +
        `（MTD，数据截至 ${LIVE_INFO.asOf || '—'}，真实已发生行情）。下方持仓明细正文与 CSV 导出仍为「已定稿（${LIVE_INFO.baseMonth}）」口径，` +
        `仅额外标注一行「🟡 进行中」；悬停任一汇总项可对比两者。</div>` : ''}
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
    //  进行中月份行（本月至今 MTD）—— 追加到日志末行，数据源 js/progress.json
    //  口径：
    //    · 各资产「本月至今现值」= 该次回测末月持仓 × (1 + 该资产本月至今 MTD%)
    //      （progress.json 只提供 MTD%，持仓取本次回测自身，因此任意起点都能自洽）
    //    · 收益比例一律 ÷ 固定基准本金 50 万（与「累计收益」「年度收益率」两列同口径）
    //    · 无操作（恒市值法在月末才调仓，进行中不产生任何买卖）
    //  ⚠️ 仅供进度参考，不参与任何官方回测指标（年化/回撤/胜率仍截至基准月）
    // ============================================================
    function buildLiveRows(d) {
      const snaps = result.monthlySnapshots;
      if (!snaps.length) return '';
      const last = snaps[snaps.length - 1];
      // 叠加层由滚动引擎统一产出（RollingBacktest.setLiveOverlay → result.live）。
      // 这里只负责渲染，不再本地复算 MTD —— 否则同一弹窗内会出现两套数字
      // （旧实现用 2 位小数的 progress.mtd，比引擎的 mtd_raw 差几元）。
      const liveOv = result.live;
      if (!liveOv || !liveOv.snapshot) return '';
      // 基准月必须正好是日志最后一个完整月，否则说明数据已定稿 / 不同步 → 不展示
      if (!d.base_month || d.base_month !== last.month) return '';

      const liveSnap = liveOv.snapshot;
      const mtdMap = {};
      const est = {};
      liveSnap.assetDetails.forEach((ad) => {
        const mr = ad.monthReturn;
        const v = (mr && typeof mr === 'object') ? (mr.value || 0) : (mr || 0);
        mtdMap[ad.asset] = v * 100;        // 百分比（与列头「月收益率」同显示口径）
        est[ad.asset] = ad.holdingAfter;
      });
      const estTotal = liveOv.finalValue;  // = Σ holdingAfter（引擎口径，含 mtd_raw 全精度）

      const baseCapital = RollingBacktest.CONFIG.totalCapital || 500000;
      const targetValMap = {};
      const targetPctMap = {};
      last.assetDetails.forEach((ad) => {
        targetValMap[ad.asset] = ad.targetVal;
        targetPctMap[ad.asset] = ad.targetPct;
      });

      const liveMonth = liveOv.month || d.in_progress_month || '';
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
      const cumNo = liveSnap.monthIndex;          // 累计月序（入场月 = 第 1 个月，由引擎给出）
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
        const pctOfTotal = estTotal > 0 ? ((est[name] || 0) / estTotal) : 0;
        const dev = (pctOfTotal - (targetPctMap[name] || 0)) * 100;

        html += '<tr class="live-month-row">';

        if (ai === 0) {
          html += `<td rowspan="6" style="font-weight:700;color:var(--color-warning,#c05600);">${liveMonth}` +
            `<div style="font-size:0.66rem;font-weight:600;opacity:0.9;">🟡 进行中</div></td>`;
          html += `<td rowspan="6" style="color:var(--color-warning,#c05600);font-weight:600;">进行中` +
            `<div style="font-size:0.64rem;font-weight:400;opacity:0.85;">本月至今</div></td>`;
        }

        html += `<td style="text-align:left;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ASSET_COLORS[name]};margin-right:4px;"></span>${name}</td>`;
        html += `<td style="font-weight:600;">¥${(targetValMap[name] || 0).toFixed(0)}</td>`;
        html += `<td>¥${(last.holdings[name] || 0).toFixed(0)}</td>`;
        html += `<td class="${mRowCls}">${m >= 0 ? '+' : ''}${m.toFixed(2)}%</td>`;
        html += `<td style="font-weight:600;">¥${(est[name] || 0).toFixed(0)}</td>`;
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
          // 累计收益：第 N 个月 + 比例 + 金额（均为本月至今口径，÷固定基准 50 万）
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
        <span style="color:var(--color-warning,#c05600);">🟡 进行中行 = 本月至今 MTD（真实已发生行情；该月尚未定稿，不参与官方指标）</span>
        <span style="color:var(--color-success);">🔴 买入（涨）</span>
        <span style="color:var(--color-danger);">🟢 卖出（跌）</span>
        <span>— = 无操作</span>
        <span>偏离≥±5% → 触发调仓</span>
        <span>收益比例口径：÷固定基准本金 ¥50 万（进行中行亦然，故与各段收益可加）</span>
      </div>
    `;

    body.innerHTML = summaryHTML + tableHTML;
    bindTips(body);   // 弹窗内容每次重建 → 需重新绑定汇总项的悬停说明
    modal.style.display = 'flex';

    // ---- 进行中月份（本月至今 MTD）行：追加到表格首/末（跟随排序方向）----
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
