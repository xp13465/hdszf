# 恒市值助手 · 定时任务（Windows 计划任务 / Linux cron / 手动）

> **一句话**：数据更新与月度定稿固化**完全不依赖 AI / WorkBuddy**——由 Windows 计划任务
> 或 Linux cron 唤醒 `crontab/run_job.js`，运行器再去调 `scripts/` 下既有的两个脚本。
> 全程只需要 **Node + git + Python**（月度定稿取数用），零额度、零对话、零人工。
>
> - **Ubuntu / Linux 云服务器** → **第 10 节**（`bash crontab/install.sh`）。
>   推荐把自动化放在 24 小时在线的服务器上，本机只作替补手动跑。
> - **Windows 本机** → 第 2 节（双击 `install.cmd`）。
> - **不想装计划任务** → 第 3 节「方式 B：手动跑」——两条命令，按频率自己跑就行。
> - **装之前先体检环境** → 第 11 节（`check_env.sh` / `check_env.cmd`，缺依赖可 `--fix` 自动装）。
>
> `run_job.js` / `status.js` / `check_env.js` 是**跨平台**的：Linux 上只是换一个调度器，脚本本身不用改。

---

## 1. 两个任务（先搞清要跑什么）

| 任务 | 实际行为 | 推荐频率 | 最早可跑时间 | 漏跑的后果 |
|---|---|---|---|---|
| **`mtd`**<br>本月至今快照 | 跑 `scripts/monthly_progress.js --push`：取当日收盘 → 更新 `js/progress.json` → 有变化才 commit + push（触发 Cloudflare 部署） | 每交易日 1 次 | 当天 **18:00** 之后 | 站上「本月至今」停在旧日期；不影响官方指标 |
| **`finalize`**<br>月度定稿固化 | 跑 `scripts/monthly_update.js --strict`：取上月数据 → 重算派生 → 版本号 bump → 静态文案 → 文档 → 差异报告 → 刷新快照 → 自检 → commit + push | 每月 1 次 | **次月 3 日**之后 | 主回测数据停在旧月份（最严重的漏跑） |

### 时间点为什么这么定（不要随意提前）

- **`mtd` 必须 18:00 之后**：A 股 15:00 收盘，新浪日 K 傍晚才更新。
  早跑取到的是**上一交易日收盘**——实测 07:16 手动跑，报告里「数据截至」仍是前一天。
  周一早上跑，拿到的是上周五的收盘。
- **`finalize` 必须次月 3 日之后**：给「上月末最后一个交易日」的行情留出发布余量。
  至于「月到底走完了没」不靠日期猜，由 `monthly_update.js` 自己判断（未走完 → 什么都不做，`exit 0`），所以**宁晚勿早**。
- **休市日**（周末/节假日）跑了也没用：数据没变 → 脚本不产生 commit、不产生部署。

---

## 2. 方式 A：注册计划任务（一次性，之后全自动）

### 步骤 0：先体检环境（2026-09-30 新增，别跳过）

```
crontab\check_env.cmd          ← Windows：只体检，不改任何东西
crontab\check_env.cmd --fix    ← 缺 git / python 时用 winget 装
```

`install.cmd` 内部**会自动先跑这一遍**，有阻塞项就中止（免得「任务装上了却长期空跑」）。
体检项、输出含义、`--fix` 能装什么，见 **第 11 节**。

### 步骤 1：注册

在**你自己的终端**里执行（本机 `schtasks` 被安全策略限制，AI 无法代跑）：

```
cd /d C:\Users\23405\WorkBuddy\2026-08-20-17-46-50\hdszf\crontab
install.cmd
```

也可以直接**双击** `install.cmd`。它先体检、再注册这两条：

```bat
schtasks /create /tn "hdszf-mtd"      /tr "\"<node.exe>\" \"<仓库>\crontab\run_job.js\" mtd"      /sc HOURLY /mo 1 /st 18:00 /et 23:59 /f
schtasks /create /tn "hdszf-finalize" /tr "\"<node.exe>\" \"<仓库>\crontab\run_job.js\" finalize" /sc HOURLY /mo 1 /st 09:00 /et 23:59 /f
```

- **不需要管理员权限**（任务以当前用户身份、仅在登录时运行），**不需要填密码**。
- 为什么是「每小时唤醒」而不是「每天定点」：`schtasks` 不支持「错过就补跑」，定点任务一旦撞上睡眠/关机就永久错过。改成小时窗口 + 运行器自带闸门（成功一次即停），既不会重复提交，又能自动补跑。
- 若注册失败，`install.cmd` 末尾会打印三种常见原因与处置。

### 步骤 2：手工试跑一次

先跑**零副作用**的那条（真实联网取数、打印完整报告，但**不写文件、不推送**）：

```
node crontab\run_job.js mtd --no-status -- --no-json
```

看到 `取数状态：5/5 个风险资产实时成功` 与 `exit=0 → 成功` 就说明链路通了。

### 步骤 3：看健康报告

```
crontab\status.cmd
```

或 `node crontab\status.js --online`。

---

## 3. 方式 B：手动跑（**不安装计划任务 / cron**）

不注册调度器，就自己按频率敲命令。**两条命令，两个频率**：

```bash
# Windows
cd /d C:\Users\23405\WorkBuddy\2026-08-20-17-46-50\hdszf
node crontab\run_job.js mtd --force          ← 每交易日 18:00 后，1 次
node crontab\run_job.js finalize --force     ← 每月 1 次（次月 3 日后）

# Linux / Ubuntu（云服务器）
cd /home/ubuntu/code/hdszf
node crontab/run_job.js mtd --force
node crontab/run_job.js finalize --force
```

