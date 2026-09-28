# 滚动回测月度更新 · 发布检查清单（RELEASE CHECKLIST）

本清单用于「把最后一个完整日历月补进回测并上线」。

> **用法**：全文用占位符，动手前先在心里替换：
> - `TARGET` = 本次要补入的**日历月**（如 `2026-09`）
> - `PREV` = 当前已填到的**日历月**（如 `2026-08`）
> - `N` = 补数后的收益条数（当前 132）；`N-1` = 补数前的条数（当前 131）
> - `END_M` = 收口月**数字**（`TARGET` 的月份数字，如 9）
>
> 最近一次执行：**2026-09-02，补入日历 2026-08，131 → 132 个月**。

---

> ## ★ 先读这段，避免逆向工程 ★
>
> ### 月份标签口径（无偏移 · 已用源数据核验）
> `months` 是**月末标签数组，长度恒为「收益条数 + 1」**；`returns[i]` = **日历月 `months[i+1]`** 的收益。
> **标签直接等于日历月，没有任何偏移。** 日历 2026-08 的真实收益 → 写入 `2026-08` 标签位。
>
> 例：当前 `months = [2015-08 … 2026-08]`（133 条）配 132 条收益，日历覆盖 **2015-09 ~ 2026-08**。
> `months[0] = 2015-08` 是**起点标记**（入场时点），不是第一个收益月。
>
> ⚠️ **历史坑**：旧版文档/脚本/fund_map 曾写「标签 = 日历 − 1 个月」，`fetch_returns.py` 的 `prev_label()`
> 据此做减月 —— 一旦用 `--write` 就会**把新月份收益覆盖掉上月的真实值**。该说法已于 2026-09-02 证伪，
> `prev_label()` 改为恒等映射。**若在任何地方再看到「标签比日历早 1 个月」，一律以本节为准并修正。**
>
> ### 哪些已动态化（补数据即生效，无需回填）
> - 滚动回测汇总表：前端 `RollingBacktest.runAll()` 实时算。
> - 交互式回测区 / 默认结果：`BacktestEngine.simulateCMV` 直读真实数据实时算。
> - 三档方案对比卡片：`main.js` 的 `initComparisonCards` → `simulateCMV`（配置唯一来源 `BacktestEngine.PLANS`）。
> - 首屏 Hero 4 张统计卡：`main.js` 的 `updateHeroStats` → `getDefaultResult()`。
> - 三档雷达图 / 4 个对比柱状图：`charts.js` 的 `getPlansMetrics` → `simulateCMV`。
> - 分享图、收益/回撤曲线：动态取 `getDefaultResult()` / `simulateCMV` 月度序列。
> - 回测窗口：`simulateCMV` 按真实收益条数自动迭代，补数据后自动延伸。
>
> ### 哪些仍是写死、需重算（都在 `js/data.js`）
> - `finalConfig.backtest`、`comparisons`（三档）→ **已可用 `scripts/recompute_derived.js` 自动重算**。
> - `goldSweep`（15 组）、`trendData`（30+ 行）→ **脚本未覆盖，仍需手工重算**。
>   二者仅作真实数据缺失时的兜底与历史对照，页面主路径已不读它们。
> - 漏重算会导致「动态新、静态旧」的表面矛盾，`smoke_check.js` 会报 FAIL。

---

## 阶段 0 · 前置

- [ ] 确保 `TARGET` 月已**完全结束**（补 `2026-09` 需在 10/1 之后运行）。
      **月未结束或取不到数就别更新**，绝不用历史均值占位。
- [ ] 确认 `scripts/fund_map.json` 的基金代号与实际口径一致（当前标记 `VERIFIED 2026-08-20`）。
- [ ] 确认月收益口径一致：新浪前复权日 K 线，月末 close / 上月末 close − 1。

## 阶段 1 · 取数与写回（双数据源必须同步）

- [ ] `cd hdszf && python scripts/fetch_returns.py --target TARGET`
      （只打印「项目标签 = TARGET（无偏移）」及 5 资产月收益，**不自动写文件**）
