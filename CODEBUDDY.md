# 恒市值助手 — 项目记忆文件

> 最后更新: 2026-09-30（新增 Ubuntu/Linux 云服务器 cron 部署，运行器跨平台化） | 维护者: CodeBuddy AI + @sugas

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
│   ├── monthly_update.js    # 月度定稿一键流程（取数→重算→bump→文案→文档→自检→commit/push）
│   ├── monthly_progress.js  # 本月至今（MTD）快照 → js/progress.json
│   ├── smoke_check.js       # 72 项断言自检（发布闸门）
│   └── generate_og_image.py # OG 预览图生成脚本（Python+Pillow）
├── crontab/                 # 纯脚本自动化（Windows 计划任务 / Linux cron + 手动，零 AI 依赖）→ 见 §七
│   ├── run_job.js           #   运行器（跨平台）：闸门 + 单实例锁 + 时区归一 + 日志 + 回滚 + 自愈推送
│   ├── status.js            #   健康检查（跨平台：Windows 查 schtasks / Linux 查 crontab）
│   ├── check_env.js         #   环境体检·深度层（跨平台，只读）：运行时/仓库/凭据/网络/目录/磁盘
│   ├── check_env.sh         #   环境体检·Linux 引导层（apt 依赖 + cron 服务 + --fix 自动装）
│   ├── check_env.cmd        #   环境体检·Windows 引导层（找 node + winget --fix）
│   ├── install.cmd / uninstall.cmd / status.cmd   #   Windows 计划任务（install 先跑 check_env）
│   ├── install.sh / uninstall.sh / status.sh      #   Linux cron（install 先跑 check_env）
│   └── README.md            #   完整用法（第 10 节云服务器部署 / 第 11 节环境检测与依赖安装）
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

### 数据自动更新（纯脚本 · Windows 计划任务 / Linux cron，零 AI 依赖）

> **2026-09-29 起**：数据更新与月度固化**不再依赖 AI / WorkBuddy 会话**，改由系统调度器驱动。
> 完整文档（安装命令 / **手动跑法与频率** / 查看清单 / 维护方法 / 故障处置）见 **`crontab/README.md`**。
> 不装调度器也能用：手动每交易日跑 `node crontab/run_job.js mtd --force`、每月跑 `node crontab/run_job.js finalize --force`
> （`--force` = 手动补跑模式：忽略时间窗口等**软闸门**并逐条打印警告，可在任意时间点执行）。详见 README 第 3 节。

| 平台 | 注册 | 触发 | 执行 | 频率 |
|---|---|---|---|---|
| Windows（本机） | `crontab\install.cmd` | 每天 18:00–23:59（mtd）/ 09:00–23:59（finalize）每小时唤醒 | `node crontab/run_job.js <job>` | mtd 每交易日 1 次；finalize 每月 1 次（3 日起） |
| **Linux/Ubuntu（云服务器，推荐）** | **`bash crontab/install.sh`** | 全天每小时第 7 / 37 分钟唤醒 | 同上 | 同上 |

### 环境体检（2026-09-30 加，装调度器之前必跑）

`install.sh` / `install.cmd` 已**自动先跑一遍**，有阻塞项就中止（`--no-check` 可跳过）——避免「装上了却长期空跑」。

| 文件 | 角色 | 内容 |
|---|---|---|
| `crontab/check_env.js` | 深度层（跨平台，只读） | 运行时版本 / 仓库与工作区 / 推送凭据 / 网络 / 日志目录 / 磁盘 / 调度器条目；支持 `--json`、`--no-runtime`、`--no-network` |
| `crontab/check_env.sh` | Linux 引导层 | 系统 / apt 依赖 / cron 服务 / sudo / 时区 / 时钟同步 + **`--fix` 用 apt 装依赖**（node 必须显式 `--fix-node` 走 NodeSource），随后调 `check_env.js` |
| `crontab/check_env.cmd` | Windows 引导层 | 找 node（缺失则给 winget 命令）→ 调 `check_env.js`；`--fix` 用 winget 补 git / python |

- 用法：`bash crontab/check_env.sh [--fix] [--fix-node] [--no-network] [--quiet] [--print-node]`；退出码 `0`=无阻塞、`1`=有阻塞、`2`=参数错。
- **设计要点**：深度检查写在 node 里（两平台共用，不会漂移）；「node 本身缺不缺 / cron 装没装 / apt 能装什么」只能在 node 之外判断 → 放各自引导层。
  引导层的阻塞/警告数经环境变量 `HDSZF_ENV_UPSTREAM_FAIL/WARN` 带进 `check_env.js`，**最终只出一份合并汇总**。
- ⚠️ 新增 `check_env.js` 时踩到的两个真坑：①**不能在 CommonJS 里用顶层 `await`**（会直接语法错），所以整个流程包在 `async function main()` 里；
  ②**Git Bash / MSYS 下 `node` 不认 `/c/…` 形式路径**（会当成 `C:\c\…`）→ 传路径给 node 前先 `cygpath -w` 转原生（Linux 无此问题，`install.sh` 也加了同样处理）。
- ⚠️ **单文件超长 batch 风险**：`.cmd` 里括号块 + 管道 + `^>` 的组合极易被二次解析吃掉转义。Windows 引导层因此刻意做成**薄启动器**（只找 node + 转调 `.js`），不用大段 batch 做检查逻辑。
- `.cmd` 必须 CRLF（`.gitattributes` 已锁 `*.cmd eol=crlf`）—— LF-only 的 `.cmd` 在 `goto`/`call` 标签上行为异常。