> 命令都从**仓库根目录**执行；`crontab/` 是相对路径，跟着仓库走，换机器不用改。
> （下面表格里为省事写的是 Windows 的 `\`，Linux 上把反斜杠换成 `/` 即可。）
> 想省事可以把这两条各写成一个 `.cmd` / `.sh` 双击跑，或在 shell 里用 `;` / `&&` 串起来。

### 3.1 `--force` 是什么（手动模式的关键）

`--force` = **手动补跑模式**：忽略**全部软闸门**（时间窗口 / 今天已成功 / 次数上限），并逐条打印它忽略了什么：

```
⚠ --force 手动补跑：已忽略以下软闸门（自动化的默认保护本次不生效）
    ⚠ 未到时间窗口（18:00 之后才跑；当前 07:16，新浪日 K 尚未更新，取到的可能是上一交易日收盘）
```

所以**任何时间点**都能手动跑。不带 `--force` 时，运行器仍按自动化的时机约束判断——
18:00 前跑 `mtd` 会「按设计跳过」、当天已成功过也会跳过。
**同一条命令，加 `--force` 就是人在补跑**，这也是自动化和手动共用一个入口的原因。

看结果：终端打印全部输出，同时写日志到 `<工作区>\_hdszf_logs\`（按任务、按月分文件）。

### 3.2 也可以：直接跑底层脚本（完全绕开运行器）

```
node scripts\monthly_progress.js --push      ← 取数 → 写 js/progress.json → 有变化才 commit + push
node scripts\monthly_update.js --strict      ← 取数 → 重算 → 文案 → 文档 → 自检 → commit + push
```

两个脚本都能**独立跑完全流程**，不依赖运行器。但运行器替你做的这些就没了：

| 运行器提供 | 直跑底层脚本时 |
|---|---|
| 日志留档（按月分文件） | 只有终端输出 |
| 「今天已成功就跳过」闸门 | 无（重复跑基本无害：内容没变不会产生 commit） |
| 自愈推送（本地领先远程时先补推） | 无 |
| 失败自动回滚（`git checkout -- .`） | 无 —— 半成品要自己清理 |
| 定稿前要求工作区干净 | **无，见下面的警告** |

> ⚠️ **直跑 `monthly_update.js` 之前，必须先让工作区干净**（`git status` 输出为空）。
> 它内部是 `git add -A` + commit —— 你的未提交改动会被**一起裹进「数据更新」提交并 push 上线**。
> 先 `git commit` 或 `git stash` 掉自己的改动再跑。
>
> `monthly_progress.js` 没这个问题：它只 `git add -- js/progress.json`，碰不到别的东西。
>
> 走运行器（`run_job.js finalize`）同样没这个问题：工作区脏时它会**直接跳过定稿**并提示你先 commit/stash。

### 3.3 各场景该跑哪条（速查）

| 我想… | 命令 |
|---|---|
| 只想看今天的行情，不改任何东西 | `node crontab\run_job.js mtd --no-status -- --no-json` |
| 把今天最新 MTD 推上线 | `node crontab\run_job.js mtd --force` |
| 补跑漏掉的月度定稿 | `node crontab\run_job.js finalize --force` |
| 看看取数到底哪个资产失败 | `node crontab\run_job.js mtd --force -- --no-json` |
| 只出报告，不写盘不推送 | `node scripts\monthly_progress.js --no-json` |
| 定稿前先空跑一遍，看会改哪些文件 | `node scripts\monthly_update.js --dry-run --strict` |
| 看健康报告（含线上核对） | `node crontab\status.js --online` |

说明：`--` 之后的参数**原样透传**给子脚本；`--no-status` = 本次不改动运行器的状态账本（不污染真实闸门）。

### 3.4 手动频率：宽松与严格两种尺度

| | `mtd`（本月至今） | `finalize`（月度定稿） |
|---|---|---|
| **严格**（站上数据最鲜） | 每个交易日 18:00 后 1 次 | 次月 3 日后 1 次 |
| **宽松**（够用） | **每周 1 次**（如每周一 19:00） | **每月 1 次**（如每月 3 号 10:00） |
| 再长会怎样 | 站上「本月至今」日期越来越旧，但仍指向本月，不会出错 | 站点停在旧月份 —— 别人看到的是上个月的数据 |

`progress.json` 只是**展示层快照**（不进主回测、不影响官方指标），所以 `mtd` 少跑几次不会造成数据错误，只是"最新进度"不够新。
`finalize` 则必须每月跑一次，否则主数据不前进。

### 3.5 手动模式的代价（诚实说明）

- **没人替你看结果**：失败不会主动通知。跑完看退出码：`0` 成功或按设计跳过｜`2` 降级（正常告警）｜其它才是失败。
- **错过就是错过**：没有「每小时唤醒自动补跑」。定稿漏跑一个月，站点就停在旧月份，直到你发现。
- **建议**：要么在日历上给「每月 3 号」记一笔；要么干脆用方式 A（注册一次，永久自动，还能自动补跑）。

---

## 4. 查看清单

### 4.1 一键体检（推荐）

装好之后看运行情况：

```
node crontab\status.js --online
```

> 顺带区分一下两个「体检」脚本，别混：
> **`check_env`**（检查**能不能跑**：依赖 / 权限 / 凭据 / 网络，装之前用，见第 11 节）
> vs **`status`**（检查**跑得怎么样**：闸门状态 / 任务注册 / 数据截止 / 线上部署，装之后用，就是下面这个）。

输出五段：**① 运行状态 ② 计划任务注册情况 ③ 数据窗口与仓库 ④ 最近日志 ⑤ 线上核对**，
最后给一句结论（`✅ 一切正常` 或列出 `⚠️` 待处理项）。常用参数：

| 参数 | 作用 |
|---|---|
| `--online` | 额外核对线上版本号是否已部署、线上快照的数据截至日 |
| `--tail=30` | 每个任务多打几行日志（默认 12 行） |
| `--no-tasks` | 跳过 `schtasks` 查询（沙箱/受限环境、或手动模式没注册任务时用） |
| `--no-color` | 纯文本输出（重定向到文件时用） |

> 手动模式下（没注册任务）建议加 `--no-tasks`，否则第 2 段会提示任务未注册——那是预期的。

### 4.2 逐项手工核对（不想用脚本时）

| 看什么 | 命令 | 正常表现 |
|---|---|---|
| 任务是否注册、下次何时跑 | `schtasks /query /tn hdszf-mtd /v /fo LIST` | 状态=就绪，下次运行时间=最近的整点 |
| 上次执行结果 | 同上，看「上次运行结果」 | `0`=成功；`2`=降级（正常告警）；其它=失败 |
| 运行器自己的账本 | `type ..\_hdszf_logs\status.json` | 两个 job 的 `last_ok_*` / `fail_streak` |
| 详细日志 | `type ..\_hdszf_logs\mtd_2026-09.log` | 每行带时间戳，含子脚本完整输出 |
| 数据是否跟上 | `node crontab\status.js --no-tasks --tail=0` | 「数据截至」≈ 最近交易日；快照未过期 |
| 线上是否已部署 | 浏览器打开 https://h.sugas.site/ 看页脚版本号，或 `--online` | 线上与本地 `?v=` 一致 |
| 提交是否推成功 | `git log --oneline -5` + `git ls-remote origin main` | 两者 HEAD 一致 |

### 4.3 必须认识的三个退出码

| 退出码 | 含义 | 要不要管 |
|---|---|---|
| `0` | 成功；或按设计跳过（未到时间窗、已成功过、目标月未走完、休市无变化、工作区脏） | 不用管 |
| `2` | **降级**：取数不完整 → 按铁律**不写入、不推送**任何本月至今数据，站点自动回退到「已定稿」口径 | 一般不用管（下个小时会自动重试）；连续多天为 2 才需要查网络 |
| 其它 | 真失败（脚本报错 / 自检不通过 / push 被拒） | 看日志尾部与第 6 节 |

---

## 5. 运行器内部做了什么（为什么可以放心无人值守）

| 机制 | 说明 |
|---|---|
| **幂等闸门** | 当天（MTD）/ 当月（定稿）成功过一次后，后续唤醒立即退出，绝不重复提交、重复部署 |
| **尝试次数上限** | MTD 每晚最多 3 次、定稿每天最多 1 次 —— 失败也不会刷屏，次日自动重试 |
| **单实例锁**（跨平台必需） | 两个任务共用一把锁（`_hdszf_logs/automation.lock`）。Windows 计划任务默认「已在运行就不启动新实例」，Linux cron **没有**这层保护，而且 mtd 与 finalize 的时段本来就有重叠 —— 没有锁时两个进程会同时 `git commit/push` 互相踩。持有进程崩溃留下的僵尸锁会在超 1 小时后被下次唤醒自动接管 |
| **时区归一** | 脚本启动即把 `TZ` 定为 `Asia/Shanghai`（可用 `HDSZF_TZ` 覆盖），保证「18:00 后」「周末」「每月 3 日后」在任何时区的服务器上都按北京时间判断 —— 云服务器多是 UTC，不归一就会整体错 8 小时 |
| **自愈推送** | 每次运行前 `fetch` 并比对本地 HEAD 与远程 tip：本地领先（上次 push 失败）就补推；**远程领先/分叉时只告警不硬推**（那说明另一台机器也在跑自动化，硬推必然被拒） |
| **定稿前置：工作区必须干净**（硬闸门） | 定稿内部是 `git add -A`，脏工作区会把人工改动裹进「数据更新」一起上线 → 不干净则**跳过并提示**。`--force` 也不绕过（这是安全约束，不是时机约束） |
| **失败自动回滚** | 定稿失败时若留下未提交改动，自动 `git checkout -- .` 还原成「什么都没发生」——避免半成品被下次运行继续加工 |
| **不造数据** | 所有数值都由既有脚本产出；运行器只决定「何时跑、跑了记什么」。铁律「月未走完不更新」由 `monthly_update.js` 自己把住（未走完 → `exit 0`） |
| **降级不推假数据** | 取数不完整 → 脚本把相关字段全写 `null`（不是 `0`）且不写不推，站点回退「已定稿」口径 |
| **日志在仓库外** | 写在 `<工作区>\_hdszf_logs\`。仓库根目录是 Cloudflare Assets 的发布目录，日志放进去会被**公开上传**并污染 git |
| **改时间不改脚本** | 调整执行时段只改计划任务触发器，运行器自适应 |

---

## 6. 故障处置

| 现象 | 原因 | 处置 |
|---|---|---|
| `status.js` 说「运行器从未执行」 | 计划任务没注册，或 task 被禁用 | 跑 `install.cmd`；`schtasks /change /tn hdszf-mtd /enable`；手动模式请加 `--no-tasks` |
| `status.js` 说「工作区有未提交改动」 | 有手改没提交 | 定稿前先 `git commit` / `git stash`（运行器会跳过定稿，属正常保护） |
| 连续几次 `exit=2` | 新浪接口取数失败 / 网络不通 | 手工 `node scripts\monthly_progress.js --no-json` 看具体哪个资产失败；恢复后下次唤醒自动补上 |
| `exit=1` 且日志出现「自检失败」「替换规则未命中」 | 展示层或静态文案与替换规则脱节（真问题，不会自动修） | 日志里有具体文件与规则；修好后当天/次日自动重跑即可 |
| 定稿后页面数字没变 | push 成功但 Cloudflare 还在部署，或 push 失败 | `node crontab\status.js --online` 看线上版本号是否落后 |
| 远程 tip ≠ 本地 HEAD | push 被拒（远程有新提交） | 手工 `git pull --rebase` 后 `git push`；运行器的自愈推送下次会跟上 |
| 任务跑得很晚 / 没跑 | 电脑睡眠或关机 | 唤醒后同一时段内会自动补跑；整段错过则等下一天/下一月（或手动 `--force` 补） |
| 想立即看今天的数据 | — | `node crontab\run_job.js mtd --force` |

---

## 7. 维护方法

### 7.1 Node 升级 / 换机器后

**Windows**：有两处需要跟着改的绝对路径（文件内都有注释标记）：

1. `crontab/install.cmd`（以及 `uninstall.cmd`、`status.cmd`）顶部的 `set "NODE=..."` —— 计划任务里存的就是这个路径；
   改完**重新运行 `install.cmd`** 覆盖注册。
2. `crontab/run_job.js` 里的 `EXTRA_PATH`（git / python 的目录）—— 计划任务的 PATH 很干净，脚本靠它找到 `git` 与 `python`。

**Linux**：不需要手改 —— `bash crontab/install.sh` 会自动探测 node 的绝对路径并写进 crontab；
换了 node 之后重跑一次即可（或 `bash crontab/install.sh --node /新路径/node`）。
`EXTRA_PATH` 在 Linux 侧会自动换成 `/usr/local/bin:/usr/bin:/bin` 等常见目录。

> `run_job.js` 与 `status.js` 里的仓库根是用 `__dirname\..` 现推的，
> 所以**整个 `crontab/` 目录可以随意改名或搬家**，只要它还在仓库根下一级，路径就自动正确。

改完用 `node crontab\run_job.js mtd --no-status` 验证一次。

### 7.2 改执行时间

```bat
schtasks /change /tn "hdszf-mtd" /st 19:00 /et 23:00
```

或打开「任务计划程序」图形界面改触发器。**不需要改任何脚本**。

### 7.3 强制重跑 / 手动补跑

```
node crontab\run_job.js finalize --force        # 忽略全部软闸门，立刻定稿
node crontab\run_job.js mtd --force             # 忽略全部软闸门，立刻刷新 MTD
node crontab\run_job.js mtd -- --no-fetch       # 「--」后的参数透传给子脚本（诊断用）
node crontab\run_job.js --help                  # 打印用法
```

也可以完全绕过运行器直跑原脚本（脚本本身就能独立完成全部工作）：

```
node scripts\monthly_progress.js --push
node scripts\monthly_update.js --strict
```

⚠️ 直跑 `monthly_update.js` 前先让工作区干净（原因见 3.2 的警告）。

### 7.4 日志

- 位置：`C:\Users\23405\WorkBuddy\2026-08-20-17-46-50\_hdszf_logs\`
  （`mtd_YYYY-MM.log`、`finalize_YYYY-MM.log`、`status.json`）
- 按月分文件，体积极小；想清理直接删旧月份文件即可（`status.json` 别删，它记着闸门状态）。
- 迁移日志目录：设环境变量 `HDSZF_LOG_DIR` 即可（运行器与 status 都认）。
- ⚠️ **绝对不要把日志放进仓库**（会随 Assets 公开上传、还会被自动提交）。

### 7.5 卸载

```
crontab\uninstall.cmd
```

（或 `schtasks /delete /tn "hdszf-mtd" /f` 与 `schtasks /delete /tn "hdszf-finalize" /f`）

卸载后若想继续更新数据，就按第 3 节手动跑。

### 7.6 与 WorkBuddy 自动化的关系

项目此前在 WorkBuddy 里配了两条自动化（每月 3 日 `monthly_update.js`、每周一 `monthly_progress.js --push`）。
那两条是**由 AI 会话驱动**的，依赖应用在运行、且消耗额度。

本方案上线后**建议停用那两条**，避免同一天两处同时 `git push` 相互撞车
（虽然两个脚本都幂等、撞车也不致命，但会造成重复部署）。

---

## 8. 已知取舍

| 取舍 | 说明 | 想改的话 |
|---|---|---|
| 电脑关机/睡眠期间不跑 | 计划任务依赖本机 | 改用 GitHub Actions（云端 cron）：需要新增 `.github/workflows/` 并用 `GITHUB_TOKEN` 推送；风险是境外 runner 取新浪数据的可用性，需先验证 |
| 手动模式没有补跑与通知 | 见 3.5 | 用方式 A（注册计划任务） |
| 每个交易日推送一次 = 每天一次 Cloudflare 部署 | 约每月 21 次部署 | 若在意部署次数，可把 `mtd` 改成每周一跑（`/sc WEEKLY /d MON`） |
| 需要本机有 Node + git + Python | 月度定稿取数用 Python | 已全部就绪，无需额外安装 |
| `crontab/` 会随 Assets 一起公开 | 与现有 `scripts/` 目录情况一致，脚本内**不含任何密钥或 token** | 需要隐藏的话加 `.assetsignore`（改动部署行为，需先本地验证） |

---

## 9. 文件清单

| 文件 | 作用 |
|---|---|
| `run_job.js` | 运行器：闸门 + 日志 + 状态账本 + 单实例锁 + 时区归一 + 自愈推送 + 失败回滚（`mtd` / `finalize` 两个任务）。**跨平台** |
| `status.js` | 健康检查（查看清单），只读。**跨平台**（Windows 查 schtasks，Linux 查 crontab） |
| `check_env.js` | **环境体检（深度层）**：运行时版本 / 仓库 / 工作区 / 推送凭据 / 网络 / 日志目录 / 磁盘 / 调度器条目。**跨平台**，只读。支持 `--json` / `--quiet` / `--no-network` |
| `check_env.sh` | **Linux 引导层**：系统 / apt 依赖 / cron 服务 / sudo / 时区 / 时钟同步，`--fix` 自动装依赖（见第 11 节），随后调用 `check_env.js` |
| `check_env.cmd` | **Windows 引导层**：找 node 后调用 `check_env.js`；`--fix` 用 winget 补 git / python |
| `install.cmd` / `uninstall.cmd` | **Windows**：注册 / 删除计划任务（`install.cmd` 会先跑 `check_env.cmd`） |
| `status.cmd` | **Windows**：双击即可看健康报告 |
| `install.sh` / `uninstall.sh` | **Linux**：写入 / 移除 crontab 条目（幂等，保留你其它条目）；`install.sh` 会先跑 `check_env.sh`（`--fix` 可带上 `--fix`；有阻塞项则中止；`--no-check` 跳过） |
| `status.sh` | **Linux**：健康检查入口（等价于 `node crontab/status.js`） |
| `README.md` | 本文档 |

依赖的两个业务脚本在上级目录：`../scripts/monthly_progress.js`（MTD 快照）、`../scripts/monthly_update.js`（月度定稿）。

---

## 10. Ubuntu / Linux 云服务器部署（cron）

> **推荐场景**：把自动化放在 24 小时在线的云服务器上，本机只作替补（手动 `--force` 补跑）。
> 脚本**不需要改**：`run_job.js` / `status.js` 已经是跨平台的，Linux 上只是换一个调度器。

### 10.1 与 Windows 版的差异（先看这张表）

| | Windows（本机） | Linux（云服务器） |
|---|---|---|
| 调度器 | 任务计划程序（`schtasks`） | `cron` |
| 注册 / 卸载 | `install.cmd` / `uninstall.cmd` | `bash crontab/install.sh` / `bash crontab/uninstall.sh` |
| 查看 | `status.cmd` | `bash crontab/status.sh --online` |
| 单实例保护 | 计划任务自带（「已在运行就不再启动新实例」复选框） | **cron 没有 → 靠 `run_job.js` 的文件锁兜住**（见 5. 单实例锁） |
| 唤醒策略 | 18:00–23:59 每小时 | **全天每小时**（时区安全，见 10.4） |
| 日志 | `<工作区>\_hdszf_logs\` | `<仓库上级>/_hdszf_logs/`（同一套逻辑，可用 `HDSZF_LOG_DIR` 覆盖） |
| 假数据/降级闸门、幂等闸门、回滚、自愈推送 | 完全相同 | 完全相同 |

### 10.2 前置条件（在服务器上各做一次）

> **不用背这张表**：先跑一遍体检，它会逐项告诉你缺什么、怎么装。
>
> ```
> bash crontab/check_env.sh            # 只体检，什么都不改
> bash crontab/check_env.sh --fix      # 缺 git / python3 / cron / curl / openssh 时自动 apt 装
> bash crontab/check_env.sh --fix --fix-node   # node 缺失或低于 18 时，用 NodeSource 装 22.x
> ```
>
> 下表是它检查的项目（也是手工核对时的清单）：

| 项 | 检查 / 命令 | 说明 |
|---|---|---|
| **Node ≥ 18** | `node -v` | **⚠️ 最容易踩的一条**：Ubuntu 22.04 用 `sudo apt install nodejs` 装到的是 **12.x**，直接不可用。请用 NodeSource 或 nvm：<br>`curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install -y nodejs`<br>`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh \| bash && nvm install --lts`<br>版本要求来自两处：时区归一要 **16+**、实时取数用全局 `fetch` 要 **18+**。 |
| git | `git -v` | `sudo apt install -y git` |
| Python3 | `python3 -V` | 只有**月度定稿（finalize）**需要它取数：`sudo apt install -y python3`（标准库够用，无需 pip） |
| git 身份 | `git config --global user.name/user.email` | 不配的话 commit 会被拒。⚠️ 建议用全局配置：`git config --global user.email "sugas13465@gmail.com"` |
| **推送凭据** | `cd <仓库> && git ls-remote origin main` | **最容易翻车的一步**。仓库 remote 是 SSH（`git@github.com:...`），无头服务器上必须配好 key，详见 10.3 |
| cron 服务 | `systemctl is-active cron` | 应为 `active`；否则 `sudo systemctl enable --now cron` |

> 先做这一步：**把仓库更新到最新**（`cd /home/ubuntu/code/hdszf && git pull`）——
> `install.sh` / `status.sh` / `.gitattributes` 与运行器的跨平台改造是 2026-09-30 才加的，旧 clone 里没有。

### 10.3 SSH 推送凭据（服务器上没有浏览器、也没有密码交互）

cron 环境里**没有 SSH agent、也没有终端可以输密码**，所以必须用**无口令的 deploy key**：

```bash
# 1) 在服务器上生成专用 key（一路回车，不要设 passphrase —— cron 里没法输）
ssh-keygen -t ed25519 -C "hdszf-cron@$(hostname)" -f ~/.ssh/id_ed25519 -N ""

