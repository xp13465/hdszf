/**
 * 滑块交互组件
 * 6滑块独立调节，不锁定总和
 * 总和<100%时，剩余部分视为活期（0收益）
 */

const SliderPanel = (() => {
  const ASSETS = ['沪深300', '中证500', '标普500', '纳斯达克100', '黄金', '现金·货币基金'];
  const COLORS = {
    '沪深300': '#3b82f6',
    '中证500': '#60a5fa',
    '标普500': '#06b6d4',
    '纳斯达克100': '#22d3ee',
    '黄金': '#c9a84c',
    '现金·货币基金': '#94a3b8'
  };

  let currentValues = { ...BacktestEngine.DEFAULT_CONFIG };
  let onChangeCallback = null;
  let lockedConfig = null;

  function init(onChange) {
    onChangeCallback = onChange;

    // 绑定滑块事件
    ASSETS.forEach(asset => {
      const slider = document.getElementById(`slider-${asset}`);
      const input = document.getElementById(`input-${asset}`);
      if (!slider || !input) return;

      slider.addEventListener('input', () => {
        const newValue = parseInt(slider.value);
        handleSliderChange(asset, newValue);
      });

      input.addEventListener('change', () => {
        const newValue = parseInt(input.value) || 0;
        handleSliderChange(asset, Math.min(100, Math.max(0, newValue)));
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const newValue = parseInt(input.value) || 0;
          handleSliderChange(asset, Math.min(100, Math.max(0, newValue)));
        }
      });
    });

    // 绑定按钮
    document.getElementById('btn-reset')?.addEventListener('click', resetToDefault);
    document.getElementById('btn-lock')?.addEventListener('click', toggleLock);

    // 初始渲染
    updateAllSliders();
  }

  function handleSliderChange(changedAsset, newValue) {
    // 不锁总和：每个滑块独立调节，总和可以<100%
    currentValues[changedAsset] = newValue;
    updateAllSliders();

    // 触发回调
    if (onChangeCallback) {
      onChangeCallback(currentValues, lockedConfig);
    }
  }

  function updateAllSliders() {
    const sum = Object.values(currentValues).reduce((a, b) => a + b, 0);

    ASSETS.forEach(asset => {
      const slider = document.getElementById(`slider-${asset}`);
      const input = document.getElementById(`input-${asset}`);
      const valueDisplay = document.getElementById(`value-${asset}`);

      if (slider) slider.value = currentValues[asset];
      if (input) input.value = currentValues[asset];
      if (valueDisplay) valueDisplay.textContent = currentValues[asset] + '%';
    });

    // 更新总和指示器
    const sumIndicator = document.getElementById('sum-indicator');
    if (sumIndicator) {
      const idle = 100 - sum;
      if (sum === 100) {
        sumIndicator.textContent = '合计: 100%';
        sumIndicator.className = 'sum-indicator ok';
      } else {
        sumIndicator.textContent = `合计: ${sum}%（${idle}% 活期）`;
        sumIndicator.className = 'sum-indicator warn';
      }
    }
  }

  function resetToDefault() {
    currentValues = { ...BacktestEngine.DEFAULT_CONFIG };
    lockedConfig = null;

    const lockBtn = document.getElementById('btn-lock');
    if (lockBtn) {
      lockBtn.textContent = '🔒 锁定对比';
      lockBtn.classList.remove('active');
    }

    const comparisonBar = document.getElementById('comparison-bar');
    if (comparisonBar) comparisonBar.classList.remove('active');

    updateAllSliders();
    if (onChangeCallback) {
      onChangeCallback(currentValues, null);
    }
  }

  function toggleLock() {
    const lockBtn = document.getElementById('btn-lock');
    const comparisonBar = document.getElementById('comparison-bar');

    if (lockedConfig) {
      // 解锁
      lockedConfig = null;
      lockBtn.textContent = '🔒 锁定对比';
      lockBtn.classList.remove('active');
      comparisonBar.classList.remove('active');
    } else {
      // 锁定当前配置
      lockedConfig = { ...currentValues };
      lockBtn.textContent = '🔓 取消锁定';
      lockBtn.classList.add('active');
      comparisonBar.classList.add('active');

      // 更新对比栏
      const lockedSummary = document.getElementById('locked-summary');
      if (lockedSummary) {
        lockedSummary.textContent = `已锁定: 沪深300 ${lockedConfig['沪深300']}% | 中证500 ${lockedConfig['中证500']}% | 标普500 ${lockedConfig['标普500']}% | 纳指100 ${lockedConfig['纳斯达克100']}% | 黄金 ${lockedConfig['黄金']}% | 现金 ${lockedConfig['现金·货币基金']}%`;
      }
    }

    if (onChangeCallback) {
      onChangeCallback(currentValues, lockedConfig);
    }
  }

  function getCurrentValues() {
    return { ...currentValues };
  }

  function getLockedConfig() {
    return lockedConfig ? { ...lockedConfig } : null;
  }

  return {
    init,
    getCurrentValues,
    getLockedConfig,
    resetToDefault,
    ASSETS,
    COLORS
  };
})();