**关键设计（改动前必读）**
- 运行器 `crontab/run_job.js` 自带闸门：**当天/当月成功一次后立即跳过**，因此可以高频唤醒（错过就补跑）而不会重复提交、重复部署。
- 时段选择有业务含义：MTD 排在 **18:00 之后**（A 股 15:00 收盘、新浪日 K 傍晚更新，早跑会取到昨日收盘）；定稿排在 **每月 3 日之后**（给上月末最后一个交易日留发布余量）。**不要随意把时间提前。**
- 运行器只决定「何时跑、跑了记什么」，**不产出任何数值**；「月未走完不更新」仍由 `monthly_update.js` 自己把住（未走完 → exit 0）。
- **日志与状态写在仓库之外**（`<工作区>\_hdszf_logs\` / Linux 为 `<仓库上级>/_hdszf_logs/`）：仓库根是 Cloudflare Assets 发布目录，放进去会被公开上传并污染 git。可用 `HDSZF_LOG_DIR` 覆盖。
- **定稿前置：工作区必须干净（硬闸门，`--force` 也不绕过）**：定稿内部是 `git add -A` + commit，脏工作区会把人工改动
  一起裹进「数据更新」提交并 push 上线 → 运行器检测到不干净就**跳过并提示先 commit/stash**。
  ⚠️ 绕过运行器直跑 `scripts/monthly_update.js` 时**没有这道保护**，务必自己先确认 `git status` 为空
  （`monthly_progress.js` 无此风险：只 `git add -- js/progress.json` 单文件）。
- **失败自动回滚**：定稿失败若留下未提交改动，自动 `git checkout -- .` 还原成「什么都没发生」，避免半成品被下次运行继续加工。
- **自愈推送**：每次运行前 `fetch` 并比对本地 HEAD 与远程 tip：本地领先就先补推；**远程领先/分叉时只告警不硬推**
  （那说明另一台机器也在跑自动化）。⚠️ **自动化只应有一台机器在跑**（推荐云服务器；本机作替补手动补跑）。
- 退出码语义：`0` 成功或按设计跳过；`2` 降级（按铁律不写入不推送，站点回退已定稿口径）；其它为真失败。

**跨平台演化（2026-09-30，为 Ubuntu 云服务器而做）**
- **时区归一（TZ-GUARD）**：`run_job.js` / `status.js` / `monthly_progress.js` / `monthly_update.js` 启动即
  `process.env.TZ = process.env.HDSZF_TZ || 'Asia/Shanghai'`（必须在任何 `new Date()` 之前；Node 16+ 赋值即时生效，已实测）。
  ⚠️ **实际运行门槛是 Node ≥ 18**：实时取数用全局 `fetch`（Node 18+ 才有），`monthly_progress.js` 已加前置守卫与装法提示；
  Ubuntu 22.04 的 `apt install nodejs` 只给 12.x，须用 NodeSource / nvm。
  原因：闸门的「18:00 后 / 周末 / 每月 3 日后」按北京时间判断，而云服务器默认多为 **UTC**，不归一会整体错 8 小时
  （表面成功、数据日期却错）。全仓搜 `TZ-GUARD` 可定位这 4 处，改要一起改。
- **单实例锁（Linux 必需）**：两个任务共用一把 `_hdszf_logs/automation.lock`。Windows 计划任务默认「已在运行就不再启动新实例」，
  而 **cron 没有**这层保护，且 mtd 与 finalize 的时段本来重叠 —— 没有锁时两个进程会同时 `git commit/push` 互相踩。
  判定：`wx` 原子写入抢锁 → 已有锁则看 pid 是否存活 + 锁龄（>60 分钟视为僵尸自动接管）。`--force` 不绕过。
- **cron 写「全天每小时唤醒」而非固定小时**：写死 `18-23` 会在 UTC 服务器上错 8 小时；时段判断交给运行器闸门最安全
  （多几次空转，每次几百毫秒）。`install.sh --hours 18-23` 会自动补 `CRON_TZ=Asia/Shanghai` 并告警。
- **Linux 上再无 Windows 假设**：`PATH` 按平台构建（`/usr/local/bin:/usr/bin:/bin` 等）、`HOME` 用 `os.homedir()` 兜底、
  业务脚本找 Python 按平台换候选（Linux 用 `python3`）并给出「怎么装」的明确报错。`install.sh` 还会预检
  **SSH 推送凭据**（deploy key + `ssh-keyscan` + 勾 write access）——无头服务器最易翻车的一步。
- ⚠️ 新增 **`.gitattributes`**：`*.sh text eol=lf`（否则 `.sh` 落盘成 CRLF，Linux 报 `bad interpreter: ...^M`）、`*.cmd/*.bat eol=crlf`。
- ⚠️ WorkBuddy 里的两条旧自动化（每月 3 日 / 每周一）与本方案**功能重叠**，启用本方案后应停用，避免同一天两处同时 push。

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

### 当前版本号（2026-09-29 更新）
| 文件 | 版本 | 位置 |
|------|------|------|
| style.css | v=19 | index.html `<link id=theme-style>` **+ main.js themeMap.business 必须同步** |
| modern.css | v=18 | main.js themeMap |
| tech.css | v=18 | main.js themeMap |
| data.js | v=21 | index.html |
| engine.js | v=24 | index.html |
| sliders.js | v=9 | index.html |
| charts.js | v=17 | index.html |
| rolling.js | v=19 | index.html |
| share-image.js | v=6 | index.html |
| main.js | v=55 | index.html |

> 查当前值：`grep -o "js/[a-z_-]*\.js?v=[0-9]*\|css/[a-z_-]*\.css?v=[0-9]*" index.html`

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
- **发布前自检**：`node scripts/smoke_check.js` 一键校验引擎一致性、Hero ID 齐全性、回测窗口=真实数据条数、三档动态≈静态（退出码 0=通过）。2026-09-28 起新增第 5 项：**滚动日志末月=数据末月（防 off-by-one 回归）**——加载 `js/rolling.js` 跑 `runAll()`，断言每个起点的末位快照月份 == `months` 末位标签，防止日志又退回 2026-07。2026-09-29 起新增第 6 项：**数据起点固化 2015-08**——断言 `months[0]==="2015-08"`、最早入场月==2015-08、12 个起点快照全为真实数据（无 `estimatedMonth` 泄漏），把"起点地板"锁死防漂移。

### 完整持仓日志：off-by-one 修复 + 年度收益率列（2026-09-28）
- **现象**：「完整持仓日志」明细表末行只到 **2026-07**，而数据已含 2026-08（132 条真实收益，标签至 2026-08）。用户问"是展示没更新还是模拟没做到最新"——**根因是模拟层 off-by-one，不是展示层**。
- **根因（两处）**：
  1. `rolling.js` 的 `getMonthReturnsWithFallback(monthKey)` 用 `idx = months.indexOf(monthKey)` 直接作 `asset_returns` 索引。但约定 `returns[i] = months[i+1]`（months[0]=2015-08 是入场标记月，无收益），故正确索引应为 **`idx - 1`**。原代码导致每行套用了**次月**收益（如 2015-08 行用了 2015-09 收益、2026-07 行用了 2026-08 收益）。
  2. `getStartPoints` 的 `totalMonthsNeeded` 用日期差公式，把"末月"算成 exclusive，少覆盖 1 个月——循环只到 2026-07，2026-08 这一行从未生成。
- **修复**：
  1. `getMonthReturnsWithFallback` / `getMonthReturns` 改为 `ridx = idx - 1`；入场标记月（`idx===0`）无真实收益，按 **0** 处理（不计入"估计值"，保持全量回测"全部真实"徽章）。
  2. `totalMonthsNeeded` 改为 `months.length - monthIdx`（自动覆盖到 `months` 末位，含 2026-08），每月补数后自动延伸，无需再手改 `CONFIG.endMonth`。
  3. `main.js` 的 `showLogDetail` 新增 **「年度收益率」列**：对每条记录按日历年聚合，展示该年"至今"的**收益金额(¥)** 与**收益比例(%)**（区别于"年化收益=均值"）。yearStartValue = 上一年末总市值（首年=初始资金 50 万），故 12 月行=全年收益、进行中月=年迄今收益。CSV 导出（`exportLogCSV`）同步加了「年度收益率(%) / 年收益金额(元)」两列。
- **新增脚本 `scripts/monthly_progress.js`（进行中月份进度快照）**：每周/每交易日跑，取"当前未完成月"的**月至今(MTD)**收益（新浪前复权日 K 线，与 `fetch_returns.py` 同源），把最新完整月的组合持仓往前推一步，输出带 **🟡 进行中（非完整月）** 标记的组合进度报告，同时写 `js/progress.json` 供站点**『完整持仓日志』末行**展示（2026-09-29 起；此前是首页独立区块，已被用户否掉）。**绝不写 `data.js`/`real_returns.json`**，不污染主回测；真正的月末定稿仍由 `monthly_update.js`（每月 3 号）负责。用法：`node scripts/monthly_progress.js [--out 报告.md] [--no-fetch]`。**取数不完整时判为降级（退出码 2）：所有本月至今字段写 `null`、不写入/不推送任何本月数据**，站点自动回退到已定稿口径（详见「G. 降级闸门」）。

### 数据起点固化 2015-08（2026-09-29 · 用户拍板）
- **结论**：回测**起点（入场月）永久固化 `2015-08`**，首个可算收益月 = `2015-09`，全 12 个入场起点（2015-08 ~ 2025-08）窗口全部真实数据覆盖，无任何估计值泄漏。
- **为什么是 2015-08（数据边界，非人为设定）**：五资产组合需五只齐全，历史最短的是**中证500（510500）**——新浪前复权日 K 线对它的真实历史**最早仅 2015-08**（首个可算收益 2015-09）。即便沪深300 有 2015-07（股灾月 −14.12%），组合也接不到 2015-07；故 `2015-08` 是数据能支撑的**最早起点地板**。git 最早提交（d36f0a1）起 `months[0]` 即 `"2015-08"`，从无 2015-07。
- **用户记忆澄清**：用户曾记"起点 2015-07"，实为入场时点心理口径（7 月决定 / 8 月建仓）；首个可算收益月是 8→9 月 = 标签 `2015-09`，系数据真实边界。
- **固化机制（防漂移）**：
  1. `months` 数组**只增量 append 末月**（`fetch_returns.py --write` 往尾部 push），`months[0]`（2015-08）永不前移——结构上起点不可漂移。
  2. `smoke_check.js` 第 6 项守卫：`months[0]==="2015-08"` + 最早入场月==2015-08 + 12 起点 `estimatedMonth` 全为 0，CI/发布前自动拦截起点异常。
- **⚠️ 数据源完整性风险（务必知悉）**：新浪现在对 **标普500(513500)/纳斯达克100(513100)/黄金(518880)** 只回约 900 根日 K（≈2023-04 / 2020-05 起），但 `data.js` 这三只均有 `2015-09` 起完整 132 月历史（当年取数通道更深）。影响：**每月增量 append（`monthly_update.js`）安全**；但**整文件从新浪重抓会丢 2015–2023/2020 历史**。对策：`js/data.js` + `js/real_returns.json` 已被 git 管理即权威备份；取数脚本**只增量 append，绝不整文件按新浪重生成**。建议后续给 `fetch_returns.py` 加"某资产历史条数突降即中止 `--write`"护栏（尚未实现）。

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
- **新增 `scripts/monthly_progress.js`（进行中月份进度快照）**：取"当前未完成月"的**月至今(MTD)**收益（新浪前复权日 K 线，与 `fetch_returns.py` 同源），把最新完整月的组合持仓往前推一步，输出带 **🟡 进行中（非完整月）** 标记的报告。**绝不写 `data.js`/`real_returns.json`**，不污染主回测。用法 `node scripts/monthly_progress.js [--out 报告.md] [--json js/progress.json] [--no-json] [--no-fetch] [--push]`（`--push` = 内容有变化才 commit + push 该 JSON，用于自动化；展示位置见「完整持仓日志内的『进行中月份』行 + progress.json」专节）。
- **`scripts/smoke_check.js` 新增第 5 项守卫**：加载 `js/rolling.js` 跑 `runAll()`，断言每个起点末位快照月份 == `months` 末位标签，防止日志 off-by-one 回归。
- 删除调试用临时脚本 `scripts/_log_check.js`（不入库）。
- **未改 `data.js` / `engine.js`**：本次无新月份数据（2026-09 尚未走完，9/28 实时 MTD 沪深300 −5.72%，待 10 月初再定稿）。
- 版本号 bump（绕 CDN 缓存）：`index.html` 中 `rolling.js` v12 → **v13**、`main.js` v41 → **v42**。

**口径结果（不变）**：主引擎 `simulateCMV` 官方口径未动，稳健型仍年化 7.63% / 终值 112.2 万。滚动日志为独立引擎，其末月延伸 + 回归当月真实收益后，与官方口径的"方向/量级"一致（如 2026-08 组合月收益 +1.99% 对应当月沪深300 +0.69%、黄金 +8.29% 加权）。

---

### 完整持仓日志：三个「分段收益」列统一为竖向三行格式（2026-09-29）

**动机**：16 列日志表横排在窄列里只显示一个百分比，读者无法同时看到"时间段 + 比例 + 金额"，且比例需要回看第一列才能确定属于哪个月/哪一年。

**统一后的列格式**（`main.js` 的 `showLogDetail`，均带 `rowspan=6` 合并 6 个资产行）：

| 列 | 第一行 | 第二行 | 第三行 |
|---|---|---|---|
| 月收益 | `2019年12月`（月份） | `+2.04%` 月收益率 | `¥+14,026` 当月收益金额 |
| 累计收益 | `第 133 个月`（累计月序） | `+121.16%` 累计收益率 | `¥+605,811` 累计收益金额 |
| 年度收益率 | `2019年`（日历年） | `+22.35%` 年度收益率 | `¥+111,767` 年度收益金额 |

首行统一为**小字淡色**（`0.7rem` / `opacity 0.7`），次行是主数字（带涨红跌绿 class），末行为小字金额。三列首行分别用「月份 / 累计月序 / 年份」三种不同维度做标识，互不重复。

**关键口径（易错点，改动前必读）**

1. **累计月序 = 自入场月起算的自然月序号，入场月即第 1 个月**（2026-09-29 用户拍板修正，此前是"入场月=第 0 个月"）：
   - 入场月（`monthlySnapshots[0]`，即 `months[0]`，无收益）→ **第 1 个月**，单元格显示 `第 1 个月 · 入场`。
   - 数据末月 `2026-08` → **第 133 个月**（= `monthlySnapshots.length`）；进行中月 `2026-09` → **第 134 个月**（= 条数 + 1）。
   - 实现：`monthNoMap` 按 `result.monthlySnapshots` **正序**编号（`(s,i) => monthNoMap[s.month] = i + 1`），因此即便表格倒序展示（`sessionStorage.log_sort_desc`）编号也不会错。
   - **前端 `main.js` 与 CSV `rolling.js` 必须同源 1-based**，改一处必改另一处（+ `smoke_check` 无守卫，靠人工核对）。
2. **三个比例的分母口径不同，不要混用**：
   - 月收益比例 = 当月组合收益率（引擎给的真实月收益，分母=上月末总市值）。
   - 累计收益比例 = `总市值 / 初始本金 50万 − 1`。
   - 年度收益比例 = **年收益金额 ÷ 固定基准本金 50万**（因此各年比例可加，逐年累加恰好等于累计收益；而非"÷上一年末总市值"的复合口径）。
   - 三个**金额**列彼此满足父子关系：年内「月金额之和」= 「年度金额」；「年度金额之和」= 「累计金额」。
3. `monthNoMap` / `monthPrevMap` / `yearStartMap` 三张映射表**必须在正序数组上构建**，再用于渲染（渲染用的是可能被 `reverse()` 过的副本）。

**CSV 同步**（`rolling.js` 的 `exportLogCSV`）：新增「累计月份 / 累计收益率(%) / 累计收益金额(元)」三列，表头由 18 列 → **21 列**；月份列直接写数字（`1`、`133`，与前端「第 N 个月」同源 1-based）。列顺序：`… 月收益率, 月收益金额(元), 年度收益率(%), 年收益金额(元), 累计月份, 累计收益率(%), 累计收益金额(元), 数据状态`。

**自检方式**（改这几列后建议照跑）：
- 列数一致性：`exportLogCSV` 全部行的逗号分隔列数 == 表头列数（应 0 处不符）。
- NaN 扫描：全 12 起点 CSV 中 `NaN` 计数应为 0。
- 月序边界：末月月序 == `monthlySnapshots.length`（当前 133）；入场月序 == 1。
- 父子自洽：年内月金额之和 == 年金额；各年金额之和 == 累计金额。
- 版本号 bump（本次 `rolling.js` v16 → **v17**、`main.js` v49 → **v50**）。

---

### 完整持仓日志内的「进行中月份」行 + progress.json（2026-09-29 · 用户两次拍板）

**需求演进**：用户先要求"能看到（估算的）当月最新进度，做好标识即可"→ 已做成首页独立区块；
随后用户否掉该形态（"独立的区块不是我要的格式"），要求**把进行中月份直接作为『完整持仓日志』表格里的一行**。

**数据链路（三件套，职责严格分离）**：

| 环节 | 文件 | 说明 |
|---|---|---|
| 取数 + 估算 | `scripts/monthly_progress.js` | 新浪前复权日 K 线取"当月至今 MTD"，输出快照；`--push` 时自动 commit + push |
| 数据源 | `js/progress.json` | 站点**唯一**的进行中数据来源；**只读快照，绝不进 `data.js`** |
| 渲染 | `js/main.js` 的 `ensureLiveProgress()` + `buildLiveRows()` | 页面初始化时 `fetch('js/progress.json?t=<10分钟桶>')` 缓存；打开日志时**追加为末行**（正序）/ 首行（倒序）；失败 / 非进行中 / 基准月不匹配 → 不追加（静默降级） |

**行内容（与表头 16 列一一对齐）**

- 月份列：`2026-09` + `🟡 进行中`；阶段列：`进行中估算 / 月至今 MTD`；整行加 `.live-month-row` 淡黄底 + 橙色虚线上下边框。
- **各资产估算现值 = 该次回测末月持仓 × (1 + 该资产 MTD%)** —— `progress.json` 只提供 MTD%，持仓取回测自身，所以 12 个起点**各自自洽**（不是照抄组合级 `est_total`）。
- 操作/金额列一律 `—`（恒市值法只在月末调仓，进行中不产生买卖）。
- 月收益列：`2026年9月 MTD` / **`-2.07%`（= 本月收益金额 ÷ 固定基准 50 万）** / `¥-10,371 · ÷50万` / 伏笔小字 `参考 ÷上月末 -0.94%`。
- 累计收益列：`第 134 个月` / 累计比例 / 累计金额；年度收益率列：`2026年 至今` / 年度比例（÷50万）/ 年度金额。
- 表格下方图例补一句：`🟡 进行中行 = 本月尚未结束的 MTD 估算（不参与官方指标）` + `收益比例口径：÷固定基准本金 ¥50 万`。

**关键约定（改动前必读）**

1. **绝不污染主回测**：`progress.json` 只服务这一行，`data.js` / `engine.js` / `rolling.js` 完全不认识它。
   官方指标（年化 / 回撤 / 胜率 / 三档卡片 / 滚动汇总表）永远只到**最新完整月**。
2. **百分比口径统一 ÷固定基准 50 万**：与日志表「月收益 / 年度收益率 / 累计收益」三列一致。
   `progress.json` 同时给出 `est_change_pct_base`（÷50万，页面显示此值）与 `est_change_pct_prev`（÷上月末总市值，仅参考），别把后者当主指标。
   ⚠️ 这里是**用户纠错过的点**：`-1.04万 ÷ 50万 = -2.07%`，不是 `÷上月末 110.58万 = -0.94%`。
3. **内容不变不重写**：脚本对比时把 `generated_at` 置为占位符再比较，因此"行情没动"时不会产生无意义 diff / 部署；`generated_at` 语义 = **快照数据最后一次变化的时间**。
4. **缓存**：`worker.js` 有 `/js/progress.json` 分支，`Cache-Control: public, max-age=60`（其它 CSS/JS 仍是 300s）。
   前端再叠加 10 分钟粒度的 `?t=` 查询参数（**这是唯一一个不靠版本号 bump 的动态 JSON**，因为文件内容由脚本重写而非人工改）。
5. **涨跌配色**沿用 A 股习惯（涨红跌绿），全部走 CSS 变量，三种皮肤（business / modern / tech）自动适配。
6. **`smoke_check.js` 第 7 项守卫**（2026-09-29 扩展）：`progress.json` 必须 `in_progress:true`、`base_capital==500000`、资产行数 = 风险资产数 + 现金 1 行；新增三条防回归断言：
   - 其月份**不得**出现在 `months` 里（一旦出现说明该月已定稿，快照该重跑或删除）；
   - **资产名与 `main.js` 的 `ASSETS` 逐字一致**（前端按名匹配 MTD，不一致会静默按 0% 处理）；
   - **`base_month` == 主数据末月**（前端只在相等时追加行，漂移会导致该行整体消失）；
   - **`est_change_pct_base` == `est_change_amount ÷ base_capital`**（口径红线，防止退回"÷上月末总市值"）。
7. **已删除的旧形态**：首页 `#live-progress` 独立区块 / `index.html` 里的 `.live-*` 样式 / `main.js` 的 `initLiveProgress()`、`renderLiveProgress()` 均已移除，不要按旧文档再找它们。
   替代提示：滚动汇总表每个「📋 查看操作记录」按钮在有进行中数据时带 🟡 角标（`markLiveBadges()`）。
8. **CSV 导出暂不含进行中行**（用户未要求）：`exportLogCSV` 仍只导出正式月份。

**自动化（每交易日跑，不进主数据）**：`node scripts/monthly_progress.js --push`
→ 更新 `js/progress.json` → 有变化才 commit + push → CF 自动部署 → 首屏与滚动板块的「本月至今」表面同步刷新。
> 调度方式自 2026-09-29 起改为**本机 Windows 计划任务（纯脚本、零 AI 依赖）**，见 §七「数据自动更新」与 `crontab/README.md`。

---

### 全站默认「本月至今（MTD）」+ hover 显示已定稿对照（2026-09-29 · 用户三轮拍板）

**需求原文（三轮，口语顺序）**
1. 「既然完整持仓里可以有最新的预估的累计收益，那就以最新数据算出的累计收益等都可以展示出来了；hover 时提示数据是包含不完整的当前余额数据，截止到上月的固化数据是多少」
2. 「完整持仓日志弹窗里……顶部的总收益等、以及滚动回测汇总下都没看到最新的预估数据，反而是首屏右侧的小卡看到了含当月结的数据以及 hover 看到提示」（→ 第二轮：滚动引擎同源叠加）
3. 「我希望外部展示出来，而不是切到详细才看到最新数据。哪怕预估的……其实也不存在什么预估，毕竟数据每天都出来呀」（→ 第三轮：外部可见 + 否掉「预估」措辞）

**术语约定（第三轮定稿，务必遵守）**
- 该口径统一叫 **「本月至今（MTD）」**，不叫「估算 / 预估」——它是**每日真实行情累积出的已发生数据，不是预测**。
- 它不进官方指标的唯一原因是：**该月月末尚未收口，且恒市值法只在月末调仓**，所以这个月的收口值还不能确定。
- 对照值统一叫 **「已定稿（YYYY-MM）」**（此前文档里叫「固化」，指 `monthly_update.js` 月度定稿后的正式数据）。
- ⚠️ **不要**把 `RollingBacktest` 的 `hasEstimatedData`（历史数据缺失时的插值兜底，UI 文案「含估计值」）一并改掉 —— 那是另一个概念，与本月无关。

**三个决策（用户从推荐项逐轮拍板）**
1. **口径统一**：`engine.js#simulateCMV` 的月份映射改为与 `rolling.js` **完全一致**（消除此前两套引擎两套数字）。
2. **展示范围**：Hero 4 卡 + 三档方案卡片 + 交互回测指标卡，默认全部显示「本月至今」，悬停弹出已定稿对照。

#### A. 引擎口径统一（这是本次最关键的修复）

| 引擎 | 修复前 | 修复后 |
|---|---|---|
| `rolling.js#RollingBacktest`（日志） | `returns[i]` = `months[i+1]`，入场月无收益 ✅ | 不变（基准口径） |
| `engine.js#simulateCMV`（首屏/三档/交互） | 按 `arr[t]` 取值 → **把 2015-09 收益套在空仓的入场月上**，组合只吃到 131 个月收益却报 132 个月 | `t=0` 为入场月（收益 0），`t>=1` 取 `arr[t-1]`，循环 `arrLen+1` 次 |

- 后果对比：修复前 Hero 稳健型 **112.22 万 / 年化 7.63%**，滚动日志 **110.58 万 / 年化 7.42%** —— 高约 1.46pp。
  修复后两引擎 `finalValue/annual/maxDd/sharpe/winRate` **逐位相等（0 差）**。
- `nYears = ticks / 12`（年数含入场月）；胜率分母 = 实际迭代月数。
- `generateMonthlyReturns` 的月份标签改为 `rr.months.slice(0, min(月收益条数, months 长度))`，保证曲线点数与月度收益一一对应。

#### B. live overlay（本月至今的叠加层）

| 环节 | 做法 |
|---|---|
| 入口 | `BacktestEngine.setLiveOverlay({month, asOf, returns})` —— 校验月份格式、必须**晚于**数据末月、且**不在** `months` 里（已定稿月会被拒绝） |
| 生效 | `simulateCMV(alloc, opts)` 里作为**最后一个额外汇总月**处理：`ticks = arrLen + 1 + 1`；该月用 `overlay.returns[asset]`，**跳过再平衡**（恒市值法只在月末调仓）；返回体新增 `liveOverlay / overlayMonth / frozenMonths` |
| 关闸 | `simulateCMV(alloc, {liveOverlay:false})` 强制已定稿口径；`clearLiveOverlay()` 全局复位 |
| 精度 | `progress.json` 新增 **`mtd_raw`（8 位小数）**；引擎只用 `mtd_raw`，用 2 位 `mtd` 会产生 **±3 元漂移**（已实测：1095440.28 vs 1095437.21，改后差 0.0046 元） |
| 三处一致 | 叠加结果的终值必须 = `progress.json#est_total` = 日志末行「🟡 进行中」的累计金额（smoke_check 第 9 项守卫生效） |

**B2. 滚动引擎同源叠加（2026-09-29 第二轮 · 用户追问「弹窗顶部与滚动汇总下都没看到最新数据」）**

背景：第一轮只把 overlay 接进了 `engine.js`。结果同一个弹窗里数字打架 —— 日志表格有「🟡 进行中」行，
但顶部汇总、下方的滚动汇总表、折线图、CSV 全部还停在已定稿口径（首屏 Hero 却已含本月至今）。

| 环节 | 做法 |
|---|---|
| 入口 | `RollingBacktest.setLiveOverlay({month, asOf, mtd})` —— 校验规则与 engine 完全一致（晚于数据末月 + 未定稿 + 数值合法） |
| 输出 | **绝不 append 到 `monthlySnapshots`**！叠加结果单独挂在 `result.live = {month, asOf, baseMonth, snapshot, ...computeMetrics(...)}`，`result.frozenMonths` 记录已定稿月数 |
| 为什么 | `monthlySnapshots` 保持已定稿 → **日志表格正文 / CSV 导出 / 既有图表零回归**（已用脚本比对 12 个起点 × 14 个指标，逐位不变） |
| 共用 | 指标计算抽成 `computeMetrics(snaps, totalCapital)`，已定稿与叠加共用同一函数 —— 从根上杜绝「两套数字」再分叉 |
| 叠加月 | `opCount = 0`、各资产 `action` 全为「无操作」（恒市值法只在月末调仓）；`monthIndex = frozenMonths + 1`（累加月序，入场月 = 第 1 个月） |
| 严格闸门 | `setLiveOverlay` 与前端 `applyLiveOverlay` 都**显式拒绝 `null`/`undefined`/`''`/布尔/数组/非有限数**。⚠️ 必须显式拦 —— `Number(null) === 0`，「没有数据」会被静默当成「当月持平」发布到全站 |
| 消费点 | ① 弹窗顶部汇总卡（5 项含本月至今 + 悬停对照）② 滚动汇总表 12 行（数值含本月至今 + `data-tip-key` + 「含本月至今」小标 + 周期终点顺延到进行中月）③ 折线图（每条线末点 = 本月点；最早起点用 pin、其余用空心圆标记）④ 弹窗内新增 `live-note-line` 说明行 ⑤ `#rolling-live-note` |
| 仍然已定稿 | 日志表格**正文各行**（只额外多一行「🟡 进行中」，该行**直接渲染 `result.live.snapshot`**，不再本地复算 MTD）、CSV 导出、分享图 |

**B3. 滚动板块「外部可见」+ 措辞统一（2026-09-29 第三轮 · 本轮）**

背景：第二轮做完了口径统一，但「本月各资产涨跌多少」这份明细**仍然只锁在弹窗里**（要点「查看操作记录」），
且全站把它叫「估算 / 含当月估」。用户否掉了这两点。

| 环节 | 做法 |
|---|---|
| 明细块（新增） | `index.html#live-progress-card` + `main.js#renderLiveProgressBlock(results)`：页面外部直接可见，逐资产给出**目标权重 / 月初市值 / 本月至今 / 最新市值 / 当前权重 / 偏离目标**，表尾两行合计（组合本月至今金额+比例、自入场累计、第 N 个月、本月无交易） |
| 数据源 | **直接吃 `results[0].live.snapshot.assetDetails`**（完整历史 · 一次建仓，与首屏 Hero 同源），不在前端另算 —— 避免出现第三条计算路径 |
| 合计口径 | 月初市值 = 各资产 `holdingBefore` 之和；本月至今比例 = `(最新市值 − 月初市值) ÷ 固定基准 50 万`（**铁律：不用上月末总市值当分母**），因此与 `progress.json#est_change_pct_base` 逐位一致（smoke 第 9 项锁定） |
| 汇总表末行（新增） | `renderRollingSummary` 末尾追加 `<tr class="live-month-row">`：起点列「🟡 进行中月份 + 月份 + 截至日」、周期列「自数据最早月 → 进行中月」、12 列结构与既有行完全相同；`data-tip-key="roll-live"` 悬停对照已定稿；详情按钮打开该条完整日志弹窗 |
| 配色 | `LIVE_ASSET_COLORS`（模块级常量，与弹窗日志表格一致）；`smoke_check` 守卫「每种资产都有配色」，防止改资产名后静默丢色 |
| 显隐 | 整块由 `body.has-live-estimate` 控制（`display:none → block`）；无 live 数据时 `renderLiveProgressBlock` 清空内容且**不渲染**汇总表末行 → 降级 / 未取到数时零残留 |
| 措辞 | 「含当月估」→「含本月至今」；提示层键名「含估 / 固化」→「本月至今 / 已定稿」；说明行改写为「由每日真实行情累积得出，不是预测值」 |

> 弹窗内「进行中」行的旧实现自己在 `main.js#buildLiveRows` 里复算 MTD（用的是 2 位小数的 `progress.mtd`），
> 与引擎的 `mtd_raw` 差几元 → 同一弹窗里顶部 ¥109.54万 vs 行内 ¥1095440。**已改为直接消费引擎快照**，现在逐位一致。

**两个 body class 必须分清（易踩坑）**
- `has-live-progress`：日志表「🟡」角标，来自 `ensureLiveProgress()` + `markLiveBadges()`。
- `has-live-estimate`：全站「含本月至今」小标 + 虚线 + 底部说明行 + **明细块显隐**，只在**引擎成功 applyLiveOverlay** 时由 `updateHeroStats()` 末尾切换。
  两者解耦：progress.json 存在但叠加失败时，只出角标不出「含本月至今」标记、也不显示明细块。

#### C. 悬浮说明层（单例）

- 单例 `position:fixed` 浮层 + `data-tip-key` 锚点；`TIPS` 表 + `tipLive(key, lines)` 动态写入。
- **视口边界收敛**：锚点在视口上 35% 内则浮层放下方，否则放上方（避免被 Hero 顶部裁掉）。
- 内容统一为「本月至今 vs 已定稿」对照，例如：
  `本月至今 · 终值 109.5 万 / 年化 7.28%` + `已定稿（2026-08）· 110.6 万 / 年化 7.42%`。
  浮层标题与脚注已改为「本月至今 = 真实已发生的每日行情累积…不是预测」。
- 三档卡片字段名注意：卡片对象用 **`dd`** 而非 `maxDd`（曾因此 `toFixed` 崩溃，见"已修 bug"）。
- 说明行：`#hero-live-note` / `#compare-live-note` / `#backtest-live-note` / `#rolling-live-note` / `#live-progress-note`，
  全部由 `renderLiveNotes()` 写入（**新增展示块时记得在这里补文案**）。

#### D. 仍用已定稿口径的地方（有意为之）
- **分享图**：`share-image.js#getDefaultResult()` 显式传 `{liveOverlay:false}` —— 海报不放未完成月的数据。
- **完整持仓日志表格的正文行**：`result.monthlySnapshots` 恒为已定稿序列（叠加月只进 `result.live`），
  故仅在末尾**额外加一行**「🟡 进行中」；官方回测指标以已定稿口径为准。
- **CSV 导出（日志 CSV / 汇总 CSV）**：仍只导正式月份 —— 屏幕上看得到本月至今，但导出物保持"官方口径"。

#### E. 回归守卫（`scripts/smoke_check.js` 已加，共 72 项断言）
- 第 5 项：`simulateCMV` 窗口 = 入场月 + 真实收益月（`totalMonths === assetLen + 1`）。
- 第 8 项：**两引擎口径逐项一致**（一次建仓版 & 分批建仓版）。
- 第 9 项：**live overlay 与 progress.json 逐位一致**（终值=est_total、月数 +1、累计%=`cum_return_pct_base`、不污染已定稿、非法叠加被拒、clear 后复位）。
  第二轮追加：**滚动引擎** `live overlay 被接受` / `一次建仓版终值=est_total` / `monthlySnapshots 未被污染` /
  `进行中月 opCount=0` / `累计月序=冻结月数+1` / **两引擎叠加口径逐项一致（一次建仓版 & 分批建仓版）** /
  `clearLiveOverlay 后 live=null`。
  第三轮追加（明细块数据源链）：**各资产最新市值之和 = 组合合计 = `progress.est_total`** /
  **各资产月初市值之和 = `progress.base_total`** / **合计比例 = `progress.est_change_pct_base`（÷固定基准 50 万）** /
  **资产条数 = 6** / **每种资产都有配色（`LIVE_ASSET_COLORS` 无遗漏）**。
- 第 11 项（空值闸门，第二轮加）：**`null` / 空表绝不能被当成 0** —— 两个引擎都必须**拒绝**含 `null` 的收益表与空表。
  （`Number(null) === 0`，不拦就会把「没有数据」变成「当月持平」。）
- 第 10 项：降级闸门 —— `progress.json` 正常时必须含 `mtd_raw`；**若标记 `degraded: true`，则所有本月至今字段（`est_total` / `est_change_*` / `cum_return_pct_base` / `mtd` / `mtd_raw` / `est_value`）必须为 `null`**、各资产 `ok` 必须为 `false`、身份仍自洽（基准月 = 主数据末月、进行中月未定稿）。
  ⚠️ 字段名沿用 `est_*` 历史命名，语义即「本月至今」；改名会影响 `monthly_progress.js` 与前端两处，故保持不动。
- 第 12 项（第三轮加，**展示层骨架 + 措辞守卫**）：明细块 5 个 ID 必须存在、显隐 CSS 必须成对、
  汇总表末行样式必须存在、`renderLiveProgressBlock` 必须挂在 `renderRollingAll` 上；
  **旧措辞不得回潮**（扫 `index.html` / `js/*.js` / `progress.json` / `monthly_progress.js`，不得出现
  「含当月估」「含当月估算」「MTD 估算」「当月估算」）；且「含估计值」语义未被误改。
> 一次全绿验证：`node scripts/smoke_check.js`（退出码 0）。

#### F. 已修 bug（防回归）
1. `setCompareCard` 用 `data.maxDd` → `undefined.toFixed` 崩溃；正确字段是 `data.dd`、对照值 `data.frozen.maxDd`。
2. `main.js` themeMap.business 仍旧 `v=18`（index.html 已 v=19）→ 切回商务风命中旧缓存；已同步。
3. 悬浮层被日志弹窗遮挡 / 视口顶部裁切 → 改 `scrollIntoView` + `mouse.move`，并加 35% 边界收敛。
4. **`monthly_update.js` 定稿会被自己的旧快照卡死** → 新增**阶段 9.5**：自检前自动跑 `node scripts/monthly_progress.js`（不带 `--push`）。
   旧快照在 TARGET 写进 `data.js` 后立刻过期（月份落进 `months`、`base_month` 落后一月）→ `smoke_check` 第 7 项 FAIL → 阶段 10 不 commit / 不 push。
   容错：取数全失败（退出码 2，降级 MTD=0）只告警不中断；其它非零码才中止。
5. **`monthly_update.js` 两条文案口径混用** → 新增 `V.nCum = 收益条数 + 1`：
   - 数据范围文案用 `V.n`（收益条数，当前 132）；
   - **累计月序文案用 `V.nCum`**（当前 133）：Hero「90 / 133月」、指标卡「总收益（133个月）」，与 `main.js` 的 `m.totalMonths` 同源。
   - Hero 副标题「翻倍/增长/亏损」由 `main.js` 按 `终值÷50万 ≥ 2` 判定，静态回退需同步为 **「11年翻倍」**。
   - 发布前用 `node scripts/monthly_update.js --dry-run --strict` 确认「全部规则命中」。
6. **叠加入口把 `null` 当成 0**（第二轮自查）→ 两个引擎的 `setLiveOverlay` 与 `main.js#applyLiveOverlay` 都加显式空值闸门。
7. **弹窗「进行中」行与顶部汇总差几元**（同轮自查）→ 旧 `buildLiveRows` 用 2 位小数 `progress.mtd` 自行复算；
   改为直接渲染 `result.live.snapshot`（引擎 `mtd_raw` 全精度），并顺带用 `snap.monthIndex` 取累计月序。
8. **版本表漏了 `engine.js` 自动回填规则** → `monthly_update.js` 的 `CODEBUDDY 版本表` 规则补上 engine.js 一行
   （此前只回填 data.js / rolling.js / main.js，engine.js 长期靠手改，必然漂移）。
9. **本地静态服务用 `&` 起会留脱管野进程**（`python -m http.server`）：任务立刻报 failed，但子进程存活继续占端口；
   换端口重试会累积出多个僵尸服务。**必须用后台任务参数启动**，验证完 `TaskStop` 并核对端口释放。

#### G. 降级闸门（degraded gate，2026-09-29 加 —— 数据完整性关键）
**背景**：`progress.json` 的 MTD 经 live overlay 驱动全站「本月至今」口径（Hero / 三档卡 / 指标卡 / 滚动汇总表末行 / 本月至今明细块）。
若取数失败时用 `0` 填补，等于对外发布「**当月持平**」这个假数字 —— 直接违反铁律「不凭空造月收益」。
改动前该脚本会「先写占位、再 push、最后才 `exit 2`」，即**假数据一定会先上线**。

**核心原则：`null` = 本次无数据（可发布）；`0` = 伪造的持平（绝不可发布）。**

| 环节 | 行为 |
|---|---|
| 降级判定 | `scripts/monthly_progress.js`：**任一**风险资产取数失败（或 `--no-fetch`）→ `degraded = true`（不再是「全部失败才降级」） |
| 字段 | 降级时 `est_total` / `est_change_amount` / `est_change_pct_base` / `est_change_pct_prev` / `cum_return_pct_base` / 各资产 `mtd` / `mtd_raw` / `est_value` 全为 `null`，各资产 `ok = false`；`base_total`（基准月持仓，与本月行情无关）仍保留真实值 |
| 写盘 | 新增 `existingIdentityValid()`：降级且现有快照身份仍有效（进行中月未定稿 + 基准月 = 主数据末月）→ **完全不写、不推送**，保留上一版真实快照；身份已失效 → 写 null 占位把身份推进（不卡定稿） |
| 推送 | `if (PUSH && !keepExisting)` —— 只推「含真实 MTD」或「明确标记 degraded、估算全为 null」的占位；**绝不推 0 填补的估算** |
| 前端 | `js/main.js#ensureLiveProgress`：`d.degraded` → 直接 return（不设 `liveProgressData`、不 `markLiveBadges`、不 `applyLiveOverlay`）；`applyLiveOverlay` 内再加一道 `if (d.degraded) return null` 双保险 → 站点回退到已定稿口径 |
| 守卫 | `smoke_check.js` 第 10 项新增 degraded 分支（不含任何估算数值 + 身份自洽 + 可追溯原因 + `ok` 全 false） |
| 退出码 | `2` = 降级（本次未发布任何本月至今数据，需重跑）；`--no-fetch` 属离线自检，仍为 `0` |

**为什么前端看标志而不是看数值**：已验证「`degraded: true` 但数值被填成 0」（模拟修复前的伪数据）时前端**仍不展示估算** —— 闸门挂在标志上，即使将来有人写错数值也不会漏出去。

验证脚本（不进仓库）：`C:\Users\23405\.workbuddy\binaries\node\workspace\_check_degraded.js`（jsdom 四场景：正常 / 降级全 null / 降级含伪 0 / 老快照无 degraded 字段）。

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