# 2) 把公钥内容复制出来
cat ~/.ssh/id_ed25519.pub

# 3) 打开 GitHub → 仓库 xp13465/hdszf → Settings → Deploy keys → Add deploy key
#    粘贴公钥，并**勾选 Allow write access**（不勾就只能读，push 会失败）

# 4) 首次连接要接受 github.com 主机指纹（cron 里无法交互确认，必须提前写进 known_hosts）
ssh-keyscan github.com >> ~/.ssh/known_hosts

# 5) 自测（应看到 "Hi ...! You've successfully authenticated"）
ssh -T git@github.com
```

> `install.sh` 会自动帮你跑一次 `git ls-remote origin main` 验证凭据，失败会明确提示 —— 不用等到
> 「每月 3 号定稿失败」才发现。
>
> 如果不想用 deploy key，也可以把 remote 换成 token 形式的 HTTPS：
> `git remote set-url origin https://<user>:<token>@github.com/xp13465/hdszf.git`（token 要 `repo` 权限）。
> ⚠️ 这样 token 会明文存在 `.git/config` 里，注意服务器权限。

### 10.4 安装

```bash
cd /home/ubuntu/code/hdszf
git pull                              # 先拉最新（check_env.* 是 2026-09-30 才加的）

bash crontab/check_env.sh             # ① 先体检（只读）：缺什么一目了然
bash crontab/check_env.sh --fix       # ② 缺 git/python3/cron/curl/openssh 就自动装
                                      #    node 缺失或过低：加 --fix-node（走 NodeSource）

bash crontab/install.sh --dry-run     # ③ 先看看会写入什么（推荐）
bash crontab/install.sh               # ④ 正式安装
```

