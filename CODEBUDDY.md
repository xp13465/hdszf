# 恒市值助手 — 项目记忆文件

> 最后更新: 2026-09-02（数据刷新至日历 2026-08，131 → 132 个月） | 维护者: CodeBuddy AI + @sugas

---

## 一、项目概览

**名称**: 恒市值助手  
**GitHub**: `xp13465/hdszf`  
**线上地址**: `https://h.sugas.site/`  
**部署架构**: GitHub → Cloudflare Workers + Assets（`wrangler.jsonc`），推送即自动发布  
**CDN 链**: 浏览器 → 毛子云 CDN（MaoziYun, max-age=1200）→ Cloudflare Worker → 静态资源  
**技术栈**: 纯静态 HTML/CSS/JS + ECharts 5.5 + qrcode-generator 1.4.4  
**本地预览**: `python3 -m http.server 8080 --bind 0.0.0.0 --directory /workspace/investment-advisor`  
**测试工具**: `playwright-cli`（Chromium 浏览器自动化）

---

## 二、文件结构

```
investment-advisor/
├── index.html              # 主页面 + 内联 <style>（跨皮肤通用样式）
├── CODEBUDDY.md            # 本文件（项目记忆）
├── _headers                # Cloudflare Workers Assets 响应头规则（目前未生效，见 §十一）
├── worker.js               # Cloudflare Worker 脚本（拦截 CSS/JS 设 Cache-Control）
├── css/
│   ├── style.css           # 商务风主题（默认，藏蓝+暖金）
│   ├── modern.css          # 清新现代风（绿+白）
│   └── tech.css            # 深色科技风（深蓝+青绿）
├── js/
│   ├── data.js             # 核心数据（132个月真实收益、13只基金净值、三档对比）
│   ├── engine.js           # 主回测引擎（trendData 205条预计算插值法）⚠️ 前视偏差
│   ├── rolling.js          # 滚动回测引擎（逐月真实回测，无前视偏差）✅ 可审计；完整持仓日志含「年度收益率」列
│   ├── charts.js           # ECharts 图表（含雷达图三色图例）
│   ├── sliders.js          # 滑块交互
│   ├── share-image.js      # 分享图生成（Canvas 绑制，含站点二维码）
│   ├── vendor/
│   │   └── qrcode.min.js   # qrcode-generator 1.4.4（本地 vendor，免 CDN 依赖）
│   └── main.js             # 主入口（UI渲染、事件、授权弹窗、主题切换）
├── images/
│   ├── douyin-card.jpg     # 抖音名片图（1125×1680，授权弹窗用）
│   └── og-preview.png      # OG 社交分享预览图（1200×630）
├── scripts/
│   └── generate_og_image.py # OG 预览图生成脚本（Python+Pillow）
├── sitemap.xml             # 站点地图（提交到 Google/Bing）
├── robots.txt              # 爬虫规则
├── .gitignore              # 含 .playwright-cli/ 排除
├── wrangler.jsonc          # Cloudflare Workers+Assets 部署配置
└── 恒市值法理财操作表（稳健型）.xlsx  # 下载用 Excel
```

---

## 三、核心概念

### 恒市值法（Constant Market Value）
- 每个资产有**固定目标市值**（如黄金始终 ¥100,000），永不改变
- 每月检查：实际市值偏离目标 > ±5% → 调仓回目标
- 现金作为"吸收池"：其他资产卖出回流，买入从中扣除
- **不是恒定比例法**（那个会让目标随总市值涨跌）

### 稳健型配置
| 资产 | 目标比例 | 目标市值 |
|------|---------|----------|
| 沪深300 | 15% | ¥75,000 |
| 中证500 | 5% | ¥25,000 |
| 标普500 | 15% | ¥75,000 |
| 纳斯达克100 | 20% | ¥100,000 |
| 黄金 | 20% | ¥100,000 |
| 现金·货币基金 | 25% | ¥125,000 |

### 三种建仓模式（滚动回测12行）
- **一次建仓版**（2015-08 入场，133个月快照=入场月+132真实收益月）：第1月全仓买入 → 红色标签
- **分批建仓版·同起点**（2015-08 入场，133个月）：12次分批 → 橙色标签（公平对比）
- **分批建仓版**（2016-08 ~ 2025-08，122~13个月）：12次分批 → 蓝色标签
> 注：2026-09-28 修复 off-by-one 后，日志末月已追到数据最新月（2026-08）。每月补数后窗口自动延伸，无需改 `CONFIG.endMonth`（见下方「完整持仓日志修复」）。

