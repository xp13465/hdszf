# 滚动回测月度更新 · 发布检查清单（RELEASE CHECKLIST）

本清单用于「把最后完整月之后的新月份补进回测并上线」。

> ★ 先读这段，避免逆向工程 ★
>
> **月份标签偏移（最大坑）**：项目的 month 标签比真实日历早 1 个月。
> 日历 2026-07（7 月）的真实收益，要写入 `js/data.js` / `js/real_returns.json` 的 `2026-06` 标签位。
> 取数脚本 `fetch_returns.py --target 2026-07` 会自动算出「项目标签 = 2026-06」，并打出 5 个资产的值。
> 详见 `scripts/fetch_returns.py` 文件头注释与 `scripts/fund_map.json`。
>
> **哪些已经动态化（无需手工回填）**：
> - 滚动回测汇总表：前端 `RollingBacktest.runAll()` 实时计算。
> - 交互式回测区 / 默认结果：引擎主路径 `BacktestEngine.simulateCMV` 直读真实数据实时算。
> - **三档方案对比卡片**：`js/main.js` 的 `initComparisonCards` 于 2026-08-21 改为内联三档配置并调用
>   `simulateCMV` 实时计算，页面展示随数据更新**自动生效**，不再依赖 `data.js` 里写死的 `comparisons`。
>   三档配置的唯一事实来源是 `BacktestEngine.PLANS`（engine.js）。
> - **首屏 Hero 4 张统计卡**（终值/年化、月胜率 x/y月、10年仅N年亏损·最多亏Z%、最大回撤、现金比例）：
>   `main.js` 的 `updateHeroStats` 于 2026-08-21 接入 `getDefaultResult()` 实时填充，随数据更新自动生效。
>   其中"月胜率 x/y 月"和年度亏损统计来自 `simulateCMV` 新增的 `positiveMonths/totalMonths/yearly` 字段。
> - **三档雷达图 / 4 个对比柱状图**：`charts.js` 经 `getPlansMetrics` 用 `BacktestEngine.PLANS`+`simulateCMV` 实时算。
> - **分享图（Hero 海报 + 回测结果卡）**：`share-image.js` 动态取 `getDefaultResult()`，无需回填。
> - **收益/回撤曲线**：统一走 `simulateCMV` 月度序列，与指标卡数值一致。
> - **回测窗口**：`simulateCMV` 按真实收益条数自动迭代（排除 months 末位占位标签），补数据后自动延伸，无需改引擎。
>
> **哪些仍是写死、需随数据窗口延伸重算**（`js/data.js`）：
> - `finalConfig.backtest`、`goldSweep`（15 组）、`trendData`（约 30+ 行）。
> - `comparisons`（三档方案）静态值：页面已不读它渲染卡片/图表（均动态），但 README 表与 `data.js` 内该对象仍可同步更新，
>   以便「静态对照」和离线兜底（`initComparisonCards` 真实数据缺失时回退到此）。
> - 这些写死数字多一个月后会轻微漂移，漏重算会导致「汇总表新、方案数字旧」的表面矛盾。

---

## 阶段 0 · 前置（9/1 前完成）

- [ ] 确认 `scripts/fund_map.json` 的基金代码与实际回测口径一致（原数据用 35,784 条基金净值，
      仓库未记录具体基金，此为待校验项）。脚本默认值是常见 ETF 猜测，必须核对。
- [ ] 确认月收益率口径：原数据用的是「自然月首个净值 / 末个净值」还是「复权净值」或其他，
      保证 `fetch_returns.py` 计算结果与原序列口径一致。
- [ ] 确保目标月已完全结束（如补 `2026-08`，需在 8/31 之后运行）。

## 阶段 1 · 取数（脚本取数，但“写回”半自动）

- [ ] `cd hdszf && python scripts/fetch_returns.py --target 2026-08`
      （脚本只打印「日历月 → 项目标签(=2026-07)」及 5 资产月收益，**不自动写文件**）
- [ ] 核对 5 个资产月收益率是否合理（无异常 ±50% 之类的脏值）
- [ ] 手工（或另写一次性脚本）把值写回 `js/data.js` 与 `js/real_returns.json`：
  - [ ] 在 `months` 末尾**替换/追加**目标项目标签（注意偏移：日历 2026-08 → 项目标签 `2026-07`）
  - [ ] 5 个资产数组各补 1 个值到对应位置
  - [ ] `month_count` / `data_range` / `n_months` 同步更新
  - [ ] 先备份 `.bak`，确认无误后可删