> `install.sh` 会**自己先跑一遍 `check_env.sh --no-network`**，有阻塞项就中止（`--fix` 可透传）；
> 所以第 ① ② 步不是必须的，但单独跑一遍能提前看清环境。要跳过体检用 `--no-check`。

它会做：探测 `node` 绝对路径 → **环境体检（系统 / 依赖 / cron 服务 / 仓库 / 凭据）** → 创建日志目录 →
把下面这段写进**当前用户**的 crontab（用 BEGIN/END 标记界定，**不动你 crontab 里的其它条目**，重复执行幂等）：

```cron
PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/bin
MAILTO=""
### hdszf automation (managed by crontab/install.sh) >>>
7  * * * * /usr/bin/node /home/ubuntu/code/hdszf/crontab/run_job.js mtd      >> /home/ubuntu/code/_hdszf_logs/cron.log 2>&1
37 * * * * /usr/bin/node /home/ubuntu/code/hdszf/crontab/run_job.js finalize >> /home/ubuntu/code/_hdszf_logs/cron.log 2>&1
### <<< hdszf automation <<<
```

常用参数：`--node /path/to/node`、`--hours 18-23`（见下）、`--show`（只看当前 crontab）、`--dry-run`、
`--fix`（体检时顺带用 apt 补依赖）、`--no-check`（跳过体检，明知故犯时用）。