---

## 四、回测数据与指标

### 数据来源
- 月度收益：新浪财经前复权K线（2015-08 ~ 2026-08，132个完整月，全部真实）
- 基金净值：天天基金网 API（13只基金，35,784条记录）
- 数据处理：前复权含分红、多基金规模加权合成、QDII溢价3%/8%分档

### 回测参数
- 初始资金: 50万 | 再平衡阈值: ±5% | 交易费率: 0.1%
- 建仓期: 1个月（一次）或 12个月（分批）
- 无风险利率: 2%（硬编码）

### 关键指标公式
- **年化收益**: CAGR `(终值/初值)^(1/年数) - 1` ✅
- **Sharpe**: `(年化 - 0.02) / 年化波动率` ✅
- **Sortino**: 仅负收益率的下行标准差 `(年化 - 0.02) / 下行波动率` ✅（已修正）
- **最大回撤**: 峰值追踪法 ✅

---

## 五、关键业务规则

### 颜色规范（中国习惯）
- 🔴 红色 = 上涨/盈利 → `--color-success: #c53030`
- 🟢 绿色 = 下跌/亏损 → `--color-danger: #1a7d3a`
- 中性指标（Sharpe等）→ 藏蓝/灰色

### 跨皮肤样式架构（重要！）
- **内联 `<style>`**（index.html `<head>`）：滚动表格、弹窗、授权窗口等跨皮肤通用组件
- **`style.css`**：商务风主题默认加载
- **`modern.css` / `tech.css`**：切换时 JS 替换 `#theme-style` 的 href
- ⚠️ 新增弹窗/表格样式必须同时加到内联 `<style>` 块，否则非默认皮肤不可见

### Hero 网格比例
- 三主题统一 `grid-template-columns: 1.12fr 1fr`
- 左侧大卡片 558px / 右侧统计 498px
- 修改时三主题同步更新

### JavaScript 陷阱
- **`||` vs `??`**: 月收益为 `0` 时，`0 || fallback` 返回 fallback，必须用 `0 ?? fallback`
- **现金管理**: `holdings['现金·货币基金']` 和 `cashBalance` 需在每月初合并
- **授权口令加密**: XOR + 十六进制 + Base64，JS 中无明文 `377162882@sugas`

---

## 六、授权弹窗

- **口令**: `377162882@sugas`（XOR+Hex+Base64 加密，密文在 `_h` 变量）
- **有效期**: 5分钟（localStorage + 时间戳）
- **行为**: 每次点击下载都弹窗，解锁后显示"📥 下载文件"按钮
- **名片图**: `images/douyin-card.jpg`
- **复位**: 已解锁状态点击"🔓 重置授权（测试用）"
- **锁图标**: 内联 SVG（非 emoji，多平台兼容）

---

## 七、部署流程

1. `git add -A && git commit -m "..." && git push origin main`
2. Cloudflare 自动执行 `npx wrangler deploy`
3. `wrangler.jsonc` 声明 Worker 名称 `hdszf` + `main: worker.js` + `assets.binding: ASSETS` + `run_worker_first: true`
4. 毛子云 CDN 缓存 20 分钟 → 部署后最多 20 分钟用户才能看到新样式（待后台调整为 5 分钟）

---

## 八、SEO 基础设施

### 元标签（index.html `<head>`）
- **Title**: `恒市值助手 — 11年数据验证的资产配置策略 | 恒市值助手`
- **Description**: 含恒市值助手、11年数据、资产范围等关键词
- **Keywords**: 恒市值法, 恒定市值法, 资产配置, 回测工具, 恒市值助手, h.sugas.site
- **Canonical URL**: `https://h.sugas.site/`
- **OG 标签**: og:title, og:description, og:image (1200×630), og:url, og:type, og:site_name, og:locale
- **Twitter Card**: summary_large_image + twitter:image
- **JSON-LD**: Schema.org WebApplication + Offer (免费) + Thing (恒市值法)，品牌名恒市值助手

### 静态 SEO 文案
- 位于 `</body>` 前，`position:absolute;left:-9999px` 隐藏（爬虫可见、用户不可见）
- 包含 h1、核心功能列表、资产配置、数据来源、关键词

### 站点地图
- `sitemap.xml` — 标准 sitemaps.org 协议，URL + lastmod + changefreq + priority
- `robots.txt` — Allow all, Disallow node_modules/.git/CODEBUDDY.md，指向 sitemap