- [ ] 核对 5 个资产月收益率是否合理（无 ±50% 之类的脏值）
- [ ] 写回 `js/data.js` **与** `js/real_returns.json`（先备份 `.bak`，确认无误后可删）：
  - [ ] `months` 末尾**追加** `TARGET`（追加，不要替换末位——末位是上月真实值）
  - [ ] 5 个资产数组各追加 1 个值
  - [ ] `realReturns.month_count` 与 `meta.n_months` 各 +1
- [ ] **双数据源必须同步改**，漏改其一前端与原始数据就不一致

## 阶段 2 · 引擎与展示边界（手动改代码）

- [ ] `js/rolling.js`：**2026-09-28 起日志窗口已自动延伸**（`totalMonthsNeeded = months.length − monthIdx`），补数后**无需手改 `CONFIG.endMonth`**，日志末月自动追到最新月。
- [ ] `js/main.js`：`actualEndDate` `'PREV'` → `'TARGET'`（若仍被引用；首屏 Hero 已动态化，确认无引用后可忽略）
- [ ] 三档卡片无需改（已内联动态）
- [ ] 起点会整体后移 1 个月：跑 `node -e` 或临时脚本打印 `RollingBacktest.getStartPoints()`，
      确认最早起点月数为 `N`、最近起点为「`TARGET` 前 1 年」且 yearsAgo=1

## 阶段 3 · 派生指标重算

- [ ] `node scripts/recompute_derived.js --check`
      → 输出 32 个字段的「动态 vs 静态」对照表；全 OK 则退出 0，有差异退出 1
- [ ] `node scripts/recompute_derived.js`
      → 有差异时自动回填 `comparisons`（三档 × 8 字段）+ `finalConfig.backtest`（8 字段）并复核；
      写前自动备份 `js/data.js.bak`。**写回保留完整浮点精度**，diff 里只出现真正变化的字段
- [ ] `goldSweep` / `trendData`：**脚本未覆盖，手工重算**（可选，仅影响兜底与历史对照）

## 阶段 4 · 文案与「最后更新」戳

> 首屏 Hero 卡与三档卡片已动态化，**不需要**手工改；以下**静态文案**仍要手工刷。

- [ ] `index.html`：正文里「N-1 个月 → N 个月」「PREV 年 M 月 → TARGET 年 M 月」（约 3 处：数据说明段、
      三档说明段、SEO 隐藏段）
- [ ] `index.html` 静态数字：og:description 年化、`insight-box` 三档年化、最终方案副标题（年化/夏普）、
      Hero 静态回退值 → 用 `recompute_derived.js --check` 显示的动态值替换
- [ ] `index.html`：隐私政策 / 用户协议两处「最后更新日期」→ 今天
- [ ] `README.md`：数据范围、月数、三档表、月份标签口径备忘
- [ ] `CODEBUDDY.md`：头部「最后更新」、版本表、数据口径备忘、追加「数据刷新记录」小节
- [ ] `PROJECT_SPEC.md`：1.1 数据范围、1.4 各资产独立年化（用当前 data.js 重算，别沿用旧值）
- [ ] `sitemap.xml`：`lastmod` → 今天
- [ ] **不要动** `wrangler.jsonc` 的 `compatibility_date`（Cloudflare 运行时开关，改了可能改变 Worker 行为）

## 阶段 5 · 验证与上线

- [ ] `node scripts/smoke_check.js` → 全部 PASS，退出码 0（校验引擎一致性 + Hero ID + 三档动态≈静态）
- [ ] `node scripts/recompute_derived.js --check` → 全 OK
- [ ] `node scripts/diff_data_update.js --md scripts/data_update_report_<TARGET>.md`
      生成「新旧数据差异报告」，格式与站内「滚动回测汇总」表同构（12 列），
      逐起点标注正向/负向。报告必须随本次提交一起入库（脚本与报告配套互相验证）。
      默认 `--drop 1`（对比截掉最后 1 个月的旧口径）；跨月补更时用 `--drop N`。