### 10.5 时区（**最容易踩的坑，务必读完**）

两个事实放在一起看：

1. 云服务器默认时区**多为 UTC**；
2. A 股的交易时段与月历都是**北京时间**。

于是「每天 18:00 之后才跑」这句话，在 UTC 服务器上会被解释成 **UTC 18:00 = 北京次日 02:00** ——
表面看任务成功了，取到的却是上一个交易日的收盘。

本方案用**两层保护**解决：

| 层 | 做法 |
|---|---|
| 调度层 | cron 写**全天每小时唤醒**（`7 * * * *`），不写死小时数 —— 时区再怎么不同都不会错位，只是多几次空转（每次几百毫秒） |
| 判断层 | `run_job.js` 启动即把 `TZ` 归一为 `Asia/Shanghai`（`scripts/` 下两个业务脚本同样处理），所以「18:00 后 / 周末 / 每月 3 日后」一律按北京时间判断 |

想看服务器现在是什么时区：

```bash
date; node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"
```

如果你想省掉空转、只在自己指定的钟点唤醒（`--hours 18-23`），`install.sh` 会自动往 crontab 里补一行
`CRON_TZ=Asia/Shanghai` 让 cron 也按北京时间解释，并打印警告 —— 若你的 cron 不支持该指令，请改回默认的全天唤醒。
`node crontab/status.js` 的报表头会显示当前生效的 `TZ`，可与 `date` 对照。