---

## 九、分享图功能

### 技术架构
- 使用 HTML Canvas API，750×1000 竖版（适合朋友圈/小红书/微博）
- 二维码使用 `qrcode-generator` 的 `getModuleCount()` + `isDark()` API **逐像素**绑制
  - ⚠️ 不要用 `new Image().src = dataUrl` → 异步导致空白
  - ✅ 用 `qr.getModuleCount()` 遍历模块 + `ctx.fillRect()` 逐个绑制暗色像素

### 两种分享图
| 类型 | 触发按钮 | 内容 |
|------|---------|------|
| Hero 宣传海报 | 所有分享入口 | 标题 + 3核心指标 + 4数据亮点 + 6资产条形图 + 二维码 + CTA |
| 回测结果分享图 | (已移除，代码保留) | 6指标 + 6资产条形图 + 二维码 |

### 分享入口（共 3 处）
| 位置 | 按钮文字 | 样式 | 代码位置 |
|------|---------|------|---------|
| Hero CTA 区 | 📸 分享 | btn-outline | share-image.js init() ① |
| 右下角浮动 | 📸 | theme-toggle-btn | share-image.js init() ② |
| 最终方案下载区 | 📸 生成分享图 | btn-accent（金色填充） | share-image.js init() ③ |

### 文字颜色规范（深蓝底分享图）
- 资产名称: `rgba(255,255,255,0.85)`
- 百分比: `rgba(255,255,255,0.95)`
- 进度条背景: `rgba(255,255,255,0.15)`

---

## 十、版本号管理

### 当前版本号
| 文件 | 版本 | 位置 |
|------|------|------|
| style.css | v=18 | index.html line 58 |
| modern.css | v=18 | main.js themeMap |
| tech.css | v=18 | main.js themeMap |
| data.js | v=20 | index.html line ~721 |
| engine.js | v=21 | index.html |
| sliders.js | v=9 | index.html |
| charts.js | v=17 | index.html |
| rolling.js | v=12 | index.html |
| share-image.js | v=5 | index.html |
| main.js | v=41 | index.html |

### 版本号修改规则
- **每次修改 CSS/JS 后必须 +1**
- 涉及文件：index.html 引用链接 + main.js 的 themeMap（CSS 版本号同步）
- 目的：绕过毛子云 CDN 的 20 分钟缓存

---

## 十一、已知问题

### 🔴 缓存问题（重要）
- **现象**: 代码 push 后用户需强刷浏览器才能看到新样式
- **根因**: 毛子云 CDN 在 Cloudflare 前面，设置 `cache-control: max-age=1200`（20 分钟），覆盖了 Cloudflare Worker 设置的头
- **CDN 链**: 浏览器 → 毛子云（MaoziYun/3.17.0, max-age=1200）→ Cloudflare Worker → 静态资源
- **已尝试的修复**（均被毛子云覆盖）:
  - `_headers` 文件设置 Cache-Control（无效，纯 Assets 模式不支持）
  - Worker 脚本设置 Cache-Control（无效，毛子云覆盖）
  - `run_worker_first: true`（无效，毛子云覆盖）
- **待办**: 在毛子云后台将 CSS/JS 缓存时间从 1200s 改为 300s

### 🟡 功能问题
- [ ] engine.js 的 `w_positive_ratio` 在 trendData 中 191/195 缺失，导致交互回测月胜率偶尔显示 0%
- [x] ~~months 数组 132 个元素 vs 收益率数据 131 条~~ → 2026-09-02 已解决：`months` 为月末标签，长度恒为「收益条数+1」；追加日历 2026-08 真实收益后变为 **months 133 / 收益 132 条**，无均值占位。同时修正 `fetch_returns.py` 的错误偏移（旧版 `prev_label()` 会把新月份收益覆盖上月真实值）
- [ ] 基金表格中 510880（红利ETF）和 511010（国债ETF）未纳入 funds 数组
- [ ] 参数缺乏敏感度分析（±3%/±7% 阈值、6/18个月建仓等对比）
- [ ] 手续费 0.1% 未考虑 ETF 滑点和冲击成本

