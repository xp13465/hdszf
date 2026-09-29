# 恒市值助手 · 定时任务（Windows 计划任务 / 手动）

> **一句话**：数据更新与月度定稿固化**完全不依赖 AI / WorkBuddy**——由本机 Windows 计划任务唤醒
> `crontab/run_job.js`，运行器再去调 `scripts/` 下既有的两个脚本。
> 全程只需要 **Node + git + Python**（月度定稿取数用），零额度、零对话、零人工。
>
> **不想装计划任务？** 直接看第 3 节「方式 B：手动跑」——两条命令，按频率自己跑就行。

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

### 步骤 1：注册

在**你自己的终端**里执行（本机 `schtasks` 被安全策略限制，AI 无法代跑）：

```
cd /d C:\Users\23405\WorkBuddy\2026-08-20-17-46-50\hdszf\crontab
install.cmd
```

也可以直接**双击** `install.cmd`。它做的事：

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

## 3. 方式 B：手动跑（**不安装 `install.cmd`**）

不注册计划任务，就自己按频率敲命令。**两条命令，两个频率**：

```
cd /d C:\Users\23405\WorkBuddy\2026-08-20-17-46-50\hdszf

node crontab\run_job.js mtd --force          ← 每交易日 18:00 后，1 次
node crontab\run_job.js finalize --force     ← 每月 1 次（次月 3 日后）
```

> 命令都从**仓库根目录**执行；`crontab\` 是相对路径，跟着仓库走，换机器不用改。
> 想省事可以把这两条各写成一个 `.cmd` 双击跑，或在 PowerShell 里用 `;` 串起来。

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

```
node crontab\status.js --online
```

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
| **自愈推送** | 每次运行前比对本地 HEAD 与远程 tip；若本地领先（上次 push 失败）就先补推，避免静默卡住 |
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

有两处**需要跟着改**的绝对路径（文件内都有注释标记）：

1. `crontab/install.cmd`（以及 `uninstall.cmd`、`status.cmd`）顶部的 `set "NODE=..."` —— 计划任务里存的就是这个路径；
   改完**重新运行 `install.cmd`** 覆盖注册。
2. `crontab/run_job.js` 里的 `EXTRA_PATH`（git / python 的目录）—— 计划任务的 PATH 很干净，脚本靠它找到 `git` 与 `python`。

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
| `run_job.js` | 运行器：闸门 + 日志 + 状态账本 + 自愈推送 + 失败回滚（`mtd` / `finalize` 两个任务） |
| `status.js` | 健康检查（查看清单），只读 |
| `install.cmd` / `uninstall.cmd` | 注册 / 删除计划任务 |
| `status.cmd` | 双击即可看健康报告 |
| `README.md` | 本文档 |

依赖的两个业务脚本在上级目录：`../scripts/monthly_progress.js`（MTD 快照）、`../scripts/monthly_update.js`（月度定稿）。
