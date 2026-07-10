/**
 * 分享图生成模块
 * 使用 Canvas 生成带水印和二维码的回测结果分享图，用户可下载/分享
 */

const ShareImage = (() => {
  'use strict';

  // 画布尺寸（3:4 竖版，适合社交媒体）
  const WIDTH = 750;
  const HEIGHT = 1000;

  // 网站 URL（用于生成二维码）
  const SITE_URL = 'https://hdszftools-ujpzw01zm.maozi.io/';

  // 品牌色
  const COLORS = {
    bg: '#1a3555',
    cardBg: '#ffffff',
    accent: '#b8860b',
    red: '#c53030',
    green: '#1a7d3a',
    white: '#ffffff',
    text: '#1a1a2e',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#e8e8ed',
  };

  /**
   * 在 Canvas 上逐个像素绑制二维码
   * 使用 qrcode-generator 的 getModuleCount/isDark API，完全同步，无异步问题
   */
  function drawQRPixels(ctx, x, y, size, url) {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();

      const moduleCount = qr.getModuleCount();
      const cellSize = Math.floor(size / moduleCount);
      const offset = Math.floor((size - cellSize * moduleCount) / 2);

      // 先画白色背景
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + offset - 2, y + offset - 2, cellSize * moduleCount + 4, cellSize * moduleCount + 4);

      // 逐格绘制暗色模块
      ctx.fillStyle = '#000000';
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(row, col)) {
            ctx.fillRect(
              x + offset + col * cellSize,
              y + offset + row * cellSize,
              cellSize,
              cellSize
            );
          }
        }
      }
    } catch (e) {
      console.error('二维码绘制失败:', e);
      // 绘制错误占位
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = '#c53030';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('QR 生成失败', x + size/2, y + size/2 + 6);
    }
  }

  /**
   * 绘制圆角矩形
   */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /**
   * 绘制指标卡片
   */
  function drawMetricCard(ctx, x, y, w, h, label, value, color, isHighlight) {
    ctx.fillStyle = isHighlight ? '#fef9e7' : '#f8f9fa';
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();

    if (isHighlight) {
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, y, w, h, 8);
      ctx.stroke();
    }

    ctx.fillStyle = COLORS.textMuted;
    ctx.font = '13px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + 28);

    ctx.fillStyle = color || COLORS.text;
    ctx.font = `bold ${isHighlight ? '26' : '22'}px -apple-system, "Noto Sans SC", sans-serif`;
    ctx.fillText(value, x + w / 2, y + h - 18);
  }

  /**
   * 绘制资产分配条
   */
  function drawAllocBar(ctx, x, y, w, name, pct, color) {
    const barH = 22;
    const barY = y;

    // 资产名称 — 白色，深蓝底上可见
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '14px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(name, x, barY + barH / 2 + 5);

    const barX = x + 130;
    const barW = w - 200;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    roundRect(ctx, barX, barY + 4, barW, barH - 8, 4);
    ctx.fill();

    ctx.fillStyle = color;
    roundRect(ctx, barX, barY + 4, Math.max(barW * pct / 100, 4), barH - 8, 4);
    ctx.fill();

    // 百分比 — 白色加粗
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 13px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, x + w - 5, barY + barH / 2 + 5);
  }

  /**
   * 在分享图上绘制二维码区块（白底卡片 + QR + 说明）
   */
  function drawQRBlock(ctx, x, y, size, url, label) {
    // 白色背景卡片
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    roundRect(ctx, x - 10, y - 10, size + 20, size + 32, 10);
    ctx.fill();

    // 绘制二维码
    drawQRPixels(ctx, x, y, size, url);

    // 文字说明
    if (label) {
      ctx.fillStyle = COLORS.textSecondary;
      ctx.font = '10px -apple-system, "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + size/2, y + size + 18);
    }
  }

  /**
   * 生成 Hero 宣传海报
   */
  function generateHeroCard() {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    // 背景
    const bgGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    bgGrad.addColorStop(0, '#1a3555');
    bgGrad.addColorStop(0.6, '#2a4a7f');
    bgGrad.addColorStop(1, '#1a3555');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 顶部装饰线
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(0, 0, WIDTH, 3);

    // 标题区域
    ctx.fillStyle = COLORS.white;
    ctx.font = 'bold 38px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('恒市值法', WIDTH / 2, 100);

    ctx.font = 'bold 36px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('智能资产配置', WIDTH / 2, 150);

    // 副标题
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '18px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('不盯盘 · 不择时 · 每月5分钟', WIDTH / 2, 190);

    // 核心数据卡片
    const cardY = 230;
    const cardW = 200;
    const cardH = 80;
    const cardGap = 20;
    const cards = [
      { label: '年化收益', value: '7.60%', color: COLORS.red },
      { label: '最大回撤', value: '-6.09%', color: COLORS.green },
      { label: '月胜率', value: '67.9%', color: COLORS.red },
    ];
    const totalCardsW = cards.length * cardW + (cards.length - 1) * cardGap;
    const startX = (WIDTH - totalCardsW) / 2;

    cards.forEach((c, i) => {
      const cx = startX + i * (cardW + cardGap);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      roundRect(ctx, cx, cardY, cardW, cardH, 10);
      ctx.fill();

      ctx.fillStyle = COLORS.textMuted;
      ctx.font = '13px -apple-system, "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(c.label, cx + cardW / 2, cardY + 28);

      ctx.fillStyle = c.color;
      ctx.font = 'bold 26px -apple-system, "Noto Sans SC", sans-serif';
      ctx.fillText(c.value, cx + cardW / 2, cardY + 62);
    });

    // 回测数据亮点
    const highlightY = 350;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, 40, highlightY, WIDTH - 80, 130, 12);
    ctx.fill();

    const highlights = [
      { label: '回测周期', value: '11年 (2015-2026)' },
      { label: '初始资金', value: '50万 → 111.2万' },
      { label: '数据来源', value: '35,000+条基金净值' },
      { label: '覆盖资产', value: 'A股·美股·黄金·现金' },
    ];

    highlights.forEach((h, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const hx = 80 + col * 320;
      const hy = highlightY + 25 + row * 45;

      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '13px -apple-system, "Noto Sans SC", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(h.label, hx, hy);

      ctx.fillStyle = COLORS.white;
      ctx.font = 'bold 16px -apple-system, "Noto Sans SC", sans-serif';
      ctx.fillText(h.value, hx, hy + 25);
    });

    // 稳健型配置
    const configY = 520;
    ctx.fillStyle = COLORS.white;
    ctx.font = 'bold 20px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⭐ 推荐配置：稳健型', WIDTH / 2, configY);

    const allocs = [
      { name: '沪深300', pct: 15, color: '#3b82f6' },
      { name: '中证500', pct: 5, color: '#60a5fa' },
      { name: '标普500', pct: 15, color: '#06b6d4' },
      { name: '纳斯达克100', pct: 20, color: '#22d3ee' },
      { name: '黄金', pct: 20, color: '#c9a84c' },
      { name: '现金·货币基金', pct: 25, color: '#94a3b8' },
    ];

    allocs.forEach((a, i) => {
      drawAllocBar(ctx, 60, configY + 20 + i * 38, WIDTH - 120, a.name, a.pct, a.color);
    });

    // ── 底部：二维码 + CTA ──
    const qrSize = 110;
    const qrX = 50;
    const qrY = 780;
    drawQRBlock(ctx, qrX, qrY, qrSize, SITE_URL, '扫码体验');

    // 右侧 CTA 文字
    const ctaX = qrX + qrSize + 30;
    let ctaY = qrY + 5;

    ctx.fillStyle = COLORS.white;
    ctx.font = 'bold 18px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('免费在线回测', ctaX, ctaY + 18);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('科学配置你的投资组合', ctaX, ctaY + 42);

    ctx.fillStyle = COLORS.accent;
    ctx.font = 'bold 14px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('hdszftools-ujpzw01zm', ctaX, ctaY + 70);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('.maozi.io', ctaX, ctaY + 88);

    // 底部品牌
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('hdszf 恒市值法智能理财助手 | hdszftools', WIDTH / 2, HEIGHT - 50);

    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '11px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('历史回测不代表未来表现 · 投资有风险 入市需谨慎', WIDTH / 2, HEIGHT - 28);

    // 底部装饰线
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(0, HEIGHT - 3, WIDTH, 3);

    return canvas;
  }

  /**
   * 生成回测结果分享图
   */
  function generateResultCard() {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    // 获取当前回测结果
    let currentResult;
    try {
      const sliderValues = SliderPanel.getValues();
      currentResult = BacktestEngine.compute(sliderValues);
    } catch (e) {
      currentResult = BacktestEngine.getDefaultResult();
    }
    const m = currentResult.metrics;
    const alloc = currentResult.alloc || {};

    // 背景
    const bgGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    bgGrad.addColorStop(0, '#0f1f33');
    bgGrad.addColorStop(0.5, '#1a3555');
    bgGrad.addColorStop(1, '#0f1f33');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(0, 0, WIDTH, 3);

    // 标题
    ctx.fillStyle = COLORS.white;
    ctx.font = 'bold 32px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('我的恒市值法回测结果', WIDTH / 2, 70);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '16px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('131个月真实数据验证 · 恒市值法月度再平衡', WIDTH / 2, 105);

    // 核心指标
    const metricCards = [
      { label: '年化收益', value: m.annual.toFixed(2) + '%', color: m.annual >= 0 ? COLORS.red : COLORS.green, hl: true },
      { label: '总收益率', value: m.total.toFixed(1) + '%', color: m.total >= 0 ? COLORS.red : COLORS.green },
      { label: '最大回撤', value: m.maxDd.toFixed(2) + '%', color: COLORS.green },
      { label: 'Sharpe比率', value: m.sharpe.toFixed(4), color: COLORS.text },
      { label: 'Sortino比率', value: m.sortino.toFixed(4), color: COLORS.text },
      { label: '月胜率', value: m.winRate ? m.winRate.toFixed(1) + '%' : '67.9%', color: COLORS.red },
    ];

    const mCardW = 210;
    const mCardH = 78;
    const mGapX = 18;
    const mGapY = 14;
    const mStartX = (WIDTH - (3 * mCardW + 2 * mGapX)) / 2;
    const mStartY = 135;

    metricCards.forEach((mc, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      drawMetricCard(
        ctx,
        mStartX + col * (mCardW + mGapX),
        mStartY + row * (mCardH + mGapY),
        mCardW, mCardH,
        mc.label, mc.value, mc.color, mc.hl
      );
    });

    // 配置明细
    const allocY = mStartY + 2 * (mCardH + mGapY) + 25;
    ctx.fillStyle = COLORS.white;
    ctx.font = 'bold 18px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('当前资产配置', WIDTH / 2, allocY);

    const assetColors = {
      '沪深300': '#3b82f6', '中证500': '#60a5fa',
      '标普500': '#06b6d4', '纳斯达克100': '#22d3ee',
      '黄金': '#c9a84c', '现金·货币基金': '#94a3b8',
    };

    const assetOrder = ['沪深300', '中证500', '标普500', '纳斯达克100', '黄金', '现金·货币基金'];
    assetOrder.forEach((name, i) => {
      const pct = Math.round((alloc[name] || 0) * 100);
      drawAllocBar(ctx, 50, allocY + 18 + i * 38, WIDTH - 100, name, pct, assetColors[name] || '#ccc');
    });

    // ── 底部：二维码 + 引导 ──
    const qrSize = 100;
    const qrX = 55;
    const qrY = 800;
    drawQRBlock(ctx, qrX, qrY, qrSize, SITE_URL, '扫码体验');

    // 右侧引导
    const txtX = qrX + qrSize + 30;
    let txtY = qrY;

    ctx.fillStyle = COLORS.white;
    ctx.font = 'bold 18px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('免费在线回测', txtX, txtY + 24);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '13px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('动手调整你的资产配置', txtX, txtY + 48);

    ctx.fillStyle = COLORS.accent;
    ctx.font = 'bold 14px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('hdszftools-ujpzw01zm', txtX, txtY + 78);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('.maozi.io', txtX, txtY + 96);

    // 免责
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '11px -apple-system, "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('历史回测不代表未来表现 · 投资有风险', WIDTH / 2, HEIGHT - 50);

    // 品牌
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '12px -apple-system, "Noto Sans SC", sans-serif';
    ctx.fillText('hdszf · 恒市值法智能理财助手 · hdszftools', WIDTH / 2, HEIGHT - 28);

    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(0, HEIGHT - 3, WIDTH, 3);

    return canvas;
  }

  /**
   * 触发图片下载
   */
  function downloadImage(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * 创建分享图预览弹窗
   */
  function showPreview(canvas, title) {
    const old = document.getElementById('share-preview-modal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'share-preview-modal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'z-index:30000;';

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.cssText = 'max-width:500px;background:var(--color-surface,#fff);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.25);';

    // 头部
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `<h3>${title}</h3>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => overlay.remove();
    header.appendChild(closeBtn);
    content.appendChild(header);

    // 预览图
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.cssText = 'text-align:center;padding:1rem;';

    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.style.cssText = 'width:100%;max-width:375px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
    body.appendChild(img);
    content.appendChild(body);

    // 提示
    const hint = document.createElement('p');
    hint.style.cssText = 'text-align:center;font-size:0.78rem;color:var(--color-text-muted);margin:0 0 0.5rem;';
    hint.textContent = '💡 图中二维码可扫码访问在线工具';
    body.appendChild(hint);

    // 底部按钮
    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-primary';
    downloadBtn.textContent = '📥 下载图片';
    downloadBtn.onclick = () => downloadImage(canvas, '恒市值法回测结果.png');

    const closeBtn2 = document.createElement('button');
    closeBtn2.className = 'btn btn-outline';
    closeBtn2.textContent = '关闭';
    closeBtn2.onclick = () => overlay.remove();

    footer.appendChild(downloadBtn);
    footer.appendChild(closeBtn2);
    content.appendChild(footer);

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  /**
   * 初始化分享按钮
   * 按钮位置：
   *   ① Hero CTA 区（📥 下载 + 🔍 探索 后面加 📸 分享）
   *   ② 右下角主题切换浮动按钮旁边
   *   ③ 最终方案下载区（与下载按钮并排）
   */
  function init() {
    // ── ① Hero CTA 区：在下载和探索按钮后面加「📸 分享」按钮 ──
    const heroActions = document.querySelector('.hero-actions');
    if (heroActions) {
      const shareBtn = document.createElement('button');
      shareBtn.id = 'btn-share-hero';
      shareBtn.className = 'btn btn-outline';
      shareBtn.textContent = '📸 分享';
      shareBtn.title = '生成宣传海报分享到朋友圈/微博';
      shareBtn.addEventListener('click', () => {
        const canvas = generateHeroCard();
        showPreview(canvas, '📸 恒市值法宣传海报');
      });
      heroActions.appendChild(shareBtn);
    }

    // ── ② 右下角主题切换浮动按钮旁边加分享按钮 ──
    const themeSwitcher = document.getElementById('theme-switcher');
    if (themeSwitcher) {
      const shareFloatBtn = document.createElement('button');
      shareFloatBtn.id = 'btn-share-float';
      shareFloatBtn.className = 'theme-toggle-btn';
      shareFloatBtn.style.cssText = 'margin-top:8px;';
      shareFloatBtn.title = '生成分享海报';
      shareFloatBtn.setAttribute('aria-label', '生成分享图');
      shareFloatBtn.textContent = '📸';
      shareFloatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const canvas = generateHeroCard();
        showPreview(canvas, '📸 恒市值法宣传海报');
      });
      themeSwitcher.appendChild(shareFloatBtn);
    }

    // ── ③ 最终方案下载区 ──
    const downloadArea = document.querySelector('.download-area');
    if (downloadArea) {
      let btnGroup = downloadArea.querySelector('.btn-group');
      if (!btnGroup) {
        btnGroup = document.createElement('div');
        btnGroup.className = 'btn-group';
        btnGroup.style.cssText = 'display:flex;gap:1rem;justify-content:center;align-items:center;flex-wrap:wrap;';

        const existingBtn = downloadArea.querySelector('a.btn, .btn');
        if (existingBtn) {
          existingBtn.parentNode.insertBefore(btnGroup, existingBtn);
          btnGroup.appendChild(existingBtn);
        } else {
          downloadArea.appendChild(btnGroup);
        }
      }

      const shareBtn = document.createElement('button');
      shareBtn.id = 'btn-share-download';
      shareBtn.className = 'btn btn-accent';
      shareBtn.style.cssText = 'font-size:1.0625rem;padding:0.875rem 2rem;';
      shareBtn.textContent = '📸 生成分享图';
      shareBtn.title = '生成宣传海报分享到朋友圈/微博';
      shareBtn.addEventListener('click', () => {
        const canvas = generateHeroCard();
        showPreview(canvas, '📸 恒市值法宣传海报');
      });
      btnGroup.appendChild(shareBtn);
    }
  }

  return {
    init,
    generateHeroCard,
    generateResultCard,
  };
})();