### 📌 数据口径备忘（2026-08-20 核验）
- **数据源**：回测月收益来自**新浪财经前复权日K线**（`money.finance.sina.com.cn` getKLineData scale=240 adj=qfq），月末close/上月末close-1；不是 eastmoney 基金净值。取数脚本见 `scripts/fetch_returns.py`。
- **基金代码**（xlsx 主选ETF ≈ `js/data.js` funds 数组）：沪深300=510300、中证500=512500、标普500=513650、纳斯达克100=159659、黄金=518660。
- **月份标签口径（2026-09-02 修正，此前记录是错的）**：`months` 是**月末标签数组**，长度恒为「收益条数 + 1」；`returns[i]` = **日历月 `months[i+1]`** 的收益。**标签直接等于日历月，没有任何偏移。**
  - 反例验证：`returns` 末位值（旧数据末位标签 `2026-07`）实测 = 日历 2026-07 的真实月收益（-7.29%），与新浪取数一致。
  - 因此：`months = [2015-08 … 2026-08]`（133 条）配 `returns`（132 条），日历覆盖 **2015-09 ~ 2026-08**。`months[0]=2015-08` 是**起点标记**（入场时点），不是第一个收益月。
  - ⚠️ 旧备忘曾写「标签 = 日历 − 1，`prev_label()` 做减月」——**该说法已证伪并删除**。`scripts/fetch_returns.py` 的 `prev_label()` 曾据此实现，会把新月份收益**覆盖掉上月的真实值**；现已改为恒等映射。若看到任何地方仍写着「标签比日历早 1 个月」，一律以本节为准并修正。
- **回测引擎架构（2026-08-21 修正）**：`engine.js.compute` 主路径已切到自包含的恒市值法回测 `simulateCMV`（含建仓+±阈值再平衡+费率，直读 `APP_DATA.realReturns` 全量真实月收益，无前视偏差）。`trendData`（205条硬编码表）降级为 `realReturns` 缺失时的兜底，不再驱动主展示。此前"数据更新了页面却不变"的根因正是主路径走 trendData 插值、未读最新月份。`comparisons`（三档方案）与 `finalConfig.backtest` 已用 `simulateCMV` 重算回填（反映最新月份）。`main.js` 的 `initComparisonCards` 已于 2026-08-21 改为动态调用 `simulateCMV`（三档配置内联于函数内），真实数据缺失时回退 `APP_DATA.comparisons` 静态值。至此三档对比卡片随数据更新自动生效，不再需要手工回填 `comparisons`。
- **首屏 Hero 卡片（2026-08-21 修正）**：此前 `index.html` 首屏 4 张统计卡（50万→终值/月胜率/最大回撤/现金比例）是**写死的静态 HTML**，改数据后永不变。现 `main.js` 新增 `updateHeroStats(result)`，在 init 里用 `getDefaultResult()`（=simulateCMV 稳健型）实时填充 8 个 ID 元素（`hero-final-value/sub`、`hero-winrate-label/value/sub`、`hero-dd-value/sub`、`hero-cash-value`）。`simulateCMV` 返回值扩展了 `monthlyReturns/positiveMonths/totalMonths/yearly{fullYears,negativeYears,worstYear}`，供"月胜率 x/y 月"和"10年仅N年亏损·最多亏Z%"动态展示。更新后的文案（og:description、三档说明 insight-box、最终方案副标题、SEO 隐藏文本）仍为静态，需随数据更新手工刷新，位置见 RELEASE_CHECKLIST 阶段4。
- **全站审计（2026-08-21 追加）**：
  - **回测窗口统一**：`simulateCMV` 改为按**真实收益数据条数**迭代（排除 `months` 末位"下月占位"标签），与 `rolling.js` 口径一致。此前 132(含占位) vs 131(真实) 导致交互回测年化(7.44%)与滚动最长窗口(7.49%)矛盾。每月补数后条数自动增长，无需改代码。
  - **三档配置唯一事实来源**：`BacktestEngine.PLANS`（conservative/balanced/aggressive 分配），对比卡片(`initComparisonCards`)、雷达图、4个对比柱状图(`charts.js getPlansMetrics`)全部由它驱动，实时 `simulateCMV`。`data.js` 的 `comparisons` 仅作真实数据缺失时的兜底与 README 对照。
  - **收益/回撤曲线**：`engine.js.generateMonthlyReturns` 改为基于 `simulateCMV` 的月度序列（恒市值法），曲线终点=总收益、最小回撤=最大回撤，不再用"买入持有加权"模型。
  - **分享图**：`share-image.js` Hero 海报动态取 `getDefaultResult()`；结果卡月胜率改用 `monthlyWinRate`（原用不存在的 `winRate` 恒回退 67.9%）。
  - **口径刷新**：`data.js` comparisons/finalConfig.backtest、`index.html` 静态文案（og:description、insight-box 三档、section-subtitle、SEO 隐藏文本、Hero 静态回退值）、README 三档表全部同步到 131 月口径（稳健年化 7.49%、Sharpe 0.91、终值 110.1万、月胜率 67.9%）。