- [ ] 本地起服务（`python -m http.server` 或 `wrangler dev`）肉眼核对：
  - [ ] 滚动汇总表新增起点行且无 NaN/∞/负终值
  - [ ] 三档方案数字与 `data.js` 一致
  - [ ] 首屏 Hero 卡无 "undefined"、无双负号
  - [ ] 三套主题切换后数字同步
- [ ] 版本号 bump：`index.html` 里改动过的 `js/*.js?v=N` 全部 +1（否则用户浏览器/CDN 用旧缓存）
- [ ] `git add -A && git commit -m "data: 滚动回测更新至 TARGET（N 个月）"`
- [ ] `git push origin main`（SSH，本仓库既定传输方式）→ 触发 Cloudflare 自动部署
- [ ] 推送后用 `git ls-remote origin main` 核对远程 tip（本地 push 输出有时不可信）
- [ ] 受毛子云 CDN 最长 20 分钟缓存影响，部署后访问 `h.sugas.site` 复核

## 阶段 6 · 关联产物（容易忘）

- [ ] `scripts/_daily_cache.json` 日频缓存会**过期**（最近一次更新止于 2026-08-21）。
      若需要重跑日级研究，先用 `scripts/fetch_daily.py` 刷新到 `TARGET` 月末。
- [ ] `scripts/rebalance_study.js` **直接读 `js/data.js`**，数据更新后重跑会得到新月份数。
      已入库的 `scripts/_rebalance_study_report.md` 会成为旧快照、与脚本不再逐行一致
      → 重跑 `node scripts/rebalance_study.js` 刷新报告，或在报告头部标注「数据快照：N-1 个月」。
- [ ] 差异报告 `scripts/data_update_report_<TARGET>.md` 已随数据提交入库（见阶段 5）。
      历史差异报告保留，便于回溯每月更新的影响方向与幅度。

---

## 进行中月份进度快照（每周 / 每交易日）

> 用户要求：除了每月 3 号的全量定稿，还要"每周或每个交易日出一个自动更新脚本，哪怕不是完整月，但标记进行中"。

- **脚本**：`scripts/monthly_progress.js`（Node，自包含，用全局 `fetch` 取新浪日 K 线）。
  - 作用：取"当前未完成月"的**月至今(MTD)**收益，把最新完整月的组合持仓往前推一步，输出带 **🟡 进行中（非完整月）** 标记的组合进度报告。
  - **绝不写 `js/data.js` / `js/real_returns.json`**，不污染主回测口径；真正的月末定稿仍由 `monthly_update.js`（每月 3 号）负责。
  - 用法：`node scripts/monthly_progress.js [--out 报告.md] [--no-fetch]`。取数全失败时降级为 MTD=0 占位仍输出（退出码 2）。
  - 实时取数需联网；若自动化环境无外网，会降级为占位并在报告里标明。
- **与全量更新的分工**：`monthly_update.js` = 月末定稿（写数据 + 重算 + 上线）；`monthly_progress.js` = 月中进度（只读 + 报告）。二者互补，不冲突。

---

## 回归守卫（防 off-by-one 复发）

- `scripts/smoke_check.js` 第 5 项：加载 `js/rolling.js` 跑 `runAll()`，断言每个起点末位快照月份 == `months` 末位标签。
  若日志又退回 2026-07（或任何非最新月），smoke_check 直接 FAIL，阻断发布。

---

## 风险与边界

- 不要凭空造目标月收益：月未结束或无法取数时宁可不更新，也不用历史均值填。
- 双数据源（`data.js` + `real_returns.json`）必须同步改。
- 派生指标重算不全 → 页面出现「汇总表新、方案数字旧」的矛盾，上线前务必跑阶段 3。
- 版本号忘 bump → 线上看不出变化（毛子云 CDN + 浏览器缓存双重缓存）。