- [ ] **双数据源必须同步改**（`data.js` + `real_returns.json`），漏改其一会导致前端与原始数据不一致

## 阶段 2 · 引擎与展示边界（手动改代码）

- [ ] `js/rolling.js`：`CONFIG.endMonth` 7 → 8（若仍用于收口）；注释中 `131个月/2025-07` → `132个月/2025-08`
- [ ] `js/main.js`：`actualEndDate` `'2026-07'` → `'2026-08'`
- [ ] 三档卡片无需改 `initComparisonCards` 配置（已内联），真实数据一更新页面即变

## 阶段 3 · 派生指标重算（核心，手动/node）

> 这些数字写在 `js/data.js`，多一个月后所有年化/回撤/Sharpe/Sortino/终值会轻微漂移。
> 需本地重跑回测引擎（node 加载 `js/data.js`+`js/engine.js` 后调用 `BacktestEngine.simulateCMV(alloc)` 等入口）得到新值再回填：

- [ ] `finalConfig.backtest`（年化/总收益/最大回撤/Sharpe/Sortino/终值/月胜率/月度波动/回撤持续）
- [ ] `goldSweep` 全部 15 组（gold_pct 0~26）的 best_annual/best_dd/best_sharpe
- [ ] `trendData` 全部条目（约 30+ 行）的 annual/dd/sharpe/sortino/final/total
- [ ] `comparisons`（三档方案）静态值：仅影响 README 表与离线兜底，页面卡片已动态，**可选**同步
- [ ] 滚动汇总表：前端会新增一行起点（1 年前入场），所有窗口长度 +1 个月，需目测渲染正确

## 阶段 4 · 文案与「最后更新」戳（多文件同步）

> 首屏 Hero 卡片与三档卡片已动态化，**不需要**手工改；以下**静态文案**仍要手工刷：
> `index.html` 里写死的回测数字（og:description 年化、`insight-box` 三档年化/回撤、最终方案副标题
> 年化/夏普、SEO 隐藏文本段落）。每月补数后按下列清单核对并替换为新值。

- [ ] `index.html`：L395 / L612 / L747（131个月→132个月；2026年7月→8月）；L814 / L862 更新日期戳
- [ ] `index.html` 静态文案中的年化/回撤/夏普数字（og:description、insight-box 三档、section-subtitle、SEO 隐藏段落）
- [ ] `README.md`：数据缺口说明、回测表数字、数据范围指向新月份
- [ ] `CODEBUDDY.md`：日期、数据缺口、数组长度注释
- [ ] `PROJECT_SPEC.md`：日期与数据范围
- [ ] `wrangler.jsonc`：`compatibility_date`、sitemap.xml `lastmod` → 今天

## 阶段 5 · 验证与上线

- [ ] `node scripts/smoke_check.js`（引擎一致性 + Hero ID 齐全 + 三档动态≈静态，退出码 0）
- [ ] 本地 `python -m http.server` 或 `wrangler dev` 起服务，肉眼核对：
  - [ ] 滚动汇总表新增 `2025-08` 起点行且无 NaN/∞/负终值
  - [ ] 三档方案数字与 `data.js` 一致
  - [ ] 首屏 4 张 Hero 卡数字与引擎一致（无 "undefined"、无双负号）
  - [ ] 主题切换（三套）数字同步
- [ ] `git add -A && git commit -m "data: 滚动回测更新至 2026-08"`
- [ ] `git push origin main`（SSH，本仓库既定传输方式）→ 触发 Cloudflare 自动部署
- [ ] 受毛子云 CDN 最长 20 分钟缓存影响，公开页面约数分钟后刷新；部署后访问 `h.sugas.site` 复核

---

## 风险与边界

- 不要凭空造目标月收益：月未结束或无法取数时，宁可不更新，也不要用历史均值填（会污染结论并需全表标⚠️）。
- 双数据源（`data.js` + `real_returns.json`）必须同步改，漏改其一会导致前端与原始数据不一致。
- 派生指标若重算不全，页面会出现「汇总表是新的、方案数字是旧的」矛盾，上线前务必阶段 3 全量重算。