- **发布前自检**：`node scripts/smoke_check.js` 一键校验引擎一致性、Hero ID 齐全性、回测窗口=真实数据条数、三档动态≈静态（退出码 0=通过）。2026-09-28 起新增第 5 项：**滚动日志末月=数据末月（防 off-by-one 回归）**——加载 `js/rolling.js` 跑 `runAll()`，断言每个起点的末位快照月份 == `months` 末位标签，防止日志又退回 2026-07。

### 完整持仓日志：off-by-one 修复 + 年度收益率列（2026-09-28）
- **现象**：「完整持仓日志」明细表末行只到 **2026-07**，而数据已含 2026-08（132 条真实收益，标签至 2026-08）。用户问"是展示没更新还是模拟没做到最新"——**根因是模拟层 off-by-one，不是展示层**。
- **根因（两处）**：
  1. `rolling.js` 的 `getMonthReturnsWithFallback(monthKey)` 用 `idx = months.indexOf(monthKey)` 直接作 `asset_returns` 索引。但约定 `returns[i] = months[i+1]`（months[0]=2015-08 是入场标记月，无收益），故正确索引应为 **`idx - 1`**。原代码导致每行套用了**次月**收益（如 2015-08 行用了 2015-09 收益、2026-07 行用了 2026-08 收益）。
  2. `getStartPoints` 的 `totalMonthsNeeded` 用日期差公式，把"末月"算成 exclusive，少覆盖 1 个月——循环只到 2026-07，2026-08 这一行从未生成。
- **修复**：
  1. `getMonthReturnsWithFallback` / `getMonthReturns` 改为 `ridx = idx - 1`；入场标记月（`idx===0`）无真实收益，按 **0** 处理（不计入"估计值"，保持全量回测"全部真实"徽章）。
  2. `totalMonthsNeeded` 改为 `months.length - monthIdx`（自动覆盖到 `months` 末位，含 2026-08），每月补数后自动延伸，无需再手改 `CONFIG.endMonth`。
  3. `main.js` 的 `showLogDetail` 新增 **「年度收益率」列**：对每条记录按日历年聚合，展示该年"至今"的**收益金额(¥)** 与**收益比例(%)**（区别于"年化收益=均值"）。yearStartValue = 上一年末总市值（首年=初始资金 50 万），故 12 月行=全年收益、进行中月=年迄今收益。CSV 导出（`exportLogCSV`）同步加了「年度收益率(%) / 年收益金额(元)」两列。
- **新增脚本 `scripts/monthly_progress.js`（进行中月份进度快照）**：每周/每交易日跑，取"当前未完成月"的**月至今(MTD)**收益（新浪前复权日 K 线，与 `fetch_returns.py` 同源），把最新完整月的组合持仓往前推一步，输出带 **🟡 进行中（非完整月）** 标记的组合进度报告。**绝不写 `data.js`/`real_returns.json`**，不污染主回测；真正的月末定稿仍由 `monthly_update.js`（每月 3 号）负责。用法：`node scripts/monthly_progress.js [--out 报告.md] [--no-fetch]`。取数全失败时降级为 MTD=0 占位仍输出。

### 日频回测与再平衡深度研究（2026-08-22）
- **新增能力**：`engine.js.simulateCMV_daily` — 基于日 K 线的恒市值法回测（与月频 `simulateCMV` 同口径，仅频率细化为日）。读 `scripts/_daily_cache.json`，支持 `schedule: 'weekly-mon' | 'biweekly-mon' | 'monthly-eom' | 'every-N-months-eom' | 'every-1-months-cal-N'`（alias `monthly-day-N` → `every-1-months-cal-N`，遇周末顺延下个交易日）。
- **新增脚本**：
  - `scripts/fetch_daily.py` — 拉 5 资产日 K 线（datalen=3000 qfq），优先用 backup 老 ETF 代码（sh513500/sh513100/sh518880/sh510310/sh510500）以获 12 年历史。
  - `scripts/rebalance_study.js` — 重写后跑「研究1：1周/2周/1月/2月/3月」5 档 + 「研究2：1~31 号」31 档，每档产 13 行滚动回测表（与生产线格式对齐）。
  - `scripts/_smoke_daily.js` — 日频引擎冒烟测试。