### 10.6 验证（安装后按顺序做一遍）

```bash
# 1) 零副作用试跑：真实联网取数、打印完整报告，但不写文件、不推送
node crontab/run_job.js mtd --no-status -- --no-json
#    看到「取数状态：5/5 个风险资产实时成功」与 exit=0 即链路通

# 2) 让今天的数据真实上线（会 commit + push，触发 Cloudflare 部署）
node crontab/run_job.js mtd --force

# 3) 健康报告（第 2 段会列出 crontab 条目与下次触发时间）
bash crontab/status.sh --online
```

### 10.7 查看清单（Linux 版）

| 看什么 | 命令 | 正常表现 |
|---|---|---|
| 一键体检 | `bash crontab/status.sh --online` | 五段报告 + 结论；第 2 段显示 `cron 服务：active` 与两条条目 |
| 条目是否在 | `crontab -l` | 能看到 `run_job.js mtd` / `run_job.js finalize` 两行 |
| **下次何时跑** | `bash crontab/status.sh` | 第 2 段会算出下次触发时间（估算） |
| cron 服务在跑 | `systemctl is-active cron` | `active` |
| 运行器的账本 | `cat <仓库上级>/_hdszf_logs/status.json` | 两个 job 的 `last_ok_*` / `fail_streak` |
| 详细日志 | `tail -n 40 <仓库上级>/_hdszf_logs/mtd_2026-09.log` | 每行带时间戳，含子脚本完整输出 |
| cron 层输出 | `tail -n 40 <仓库上级>/_hdszf_logs/cron.log` | 只有异常（如 node 路径失效）时才有内容值得看 |
| 有没有任务在跑 | `ls -l <仓库上级>/_hdszf_logs/automation.lock` | 不存在 = 当前空闲；存在且 pid 活着 = 正在跑 |
| **cron 日志** | `journalctl -u cron -n 50 --no-pager` | Ubuntu 上 cron 执行记录（含 `CRON ... CMD`） |
| 数据是否跟上 | `node crontab/status.js --no-tasks --tail=0` | 「数据截至」≈ 最近交易日；快照未过期 |
| 推送是否成功 | `cd <仓库> && git log --oneline -3 && git ls-remote origin main` | 两者 HEAD 一致 |

退出码语义与 Windows 完全相同：`0` 成功或按设计跳过｜`2` 降级（无数据可发布，正常）｜其它才是失败。

### 10.8 维护

