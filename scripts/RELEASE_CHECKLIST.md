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
  - 用法：`node scripts/monthly_progress.js [--out 报告.md] [--json js/progress.json] [--no-json] [--no-fetch] [--push]`。
  - **降级闸门（2026-09-29 加）**：任一风险资产取数失败 → `degraded: true`、退出码 2，
    所有本月至今字段写 **`null`**（不是 `0`）、**不写入也不推送**任何本月数据。
    `null` = 本次无数据（可发布）；`0` = 伪造的「当月持平」（绝不可发布，会被 live overlay
    当成真的本月数据发到全站 Hero / 三档卡 / 指标卡 / 滚动板块）。前端识别 `degraded` 后自动回退已定稿口径。
  - 实时取数需联网；若自动化环境无外网，会降级并在报告里标明。
  - **调度方式（2026-09-29 变更：改为纯脚本，零 AI 依赖）**：由本机 **Windows 计划任务**在每交易日 18:00 之后唤醒
    `automation/win/run_job.js mtd`（自带「当天成功一次即停」闸门，因此可高频唤醒补跑而不会重复提交/部署）。
    月度定稿同理，走 `hdszf-finalize` 任务（每月 3 日起、当月成功一次即停）。
    **安装命令 / 查看清单 / 维护方法 / 故障处置** 全部见 **`automation/win/README.md`**。
    ⚠️ 运行器日志与状态写在**仓库之外**（`<工作区>\_hdszf_logs\`）：仓库根是 Assets 发布目录，放进去会被公开上传并污染 git。
    ⚠️ 运行器只决定「何时跑」，不产出任何数值；「月未走完不更新」仍由 `monthly_update.js` 自己把住（未走完 → exit 0）。
- **口径（与站内一致）**：组合"本月至今"百分比 = 变更金额 ÷ **固定基准本金 50 万**（不是 ÷ 上月末总市值），与日志表「月收益 / 年度收益率 / 累计收益」三列同口径、可加。JSON 里 `est_change_pct_prev` 是 ÷ 上月末总市值的**参考值**，页面仅在日志行里以极小字标注。
- **站点展示**：`--push` 会把 `js/progress.json` 提交并推送 → CF 自动部署 → 打开**「完整持仓日志」**即可看到表格**末行**（倒序时为首行）的「🟡 进行中」行（`js/main.js` 的 `ensureLiveProgress()` + `buildLiveRows()`）。
  - 2026-09-29 用户否掉了"首页独立区块"形态，改为**日志表格内一行**；旧的 `index.html#live-progress` 区块与 `.live-*` 样式、`initLiveProgress()`/`renderLiveProgress()` 已删除。
  - 该行按**当前这次回测自身的末月持仓 × 各资产 MTD%** 推算，所以 12 个起点各自自洽；操作/金额列一律 `—`。
  - 行内比例：月收益列 = 本月金额 ÷ 50万，累计/年度列同口径；另附 `参考 ÷上月末` 极小字对照。
  - 数据**只读**，`worker.js` 对 `/js/progress.json` 设 60 秒缓存；前端另加 10 分钟粒度的 `?t=` 参数。
  - 取不到 `progress.json` / 非进行中 / `base_month` ≠ 日志末月时**不追加该行**（静默降级），不影响任何既有功能。
  - 内容无变化时脚本不重写文件（不产生无意义 diff / 部署）。