- **⚠️ 关键发现（该 1279 行报告已废弃重做）**：最初报告使用 `buildMonths=1`（首月满仓），与线上滚动表 `buildMonths=12`（分批建仓）口径不一致 → 数字无法核对。已于本次**同口径重做**，结论见下方「再平衡策略研究（2026-08-22 · 同口径重做）」。
- **生产口径**：日频 maxDd ≈ -20%（vs 月频 -6%）因捕捉月内极端值；日频与月频绝对数不可直接比较，仅同引擎内部横向对比有效。`simulateCMV_daily` 已新增 `endDate` 参数用于对齐月频数据终点。
- **引擎版本**：v20 → v21（新增 `simulateCMV_daily` / `buildRebalanceSet`，未影响月频主路径）。
- **浏览器兼容性**：日频函数检测不到 `require` 时返回 null，浏览器加载零风险（仅 Node 研究脚本调用）。

### 再平衡策略研究（2026-08-22 · 同口径重做）
- **动机**：用户对照滚动回测表，问「1月1次再平衡是否为最优？」「再平衡日（每月 1~31 号）哪天最优？」并发现初版报告（buildMonths=1）与线上（buildMonths=12）数字对不上。
- **修正**：研究报告统一改用**线上同口径**——分批建仓 12 次（`buildMonths=12`）、月频真实数据、阈值 ±5%、费率 0.1%。研究1「每月（=当前默认）」档与线上滚动表**逐行一致**（例：2025-07 入场 = 51.12万 / +2.23% / -4.12% / Sharpe 0.0303 / 7-12）。
- **研究1（频率，月频引擎，可核对）**：5 档（每月/每2月/每3月/每6月/每12月）。全期(一次建仓版)年化 7.34%~7.54%、分批版 7.14%~7.24%，**差异 < 0.4pct**。当前「每月 1 次」已是稳健型下接近最优，无需折腾频率。周级（每周/双周）日频验证差异亦 < 0.4pct（报告附录）。
- **研究2（再平衡日，日频引擎，buildMonths=12）**：31 档（每月第 1~31 号遇周末顺延）。日号间年化 +8.90%~+8.92%，**差异 < 0.02pct，再平衡日无显著影响**。注：研究2 为日频，绝对数（+8.9%）高于月频（因 132 月窗口 + 捕捉月内波动），仅 31 档内部差异反映日号影响。
- **入场时机 >> 再平衡参数**：同一频率下不同起点年化差 4-7pct（如 2021 起点 +5.6% vs 2024 起点 +9.0%），是再平衡策略影响的 10 倍。
- **当前产品默认策略**：1 月 1 次 + ±5% 阈值 + 0.1% 费率，保持不变。
- **报告**：`scripts/_rebalance_study_report.md`（691 行，每象限 12 行滚动表，可逐行与线上核对）。

### 🟢 改进建议
- [ ] 回测结果分享图（generateResultCard）已从 UI 移除但代码保留，如需恢复可在 init() 加回来
- [ ] 可考虑用 `git ls-files` 检查 `.playwright-cli/` 是否被误提交
- [ ] `scripts/fetch_daily.py` 当前 datalen=3000（约 12 年，优先 backup 老 ETF 代码），已满足日级研究；项目数据精度为月的情况下月级研究无需日频，**优先级低**。

### 🔵 数据刷新记录（2026-09-02 · 日历 2026-08 入库）

**做了什么**
- 追加日历 2026-08 真实月收益（新浪前复权日 K 线，5 资产）到 `js/data.js` 与 `js/real_returns.json`：
  沪深300 +0.6877%、中证500 +6.3222%、标普500 +7.6964%、纳斯达克100 +4.9217%、黄金 +8.2851%。
- 数据窗口 131 → **132 个月**（`months` 标签 133 条，`month_count` / `meta.n_months` 132）。
- 重算写死的派生字段 `comparisons`（三档）与 `finalConfig.backtest`，使「动态 ≈ 静态」一致（smoke_check 24 项全 PASS）。
- 滚动表收口月同步：`js/rolling.js` `CONFIG.endMonth` 7 → 8；`js/main.js` `actualEndDate` → `'2026-08'`。起点现为 **2015年8月（132月）… 2025年8月（12月）** 共 12 个。
- **修复取数脚本偏移 bug**：`fetch_returns.py` 的 `prev_label()` 原按「标签 = 日历 − 1」做减月，若用 `--write` 会把新月份收益**覆盖上月真实值**；已改为恒等映射，并订正 docstring、`fund_map.json._offset_note` 与本文口径备忘中同一处错误说法。
- 清理 `js/data.js` 中重复定义的顶层 `meta` 键（后者静默覆盖前者，`generated_from` 实际丢失），合并为一个并把 `data_range` 更新为 `2015-08 ~ 2026-08`。
- 同步静态文案与文档：`index.html`（Hero 卡/og/insight-box 三档/SEO 隐藏段/隐私政策与用户协议日期戳 → 2026年9月2日）、`README.md`、`PROJECT_SPEC.md`（1.1 数据范围 + 1.4 各资产年化按当前数据重算）、`sitemap.xml` lastmod。
- 版本号 bump：`data.js` v20、`rolling.js` v12、`main.js` v41。