| 我要… | Linux 做法 |
|---|---|
| 改执行钟点 | 重跑 `bash crontab/install.sh --hours 18-23`，或 `crontab -e` 手改（⚠️ 手改会脱离 install.sh 的管理，下次重装会被整段覆盖，记得同步） |
| Node 升级 / 换了 node 路径 | 重跑 `bash crontab/install.sh --node /新路径/node` |
| 换日志目录 | `export HDSZF_LOG_DIR=/var/log/hdszf && bash crontab/install.sh`（会写进 crontab） |
| 迁移仓库位置 | `git clone` 到新路径后重跑 `install.sh` 即可（脚本里的路径都是现推的，`crontab/` 目录本身可随意改名/搬家，只要它还在仓库根下一级） |
| 强制补跑 | `node crontab/run_job.js mtd --force` / `node crontab/run_job.js finalize --force` |
| 卸载 | `bash crontab/uninstall.sh` |
| 清理日志 | 日志按月分文件、体积极小；删旧月份文件即可。**`status.json` 别删**（它记着闸门状态），`cron.log` 可随时清空 |

### 10.9 Linux 专属故障处置

| 现象 | 原因 | 处置 |
|---|---|---|
| `status.sh` 说「crontab 里没有 hdszf 条目」 | 没装 / 被 `uninstall.sh` 删了 | `bash crontab/install.sh` |
| `status.sh` 说 `cron 服务状态 = inactive` | 服务器没开 cron | `sudo systemctl enable --now cron` |
| crontab 有条目但从不执行 | ① node 路径变了 ② `~/.ssh` 权限不对 ③ 服务器时区导致闸门全跳过 | 看 `cron.log`；`node crontab/run_job.js mtd --no-status -- --no-json` 手工跑一次；核对报表头 `TZ=Asia/Shanghai` |
| `Permission denied (publickey)` | deploy key 没配 / 没勾 write access / known_hosts 缺 | 见 10.3 |
| `error: failed to push some refs` / 日志出现「远程上有本地没有的提交」 | **两台机器同时跑自动化**（本机 + 服务器），或远端有人手推 | 只保留一台跑自动任务（见 10.10）；本地 `git pull --rebase` 后重跑 |
| 定稿被跳过，日志写「工作区有未提交改动」 | 服务器上有人改过文件没提交（含 git pull 产生的 merge 冲突残留） | `git status` 看清后 `git commit` / `git stash` / 还原 |
| 日志出现「发现僵尸锁」 | 上次运行被 OOM / 强杀 | 无需处理，下次唤醒自动接管；急可 `rm <仓库上级>/_hdszf_logs/automation.lock` |
| 手动跑报 `bad interpreter: /usr/bin/env bash^M` | `.sh` 被 Windows 编辑器存成了 CRLF | 仓库已有 `.gitattributes` 锁定 `*.sh eol=lf`；本地用 `sed -i 's/\r$//' crontab/*.sh` 修一次即可 |

### 10.10 ⚠️ 只让一台机器跑自动化

`mtd` / `finalize` 都会在结束时 `git push`。**两台机器同时跑同一个任务**（本机 + 服务器）会出现
「一个推成功、另一个被拒」，虽然脚本幂等、不会损坏数据，但会造成重复部署与日志噪音。

约定：

- **首选**：自动化放服务器（24h 在线、不受睡眠影响），本机只做替补。
- 本机继续保留计划任务时，**务必把 `mtd` 的频率降下来**（例如改成每周一跑），或干脆停用，只手动 `--force` 补跑。
- 运行器的自愈推送已能识别这种情况：远程领先时它**不硬推**，只在日志里明确告警。
- WorkBuddy 里那两条旧自动化（每周一 / 每月 3 日）同样应停用，理由见 7.6。


---

## 11. 环境检测与依赖安装（2026-09-30 新增）

**一句话**：装调度器之前先体检；缺东西能自动装。

```
bash crontab/check_env.sh              # Linux：只体检，什么都不改
bash crontab/check_env.sh --fix        # Linux：顺带用 apt 把缺的依赖装齐
crontab\check_env.cmd                  # Windows：只体检
crontab\check_env.cmd --fix            # Windows：顺带用 winget 装 git / python
```

`install.sh` / `install.cmd` 都会**自动先跑这一遍**，有阻塞项就中止 —— 避免「任务装上了、每天按时唤醒、一个月后才发现 node 版本不对」这种最贵的失败。
（要明知故犯硬装：`bash crontab/install.sh --no-check`。）

### 11.1 三个脚本怎么分工

| 文件 | 角色 | 内容 |
|---|---|---|
| `check_env.js` | **深度层（跨平台）** | 运行时版本 / 仓库与工作区 / 推送凭据 / 网络 / 日志目录 / 磁盘 / 调度器条目 |
| `check_env.sh` | **Linux 引导层** | 系统 / apt 依赖 / cron 服务 / sudo / 时区 / 时钟同步 + **`--fix` 装依赖**，随后调用 `check_env.js` |
| `check_env.cmd` | **Windows 引导层** | 找 node（找不到就给 winget 命令）→ 调用 `check_env.js`；`--fix` 用 winget 补 git / python |

设计意图：**只做一遍检查**。深度检查写在 node 里（两个平台共用，不会漂移）；`node` 本身缺不缺、`cron` 装没装、`apt` 能装什么，只能在 node **之外**判断，所以放在各自的引导层。
引导层的阻塞/警告数会通过环境变量带进 `check_env.js`，**最终只出一份合并汇总**。

### 11.2 检查项（两平台对齐）