- **与全量更新的分工**：`monthly_update.js` = 月末定稿（写数据 + 重算 + 上线）；`monthly_progress.js` = 月中进度（只读 + 报告 + 站点日志行）。二者互补，不冲突。
- **月末定稿后**：该月的 `progress.json` 会自然失效（其月份已进入 `months`，同时 `base_month` ≠ 新末月），`smoke_check` 第 7 项会 FAIL 提醒，重跑脚本即可切换到新月份（`in_progress_month` 自动 +1）。
- **⚠️ 必须在定稿里自动刷新快照（2026-09-29 修复）**：`monthly_update.js` 新增 **阶段 9.5**，在自检前自动跑一次 `node scripts/monthly_progress.js`
  （不带 `--push`，由外层统一 commit + push）。原因：定稿把 `TARGET` 月写进 `data.js` 后，旧快照立刻"过期"
  （月份落进 `months`、`base_month` 落后一月），`smoke_check` 第 7 项必然 FAIL，而阶段 10 遇 FAIL 会 **不 commit、不 push** ——
  整个月度定稿会被自己的旧快照卡死。
  - 容错：取数降级时 `monthly_progress.js` 退出码为 2，写成「本月至今字段全为 null」的降级占位
    （**绝不写 MTD=0**，那会伪造「当月持平」），JSON 结构仍合法 → 只告警不中断，并提示手工重跑；
    其它非零退出码才中止定稿。
  - 手工定稿时若跳过此步，先自己跑一次 `node scripts/monthly_progress.js` 再提交。

### 阶段 9.5 之外：`monthly_update.js` 的两条文案口径（2026-09-29 修正）

- **`V.n`（数据窗口 = 收益条数）与 `V.nCum`（累计月序 = 收益条数 + 1）必须分清**：
  - 数据范围类文案用 `V.n`（「132个月真实数据验证」「共 132个月」「（132个月）真实市场数据回测」）；
  - 累计月序类文案用 **`V.nCum`**（Hero「90 / 133月」、指标卡「总收益（133个月）」）—— 与 `js/main.js` 的
    `m.totalMonths` 同源（1-based 含入场月，用户 2026-09-29 拍板）。
  - 曾误用 `V.n` → 会把 133 写成 132，与页面动态值差 1。
- **Hero 副标题的"翻倍/增长/亏损"**由 `js/main.js` 按 `finalValue / 50万 ≥ 2` 动态判定，静态回退文案必须同步
  （当前终值 110.6 万 → **「11年翻倍」**）。替换规则正则为 `/(11年(?:翻倍|增长|亏损) · 年化)[\d.]+(%)/`。
- 发布前建议加 `--strict` 干跑一次，确认「全部规则命中」（任一规则未命中都说明静态文案与动态口径脱节）：
  `node scripts/monthly_update.js --dry-run --strict`

---

## 全站「本月至今（MTD）」+ hover 已定稿对照（2026-09-29 起，三轮叠加）

> **术语（第三轮用户拍板）**：该口径统一叫 **「本月至今（MTD）」**，不叫「估算 / 预估」——它是每日真实行情累积出的
> **已发生数据，不是预测**；不进官方指标的唯一原因是「月末未收口 + 恒市值法只在月末调仓」。对照值叫 **「已定稿（YYYY-MM）」**。
> ⚠️ 别把 `RollingBacktest.hasEstimatedData`（历史数据缺失的插值兜底，UI 文案「含估计值」）一起改 —— 那是另一个概念。

> 与上一节配套：`progress.json` 此前只喂日志表的「🟡 进行中」行；现在**同时喂首屏 Hero、三档卡片、交互回测指标卡，
> 以及滚动回测板块的全部表面**：汇总表 12 行 + **表末「🟡 进行中月份」行（第三轮）** + 折线图末点 +
> **「本月至今」明细块（第三轮）** + 弹窗顶部汇总。

> **第三轮要点**：用户要求「外部展示出来，而不是切到详细才看到最新数据」→
> 逐资产的当月明细与最新月份汇总不再藏在弹窗里，滚动板块页面内直接可见。

### 数据流

```
scripts/monthly_progress.js  →  js/progress.json (含 mtd_raw 高精度字段)
        ↓ fetch + ?t= 缓存
main.js ensureLiveProgress() → applyLiveOverlay(d)
        ├─ BacktestEngine.setLiveOverlay({month, asOf, returns})   → simulateCMV 多算 1 个月（不触发再平衡）
        │                                                            Hero / 三档卡 / 雷达图 / 收益回撤曲线 / 指标卡
        └─ RollingBacktest.setLiveOverlay({month, asOf, mtd})      → result.live（monthlySnapshots 保持已定稿！）
                                                                     滚动汇总表 12 行 + 表末「进行中月份」行
                                                                     / 折线图末点 / 本月至今明细块 / 弹窗顶部汇总
                                                                     / 日志「🟡 进行中」行
simulateCMV(alloc, {liveOverlay:false}) / RollingBacktest.runAll({liveOverlay:false}) = 已定稿口径（对照值）
```