**口径结果（132 个月，稳健型）**：年化 7.63%、终值 112.2 万、Sharpe 0.93、最大回撤 −6.09%、月胜率 68.2%（90/132）。
三档：保守 5.66% / 91.6万 / 月胜率 73.5%；稳健 7.63% / 112.2万 / 68.2%；进取 11.64% / 167.9万 / 65.2%。

**遗留**
- `scripts/_daily_cache.json` 日频缓存只到 **2026-08-21**（8 月 20 日会话取的，已过期）。
- `scripts/rebalance_study.js` 读 `js/data.js`，现在重跑会得到 132 月结果，与已入库的 `scripts/_rebalance_study_report.md`（131 月快照）不再逐行一致。研究报告**需重跑刷新或标注快照版本**，见下条待办。
- [ ] 待办：刷新 `_daily_cache.json` 至 2026-08-31 后重跑 `node scripts/rebalance_study.js`，让报告回到可核对状态。

**新旧数据差异（2026-09-02 出报告）**
- 新增工具 `scripts/diff_data_update.js`：把当前 `data.js` 截掉最后 N 个月作为「旧口径」，
  与全量「新口径」各跑一遍 `RollingBacktest.runAll()` + `BacktestEngine.simulateCMV`，
  输出与站内「滚动回测汇总」同构的 12 列表格，并逐指标标注正向/负向。
  用法 `node scripts/diff_data_update.js [--drop N] [--md 输出路径]`，详见文件头注释。
- ⚠️ 实现要点：`data.js` 顶层是 `const APP_DATA`，在 Node `vm` 里 **不会挂到 context 对象上**
  （`ctx.APP_DATA` 是 `undefined`），必须用 `vm.runInContext('APP_DATA', ctx)` 求值取到。
- ⚠️ 对齐口径：收口月后移 1 个月后，常规起点的日历月也整体后移（旧「10 年前」= 2016-07，新 = 2016-08），
  按具体年月只能对上 1 行。**必须按「N 年前入场 + 建仓方式」对齐**，回测月数才相同、才可比。
- 本次结论：**12 个入场起点全部正向，无一恶化**。2026-08 是全面上涨月
  （沪深300 +0.69%、中证500 +6.32%、标普500 +7.70%、纳斯达克100 +4.92%、黄金 +8.29%）。
  稳健型全周期：年化 7.49% → 7.63%（+0.13 pct）、终值 110.1万 → 112.2万（+21645 元）、
  Sharpe 0.91 → 0.93、最大回撤 −6.09% → −6.09%（未加深）。
- 报告：`scripts/data_update_report_2026-08.md`（221 行，随数据一并入库）。

### 数据刷新记录（2026-09-28 · 日志修复 + 年度收益率列 + 进度快照脚本）
**背景**：用户发现「完整持仓日志」明细表末行只到 2026-07（数据已含 2026-08），并希望日志新增「年度收益率」列（区别于年化均值）。

**做了什么**
- **修复滚动回测 off-by-one（模拟层，非展示层）**：
  - `js/rolling.js` 的 `getMonthReturnsWithFallback` / `getMonthReturns` 改为 `ridx = idx - 1`（约定 `returns[i] = months[i+1]`，months[0]=入场标记月无收益）；入场标记月按 **0** 处理（保持全量回测"全部真实"徽章）。
  - `getStartPoints` 的 `totalMonthsNeeded` 改为 `months.length - monthIdx`（自动覆盖到 `months` 末位，含 2026-08）。每月补数后窗口自动延伸，**不再需要手改 `CONFIG.endMonth`**。
  - 效果：12 个起点的日志末月全部从 2026-07 → **2026-08**，且每行改用当月真实收益（此前每行套用次月收益）。