| # | 检查项 | 阻塞? | Linux 引导层 | Windows 引导层 | 深度层 |
|---|---|---|---|---|---|
| 1 | 系统与发行版 / 架构 | — | ✅ | ✅（由 node 报） | |
| 2 | root 或 sudo 可用（`--fix` 前提） | — | ✅ | — | |
| 3 | `crontab` 命令存在 | **是** | ✅ | — | |
| 4 | cron 服务 active | **是** | ✅（systemctl / init.d） | — | |
| 5 | node 存在且 **≥ 18** | **是** | ✅（含 nvm / NodeSource 路径探测） | ✅ | ✅ |
| 6 | git 存在 | **是** | ✅ | ✅ | ✅ |
| 7 | python3 存在（仅 finalize 需要） | 否 | ✅ | ✅ | ✅ |
| 8 | `ssh` / `ssh-keyscan`（SSH remote 时） | 否（但推送会失败） | ✅ | ✅ | ✅ |
| 9 | `curl`（NodeSource 安装方式需要） | 否 | ✅ | — | — |
| 10 | CA 证书 | 否 | ✅ | — | — |
| 11 | 系统时区与 UTC 偏移 | 否 | ✅ | ✅ | ✅ |
| 12 | NTP 时钟同步（时间漂移会让闸门误判） | 否 | ✅ | — | — |
| 13 | 是 git 仓库 / 分支 main | **是** / 否 | | | ✅ |
| 14 | origin 配置 + 协议（https 会警告） | **是** / 否 | | | ✅ |
| 15 | git 身份（user.name / user.email） | **是** | | | ✅ |
| 16 | 工作区干净（finalize 硬闸门） | 否 | | | ✅ |
| 17 | `run_job.js` 存在 | **是** | | | ✅ |
| 18 | 私钥 / known_hosts / 远程可达（`ls-remote`） | 私钥/远程**是** | | | ✅ |
| 19 | 新浪行情接口可达 | **是** | | | ✅ |
| 20 | GitHub HTTPS 可达（仅供参考，推送走 SSH） | 否 | | | ✅ |
| 21 | 日志目录在仓库外 + 可写 | **是** | | | ✅ |
| 22 | 磁盘剩余 ≥ 200MB | 否 | | | ✅ |
| 23 | 调度器条目已注册（crontab 段 / schtasks） | 否 | | | ✅ |

> **阻塞** = 现在装上去会白跑，退出码 `1`；**否** = 只出 `⚠` 警告，退出码 `0`。

### 11.3 输出怎么读

```
  ✅ 系统        Ubuntu 22.04.4 LTS · 5.15.0-105-generic · x86_64
  ⚠  node        v12.22.9 过低（需要 18+）· /usr/bin/node
      → 时区归一要 16+，实时取数要 18+ → bash crontab/check_env.sh --fix-node
  ·  系统时区    UTC · UTC+0000
```

- `✅` 通过；`⚠` 警告（能跑，但建议处理）；`✗` 阻塞；`·` 仅供参考。
- 末尾一行是**合并汇总**：`✗ 阻塞 N 项 / ⚠ 警告 M 项`，`N > 0` 时退出码 `1`。
- `⚠ 偏移 UTC+0000 ≠ UTC+0800` 这类**不用管**：运行器有 TZ-GUARD，会强制按北京时间判断，不需要改服务器时区。

### 11.4 `--fix` 能装什么（Linux）

| 缺什么 | 安装方式 | 备注 |
|---|---|---|
| git / python3 / cron / curl / ca-certificates / openssh-client | `sudo apt-get install -y <包>` | 自动，幂等 |
| **node** | **不会**自己走 apt | ⚠️ Ubuntu 22.04 的 apt 只给 **12.x**，装了更糟。要自动装必须显式加 `--fix-node`（走 NodeSource 22.x），否则只打印命令 |

```
bash crontab/check_env.sh --fix            # 装 apt 那批
bash crontab/check_env.sh --fix --fix-node # 连 node 22.x 一起装（NodeSource）
```

Windows 侧 `--fix` 走 winget（`OpenJS.NodeJS.LTS` / `Git.Git` / `Python.Python.3.12`），**装完要重开一个 cmd**（PATH 才更新）。
没有 winget 就只打印官网链接。本机 `schtasks` 被安全策略限制时，第 7 段（调度器条目）会以警告形式说明，**不代表任务没注册**。

### 11.5 常用参数

| 脚本 | 参数 | 作用 |
|---|---|---|
| 两者 | `--no-network` | 跳过联网检查与 `ls-remote`（离线 / 受限网络；`install.sh` 内部就这么调） |
| 两者 | `--quiet` / `-q` | 只打印 ⚠ 与 ✗ |
| `check_env.js` | `--json` | 机器可读输出（`{ok, counts, items[]}`），便于接监控 |
| `check_env.js` | `--no-runtime` | 跳过运行时段（引导层已报过，避免重复） |
| `check_env.sh` | `--print-node` | 只输出可用 node 的绝对路径（`install.sh` 用它取路径） |
| `check_env.sh` | `--fix-node` | node 缺失/过低时用 NodeSource 装 22.x（隐含 `--fix`） |

退出码统一：**`0` = 无阻塞项**（可能有警告）；**`1` = 有阻塞项**（先修再装）；`2` = 参数写错。

### 11.6 体检常见问题

| 现象 | 含义 / 处置 |
|---|---|
| `✗ node v12.22.9 过低` | 用 apt 装到 12.x 了 → `bash crontab/check_env.sh --fix --fix-node` |
| `✗ crontab 找不到命令` | 没装 cron：`sudo apt-get install -y cron`（`--fix` 会装） |
| `✗ cron 服务 状态=inactive` | `sudo systemctl enable --now cron` |
| `⚠ cron 服务 查不到状态` | 容器环境常见：cron 由宿主机/进程管理器托管，需自行确认在跑（容器里跑自动化不是推荐姿势） |
| `✗ 私钥 / 远程可达` | 无头服务器必看 10.3（deploy key 要勾 **Allow write access**，并 `ssh-keyscan github.com >> ~/.ssh/known_hosts`） |
| `⚠ 工作区 有未提交改动` | finalize 会按硬闸门跳过 → 先 `git commit` / `git stash` |
| `⚠ 偏移 UTC+0000` | **不用处理**，TZ-GUARD 会归一 |
| `⚠ GitHub HTTPS 超时` | **不用处理**，推送走 SSH 22 端口，以「远程可达」为准 |
| `--fix` 报 `apt 安装失败` | 软件源索引过期：`sudo apt-get update` 后重跑 |