**两个引擎的叠加状态各自独立，必须同时设置** —— 只设一个会出现「首屏含本月至今、滚动板块不含」这类同页面口径打架
（正是第二轮修复的起因）。`main.js#applyLiveOverlay()` 里两处 `setLiveOverlay` 成对出现，别拆。

> **同一份数据不要在页面里出现第三条计算路径**：`renderLiveProgressBlock`（明细块）与汇总表末行**都直接吃**
> `results[0].live.snapshot.assetDetails`，不在前端另算。想加新展示块时照此办理。

### 改动前后必查（改引擎/展示前请先读）

- [ ] **两引擎口径必须逐位相等**：`simulateCMV(alloc)` vs `RollingBacktest` 一次建仓版
      → `finalValue / annual / maxDd / sharpe / winRate` 全 0 差。
      `smoke_check.js` 第 8 项已守；若 FAIL，先查 `engine.js` 的 `arr[t-1]` 映射有没有被改回 `arr[t]`。
- [ ] `engine.js` 月份映射铁律：`t=0` = 入场月（收益 0），`t>=1` 取 `arr[t-1]`，循环次数 = 收益条数 + 1（+ 有 overlay 再 +1）。
- [ ] overlay 只吃 **`progress.json#assets[].mtd_raw`**（8 位小数）。用 2 位 `mtd` 会漂 ±3 元，`smoke_check` 第 10 项会 FAIL。
- [ ] overlay 月份必须**晚于**数据末月且**不在** `months` 里，否则 `setLiveOverlay` 直接拒绝（静默降级）。
- [ ] `has-live-progress`（日志 🟡 角标）与 `has-live-estimate`（全站「含本月至今」小标 + **明细块显隐**）**是两个独立 class**，别合并。
- [ ] **分享图固定用已定稿口径**：`share-image.js#getDefaultResult()` 必须传 `{liveOverlay:false}`。
- [ ] 三档卡片字段是 **`dd`**（不是 `maxDd`），对照值在 `data.frozen.maxDd`。
- [ ] **滚动引擎的叠加层绝不能 append 进 `result.monthlySnapshots`** —— 叠加结果只放 `result.live`。
      一旦写进快照序列，日志表格正文、CSV 导出、折线图全部会跟着变，且累计月序会多算一格。
- [ ] **`null` 绝不能被当成 0**：两个引擎的 `setLiveOverlay` 与 `main.js#applyLiveOverlay` 都要显式拒绝
      `null` / `undefined` / `''` / 布尔 / 数组 / 非有限数。`Number(null) === 0`，漏了就变成「当月持平」。
- [ ] 弹窗「🟡 进行中」行必须**直接渲染 `result.live.snapshot`**，不要本地复算 MTD
      （旧实现用 2 位 `progress.mtd`，与引擎 `mtd_raw` 会差几元，同一弹窗内自相矛盾）。
- [ ] **本月至今明细块 / 汇总表末行的显隐与数据**：无 live 数据（未取到 / 降级 / 基准月不符）时明细块必须隐藏、
      汇总表末行**必须完全不渲染**（不能留空行或 0 值行）。
- [ ] **明细块合计比例必须 ÷ 固定基准 50 万**（`progress.est_change_pct_base` 同口径），不许用上月末总市值当分母。
- [ ] 改了 `engine.js` / `rolling.js` / `main.js` / `style.css` → 记得 bump `index.html` 的 `?v=`，
      且 `main.js themeMap.business` 的 `style.css` 版本号**必须与 index.html 一致**。