- **新增「年度收益率」列**（`js/main.js` 的 `showLogDetail`）：对每条记录按日历年聚合，展示该年"至今"的**收益金额(¥)** 与**收益比例(%)**（yearStartValue=上一年末总市值，首年=初始资金 50 万）。CSV 导出同步加「年度收益率(%) / 年收益金额(元)」两列。
- **新增 `scripts/monthly_progress.js`（进行中月份进度快照）**：取"当前未完成月"的**月至今(MTD)**收益（新浪前复权日 K 线，与 `fetch_returns.py` 同源），把最新完整月的组合持仓往前推一步，输出带 **🟡 进行中（非完整月）** 标记的报告。**绝不写 `data.js`/`real_returns.json`**，不污染主回测。用法 `node scripts/monthly_progress.js [--out 报告.md] [--no-fetch]`。
- **`scripts/smoke_check.js` 新增第 5 项守卫**：加载 `js/rolling.js` 跑 `runAll()`，断言每个起点末位快照月份 == `months` 末位标签，防止日志 off-by-one 回归。
- 删除调试用临时脚本 `scripts/_log_check.js`（不入库）。
- **未改 `data.js` / `engine.js`**：本次无新月份数据（2026-09 尚未走完，9/28 实时 MTD 沪深300 −5.72%，待 10 月初再定稿）。
- 版本号 bump（绕 CDN 缓存）：`index.html` 中 `rolling.js` v12 → **v13**、`main.js` v41 → **v42**。

**口径结果（不变）**：主引擎 `simulateCMV` 官方口径未动，稳健型仍年化 7.63% / 终值 112.2 万。滚动日志为独立引擎，其末月延伸 + 回归当月真实收益后，与官方口径的"方向/量级"一致（如 2026-08 组合月收益 +1.99% 对应当月沪深300 +0.69%、黄金 +8.29% 加权）。

---

## 十二、本次会话完成工作

### SEO 优化（3 项）
- 增强 title/description/keywords（含恒市值助手/h.sugas.site）
- 新增 canonical、author、robots、OG、Twitter Card 标签
- 新增 JSON-LD 结构化数据（Schema.org WebApplication）
- 新增静态 SEO 文案区块（爬虫可见）
- 新增 sitemap.xml + robots.txt

### 分享图功能（5 项）
- Canvas 绑制 Hero 宣传海报 + 回测结果分享图
- qrcode-generator 像素级二维码（修复 Image.onload 异步空白 bug）
- 3 处分享入口：Hero CTA / 右下角浮动 / 下载区
- 删除冗余入口（Hero 第 7 卡、交互式回测区按钮）
- 深蓝底文字颜色修复（灰色 → 白色）

### 视觉调整（3 项）
- OG 预览图 1200×630（Python+Pillow 生成）
- Hero 网格比例 1:1 → 1.12:1（左 558px / 右 498px）
- 三主题 CSS 同步更新（style/modern/tech）

### 基础设施（4 项）
- 版本号全面升级（所有 CSS/JS 引用 +1）
- 新增 Worker 脚本（拦截 CSS/JS 设置 Cache-Control，但被毛子云覆盖）
- 新增 `_headers` 文件
- `.gitignore` 添加 `.playwright-cli/`

---

## 十三、最近提交历史

```
c907afd fix: wrangler.jsonc 加 run_worker_first: true
315185e fix: Worker 脚本直接设置 CSS/JS 的 Cache-Control: max-age=300
8cd08d0 fix: _headers 文件移除注释
c6b235f fix: 添加 Worker 脚本绑定 ASSETS 以激活 _headers 缓存策略
80fdca5 fix: 更新 compatibility_date 为最新日期
3072b6d fix: 使用 _headers 文件正确设置 CSS/JS 缓存策略
60dc1da fix: Cloudflare 缓存策略优化
46f5f7b ui: Hero 网格比例微调 1.25→1.12
37db56a ui: Hero 网格比例从 1:1 改为 1.25:1
f348175 fix: 分享图文字白色 + 删除冗余分享入口 + Hero CTA 加分享按钮
8ff4740 chore: 添加 .playwright-cli/ 到 .gitignore
f53e224 fix: 5 项问题修复（二维码空白/首屏分享入口/浮动分享/按钮透明/版本号）
4f3c68a fix: 移除 Hero 挤压的分享图按钮 + 分享图加二维码
f036f0d feat: SEO 优化 + 分享图生成 + OG 预览图 + sitemap/robots
070f426 docs: 更新项目记忆文件
```