### 验证命令

```bash
node scripts/smoke_check.js          # 期望退出码 0（含第 5/7/8/9/10/11/12 项，共 72 项断言）
node scripts/monthly_progress.js     # 刷新 progress.json（--push 才提交）
```

实机核对（本机 Playwright，隔离工作区 `C:\Users\23405\.workbuddy\binaries\node\workspace\`）：
- 本地改动**未 push** 时才需要起服务：`<python> -m http.server 8123 --bind 127.0.0.1`（**必须用后台任务参数**；
  命令末尾加 `&` 会「任务报 failed + python 子进程脱管占端口」，换端口重试会累积出多个僵尸服务）。
- `verify_live.py` → Hero / 指标卡 / 三档数值、悬浮层文本（本月至今 vs 已定稿）、曲线点数、日志表横向溢出、双主题。
- `_verify_rolling_live.py` → 滚动汇总表 12 行「含本月至今」小标 + 数值、折线图末点（本月点是最后一点）、
  弹窗顶部汇总 5 项含本月至今 + 悬停对照、进行中行（第 134 个月）、`scrollWidth === clientWidth`。
- `_verify_live_block.js`（隔离工作区，jsdom 级）→ **汇总表 13 行（末行为 `live-month-row`，12 列）**、
  **明细块 6 资产 + 2 合计行**、合计最新市值 = `est_total`、合计比例 = `est_change_pct_base`；
  并跑「降级 / MTD 为 null」两个场景断言**零残留**（无末行、无明细块、无说明）。
- `_verify_roll_hover.py` → 汇总表行悬停提示。⚠️ 悬停**必须等 fade-in 位移动画结束**（`scrollIntoView` 后 sleep ≥ 900ms 再取
  `bounding_box()` 并 `mouse.move`），否则坐标是动画中间态、提示不会弹出（假失败）。
- 验证完 `TaskStop` 后台服务并核对端口释放。

---



- `scripts/smoke_check.js` 第 5 项：加载 `js/rolling.js` 跑 `runAll()`，断言每个起点末位快照月份 == `months` 末位标签。
  若日志又退回 2026-07（或任何非最新月），smoke_check 直接 FAIL，阻断发布。
- `scripts/smoke_check.js` 第 6 项（2026-09-29 起）：**数据起点固化 2015-08**——断言 `months[0]==="2015-08"`、最早入场月==2015-08、12 个起点快照全为真实数据（无 `estimatedMonth` 泄漏）。
  若有人手改 `months[0]` 或重抓时起点漂移，smoke_check 直接 FAIL。
- `scripts/smoke_check.js` 第 7 项（2026-09-29 起，同日扩展）：**progress.json 不污染主回测 + 与前端对齐**——断言 `in_progress:true`、`base_capital==500000`、资产行数 = 风险资产数 + 现金 1 行，且其月份**不得**出现在 `months` 里；再加三条防回归：
  - 资产名与 `js/main.js` 的 `ASSETS` **逐字一致**（前端按名匹配 MTD，不一致会静默按 0% 算）；
  - `base_month` == 主数据末月（前端只在相等时才追加「进行中行」）；
  - `est_change_pct_base` == `est_change_amount ÷ base_capital`（防口径退回"÷上月末总市值"）。
  失败通常意味着"该月已定稿但快照没更新"，重跑 `monthly_progress.js` 即可。
- **累计月序口径（2026-09-29 用户拍板）**：入场月 = **第 1 个月**（不是第 0 个月），数据末月 2026-08 = 第 133 个月，进行中月 2026-09 = 第 134 个月。
  前端 `main.js`（`monthNoMap = i + 1`）与 CSV `rolling.js`（同）必须同源，改一处必改另一处。
  **已加守卫**：`smoke_check` 第 9 项断言「滚动叠加：累计月序 = 冻结月数 + 1」；
  日志「进行中」行的月序直接取引擎的 `live.snapshot.monthIndex`（不再由 `snaps.length + 1` 推算，避免叠加月被算两遍）。
- `scripts/smoke_check.js` 第 5 项（2026-09-29 改写）：**`simulateCMV` 窗口 = 入场月 + 真实收益月**，断言 `m.totalMonths === assetLen + 1`
  （旧断言是 `=== assetLen`，口径统一后已作废）。
- `scripts/smoke_check.js` 第 8 项（2026-09-29 新增）：**两引擎口径一致** —— `simulateCMV` 与 `RollingBacktest` 在
  一次建仓版 & 分批建仓版（同起点）下逐项相等。这是本次最核心的防回归。
- `scripts/smoke_check.js` 第 9 项（2026-09-29 新增）：**live overlay 与 progress.json 逐位一致** ——
  叠加终值 == `est_total`、月数 +1、累计% == `cum_return_pct_base`、不污染已定稿口径、非法叠加被拒、`clearLiveOverlay` 后复位。
- `scripts/smoke_check.js` 第 10 项（2026-09-29 新增，同日扩展降级分支）：`progress.json` 正常时必须含 **`mtd_raw`**（高精度 MTD，防 ±3 元漂移）；
  **若标记 `degraded: true`**，则断言所有本月至今字段（`est_total` / `est_change_amount` / `est_change_pct_base` /
  `est_change_pct_prev` / `cum_return_pct_base` / 各资产 `mtd` / `mtd_raw` / `est_value`）**必须为 `null`**、
  各资产 `ok === false`、身份仍自洽（`base_month` == 主数据末月、进行中月未定稿）、原因可追溯（`fetch.fail > 0` 或 `fetch.offline === true`）。
  这一项专门防「用 0 填补出『当月持平』并推到线上」——见下节。

---

## 降级闸门（degraded gate，2026-09-29 新增 —— 数据完整性）

**为什么加**：`progress.json` 的 MTD 经前端 live overlay 驱动**全站**「本月至今」口径（Hero / 三档卡 / 指标卡 / 滚动汇总表末行 / 本月至今明细块）。
旧实现在取数全部失败时用 `MTD=0` 占位，并且**先 `gitPushJson` 再 `exit 2`** —— 也就是假数据一定会先上线。
一旦某个周一新浪抽风，全站就会显示「本月至今 = 0.00%（持平）」，等于凭空造月收益（违反铁律）。

**核心原则：`null` = 本次无数据（可发布）；`0` = 伪造的持平（绝不可发布）。**

| 环节 | 行为 |
|---|---|
| 降级判定 | `scripts/monthly_progress.js`：**任一**风险资产取数失败（或 `--no-fetch`）→ `degraded = true`（不再是「全部失败才降级」） |
| 字段 | 降级时上层 `est_*` / `cum_return_pct_base` 与各资产 `mtd` / `mtd_raw` / `est_value` 全为 `null`，各资产 `ok = false`；`base_total`（基准月持仓，与本月行情无关）保留真实值 |
| 写盘 | 新增 `existingIdentityValid()`：降级且现有快照身份仍有效 → **不写、不推**，保留上一版真实快照；身份已失效（月末定稿把该月写进 `months`）→ 写 null 占位把身份推进，不卡定稿 |
| 推送 | `if (PUSH && !keepExisting)` —— 只推「含真实 MTD」或「明确 `degraded`、本月至今字段全为 null」的占位；**绝不推 0 填补的假数据** |
| 前端 | `js/main.js#ensureLiveProgress`：`d.degraded` → 直接处理为不可用（不设 `liveProgressData`、不 `markLiveBadges`、不 `applyLiveOverlay`）；`applyLiveOverlay` 内再加 `if (d.degraded) return null` 双保险 → 站点静默回退已定稿口径 |
| 退出码 | `2` = 降级（本次未发布任何本月至今数据，需重跑）；`--no-fetch` 是离线结构自检，仍为 `0` |
| 定稿容错 | `monthly_update.js` 阶段 9.5 遇退出码 2 只告警不中断，并提示手工重跑 `--push` 恢复本月至今数据 |

**闸门挂在 `degraded` 标志上、而不是挂在数值上** —— 已验证「`degraded: true` 但数值被填成 0」（模拟修复前的伪数据）时前端**仍不展示本月数据**。

**手工复现验证**（`js/progress.json` 是已提交文件，改完记得还原）：
```bash
cd <repo>
cp js/progress.json /tmp/real.json            # 备份（或直接用 git checkout 还原）
node scripts/monthly_progress.js --no-fetch --json /tmp/degraded.json    # 生成降级快照
cp /tmp/degraded.json js/progress.json
node scripts/smoke_check.js                   # 应出现 5 条「降级快照…」PASS 且整体全绿
cp /tmp/real.json js/progress.json            # 还原
node -e "..." # 或用 jsdom 场景化脚本：_check_degraded.js（见 CODEBUDDY.md「G. 降级闸门」）
```

---

## 数据起点地板（2015-08，不可前移）

- **入场月永久固化 `2015-08`**，首个可算收益月 `2015-09`，全 12 个入场起点（2015-08 ~ 2025-08）窗口全部真实数据覆盖。
- **为何是 2015-08**：五资产中历史最短的是**中证500（510500）**，新浪真实日 K 线最早仅 2015-08（首收益 2015-09）。沪深300 虽有 2015-07（股灾月 −14.12%），组合接不到 2015-07。故 `2015-08` 是数据能支撑的**最早起点地板**，非人为设定。
- **纪律：`months` 只增量 append 末月**。`fetch_returns.py --write` 往尾部 push 标签与收益，**永不改 `months[0]`**（2015-08）。追加新月份（2026-09、2026-10…）只让窗口变长，起点纹丝不动。

## 风险与边界

- 不要凭空造目标月收益：月未结束或无法取数时宁可不更新，也不用历史均值填。
- 双数据源（`data.js` + `real_returns.json`）必须同步改。
- 派生指标重算不全 → 页面出现「汇总表新、方案数字旧」的矛盾，上线前务必跑阶段 3。
- 版本号忘 bump → 线上看不出变化（毛子云 CDN + 浏览器缓存双重缓存）。
- **⚠️ 新浪部分代码历史深度不足**：实测新浪现在对标普500(513500)/纳斯达克100(513100)/黄金(518880) 只回约 900 根日 K（≈2023-04 / 2020-05 起），但 `data.js` 这三只均有 `2015-09` 起完整历史（当年取数通道更深）。**每月增量 append 安全**（只取最新月）；但**整文件从新浪重抓会丢 2015–2023/2020 历史**。→ `js/data.js` + `js/real_returns.json` 已被 git 管理即权威备份；取数脚本只增量 append，绝不整文件按新浪重生成。
- **`js/progress.json` 是唯一「不靠版本号 bump」的动态资源**：内容由 `monthly_progress.js` 重写，缓存由 `worker.js`（60 秒）+ 前端 `?t=` 参数控制，改它无需动 `index.html`。其数值属"本月至今（MTD）"口径，**切勿抄进 `data.js` 或任何静态文案**（一旦抄入，页面会出现"未完成月混进官方指标"的矛盾）。
  → 展示位置 = ①『完整持仓日志』表格的「🟡 进行中」行（正序在末行 / 倒序在首行）② 滚动板块外部：汇总表末「进行中月份」行 + 「本月至今」明细块。
- **⚠️ 新浪部分代码历史深度不足**：实测新浪现在对标普500(513500)/纳斯达克100(513100)/黄金(518880) 只回约 900 根日 K（≈2023-04 / 2020-05 起），但 `data.js` 这三只均有 `2015-09` 起完整历史（当年取数通道更深）。**每月增量 append 安全**（只取最新月）；但**整文件从新浪重抓会丢 2015–2023/2020 历史**。→ `js/data.js` + `js/real_returns.json` 已被 git 管理即权威备份；取数脚本只增量 append，绝不整文件按新浪重生成。
