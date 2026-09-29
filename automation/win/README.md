# 恒市值助手 · 纯脚本自动化（Windows 计划任务）

> **一句话**：数据更新与月度固化已经**完全不依赖 AI / WorkBuddy**——
> 由 Windows 计划任务在固定时间唤醒 `automation/win/run_job.js`，运行器再去调 `scripts/` 下既有的两个脚本。
> 全程只需要 **Node + git + Python**（月度定稿取数用），零额度、零对话、零人工。

---

## 1. 装了什么

| 计划任务名 | 触发 | 实际行为 | 频率 |
|---|---|---|---|
| `hdszf-mtd` | 每天 18:00–23:59 每小时唤醒一次 | 跑 `scripts/monthly_progress.js --push`：取当日收盘 → 更新 `js/progress.json` → 有变化才 commit + push（触发 Cloudflare 部署） | 每个交易日 1 次 |
| `hdszf-finalize` | 每天 09:00–23:59 每小时唤醒一次 | 跑 `scripts/monthly_update.js --strict`：取上月数据 → 重算派生 → 版本号 bump → 静态文案 → 文档 → 差异报告 → 刷新快照 → 自检 → commit + push | 每月 1 次（3 日起） |

**为什么是「每小时唤醒」而不是「每天一次」**
运行器内部自带闸门（当天/当月成功一次就立即跳过），所以高频唤醒**不会**重复提交、重复部署，
反而是「电脑那会儿正好睡眠/关机」时唯一能自动补跑的办法。每小时唤醒一次、跑完即退，代价可忽略。

**为什么 MTD 排在 18:00 之后**
A 股 15:00 收盘，新浪日 K 傍晚才更新；18:00 之后取的是**当日真实收盘**，不是昨天的数据。

**为什么月度固化排在每月 3 日之后**
给「上月末最后一个交易日」的行情留出发布余量，避免月初头两天取到不完整的月末数据。

---

## 2. 安装（一次性，3 步）

### 步骤 1：注册计划任务

在**你自己的终端**里执行（我这边沙箱的安全策略禁止调用 `schtasks`，所以必须你来跑一次）：

```
cd /d C:\Users\23405\WorkBuddy\2026-08-20-17-46-50\hdszf\automation\win
install.cmd
```

也可以直接**双击** `install.cmd`。它做的事：

```bat
schtasks /create /tn "hdszf-mtd"      /tr "\"<node.exe>\" \"<仓库>\automation\win\run_job.js\" mtd"      /sc HOURLY /mo 1 /st 18:00 /et 23:59 /f
schtasks /create /tn "hdszf-finalize" /tr "\"<node.exe>\" \"<仓库>\automation\win\run_job.js\" finalize" /sc HOURLY /mo 1 /st 09:00 /et 23:59 /f
```

- **不需要管理员权限**（两条任务都以当前用户身份、仅在登录时运行），**不需要填密码**。
- 若提示失败，看 `install.cmd` 末尾打印的三种常见原因与处置。

### 步骤 2：手工试跑一次

**先跑零副作用的那条**（真实联网取数、打印完整报告，但**不写文件、不推送**）：

```
node automation\win\run_job.js mtd --no-status -- --no-json
```

看到 `取数状态：5/5 个风险资产实时成功`（或 `x/5`）与 `exit=0 → 成功` 就说明链路通了。
`--no-status` = 本次试跑不写状态文件（不影响真实调度的闸门）；`-- --no-json` = 把「不写盘」透传给子脚本
（`--no-json` 的写盘与推送是同一段逻辑，所以它同时也保证了不推送）。

**想让今天的数据真实上线**（会更新 `js/progress.json` 并推送、触发部署）：

```
node automation\win\run_job.js mtd --force
```

`--force` = 忽略「今天已成功过」的闸门，强制跑一次。

### 步骤 3：看健康报告

```
automation\win\status.cmd
```

或

```
node automation\win\status.js --online
```

---

## 3. 查看清单

### 3.1 一键体检（推荐）

```
node automation\win\status.js --online
```

输出五段：**① 运行状态 ② 计划任务注册情况 ③ 数据窗口与仓库 ④ 最近日志 ⑤ 线上核对**，
最后给一句结论（`✅ 一切正常` 或列出 `⚠️` 待处理项）。常用参数：

| 参数 | 作用 |
|---|---|
| `--online` | 额外核对线上版本号是否已部署、线上快照的数据截至日 |
| `--tail=30` | 每个任务多打几行日志（默认 12 行） |
| `--no-tasks` | 跳过 `schtasks` 查询（沙箱/受限环境用） |
| `--no-color` | 纯文本输出（重定向到文件时用） |

### 3.2 逐项手工核对（不想用脚本时）

| 看什么 | 命令 | 正常表现 |
|---|---|---|
| 任务是否注册、下次何时跑 | `schtasks /query /tn hdszf-mtd /v /fo LIST` | 状态=就绪，下次运行时间=最近的整点 |
| 上次执行结果 | 同上，看「上次运行结果」 | `0`=成功；`2`=降级（正常告警）；其它=失败 |
| 运行器自己的账本 | `type ..\..\_hdszf_logs\status.json` | 两个 job 的 `last_ok_*` / `fail_streak` |
| 详细日志 | `type ..\..\_hdszf_logs\mtd_2026-09.log` | 每行带时间戳，含子脚本完整输出 |
| 数据是否跟上 | `node automation\win\status.js --no-tasks --tail=0` | 「数据截至」≈ 最近交易日；快照未过期 |
| 线上是否已部署 | 浏览器打开 https://h.sugas.site/ 看页脚版本号，或 `--online` | 线上与本地 `?v=` 一致 |
| 提交是否推成功 | `git log --oneline -5` + `git ls-remote origin main` | 两者 HEAD 一致 |

### 3.3 必须认识的三个退出码

| 退出码 | 含义 | 要不要管 |
|---|---|---|
| `0` | 成功；或按设计跳过（未到时间窗、已成功过、目标月未走完、休市无变化） | 不用管 |
| `2` | **降级**：取数不完整 → 按铁律**不写入、不推送**任何本月至今数据，站点自动回退到「已定稿」口径 | 一般不用管（下个小时会自动重试）；连续多天为 2 才需要查网络 |
| 其它 | 真失败（脚本报错 / 自检不通过 / push 被拒） | 看日志尾部与本文第 5 节 |

---

## 4. 运行器内部做了什么（为什么可以放心无人值守）

| 机制 | 说明 |
|---|---|
| **幂等闸门** | 当天（MTD）/ 当月（定稿）成功过一次后，后续唤醒立即退出，绝不重复提交、重复部署 |
| **尝试次数上限** | MTD 每晚最多 3 次、定稿每天最多 1 次 —— 失败也不会刷屏，次日自动重试 |
| **自愈推送** | 每次运行前比对本地 HEAD 与远程 tip；若本地领先（上次 push 失败）就先补推，避免静默卡住 |
| **失败自动回滚** | 定稿失败时若留下未提交改动，自动 `git checkout -- .` 还原成「什么都没发生」——这是无人值守最危险的场景（半成品被下次运行继续加工） |
| **工作区保护** | 定稿前若工作区本来就不干净，则**跳过**本次定稿，绝不把人工改动裹进自动提交里 |
| **不造数据** | 所有数值都由既有脚本产出；运行器只决定「何时跑、跑了记什么」。铁律「月未走完不更新」由 `monthly_update.js` 自己把住（未走完 → exit 0） |
| **日志在仓库外** | 写在 `<工作区>\_hdszf_logs\`。仓库根目录是 Cloudflare Assets 的发布目录，日志放进去会被**公开上传**并污染 git |
| **改时间不改脚本** | 想调整执行时段，只改计划任务触发器即可，运行器自适应（`--force` 可临时忽略闸门） |

---

## 5. 故障处置

| 现象 | 原因 | 处置 |
|---|---|---|
| `status.js` 说「运行器从未执行」 | 计划任务没注册，或 task 被禁用 | 跑 `install.cmd`；`schtasks /change /tn hdszf-mtd /enable` |
| 连续几次 `exit=2` | 新浪接口取数失败/网络不通 | 手工 `node scripts/monthly_progress.js` 看具体哪个资产失败；恢复后下一次唤醒会自动补上 |
| `exit=1` 且日志出现「自检失败」「替换规则未命中」 | 展示层或静态文案与替换规则脱节（真问题，不会自动修） | 日志里有具体文件与规则；修好后当天/次日自动重跑即可 |
| 定稿后页面数字没变 | push 成功但 Cloudflare 还在部署，或 push 失败 | `node automation\win\status.js --online` 看线上版本号是否落后 |
| 远程 tip ≠ 本地 HEAD | push 被拒（远程有新提交） | 手工 `git pull --rebase` 后 `git push`；运行器的自愈推送下次会跟上 |
| 任务跑得很晚/没跑 | 电脑睡眠或关机 | 唤醒后同一时段内会自动补跑；整段错过则等下一次（MTD 次日 18:00、定稿次月 3 日） |
| 想立即看今天的数据 | — | `node automation\win\run_job.js mtd --force` |

---

## 6. 维护方法

### 6.1 Node 升级 / 换机器后

`run_job.js` 里有两处**需要跟着改**的绝对路径（都有注释标记）：

1. `automation/win/install.cmd`（以及 `status.cmd`）顶部的 `set "NODE=..."` —— 计划任务里存的就是这个路径；
   改完**重新运行 `install.cmd`** 覆盖注册。
2. `run_job.js` 里的 `EXTRA_PATH`（git / python 的目录）—— 计划任务的 PATH 很干净，脚本靠它找到 `git` 与 `python`。

改完用 `node automation\win\run_job.js mtd --no-status` 验证一次。

### 6.2 改执行时间

```bat
schtasks /change /tn "hdszf-mtd" /st 19:00 /et 23:00
```

或打开「任务计划程序」图形界面改触发器。**不需要改任何脚本**。

### 6.3 强制重跑 / 手工补跑

```
node automation\win\run_job.js finalize --force        # 忽略「本月已成功」闸门
node automation\win\run_job.js mtd --force             # 忽略「今天已成功」闸门
node automation\win\run_job.js mtd -- --no-fetch       # 「--」后的参数透传给子脚本（诊断用）
```

也可以完全绕过运行器直接跑原脚本（脚本本身就能独立完成全部工作）：

```
node scripts\monthly_progress.js --push
node scripts\monthly_update.js --strict
```

### 6.4 日志

- 位置：`C:\Users\23405\WorkBuddy\2026-08-20-17-46-50\_hdszf_logs\`
  （`mtd_YYYY-MM.log`、`finalize_YYYY-MM.log`、`status.json`）
- 按月分文件，体积极小；想清理直接删旧月份文件即可（`status.json` 别删，它记着闸门状态）。
- 迁移日志目录：设环境变量 `HDSZF_LOG_DIR` 即可（运行器与 status 都认）。
- ⚠️ **绝对不要把日志放进仓库**（会随 Assets 公开上传、还会被自动提交）。

### 6.5 卸载

```
automation\win\uninstall.cmd
```

（或 `schtasks /delete /tn "hdszf-mtd" /f` 与 `schtasks /delete /tn "hdszf-finalize" /f`）

### 6.6 与 WorkBuddy 自动化的关系

项目此前在 WorkBuddy 里配了两条自动化（每月 3 日 `monthly_update.js`、每周一 `monthly_progress.js --push`）。
那两条是**由 AI 会话驱动**的，依赖应用在运行、且消耗额度。

本方案上线后**建议停用那两条**，避免同一天两处同时 `git push` 相互撞车
（虽然两个脚本都幂等、撞车也不致命，但会造成重复部署）。

---

## 7. 已知取舍

| 取舍 | 说明 | 想改的话 |
|---|---|---|
| 电脑关机/睡眠期间不跑 | 计划任务依赖本机 | 改用 GitHub Actions（云端 cron）：需要新增 `.github/workflows/` 并用 `GITHUB_TOKEN` 推送；风险是境外 runner 取新浪数据的可用性，需先验证 |
| 每个交易日推送一次 = 每天一次 Cloudflare 部署 | 约每月 21 次部署 | 若在意部署次数，可把 MTD 任务改成每周一跑（`/sc WEEKLY /d MON`） |
| 需要本机有 Node + git + Python | 月度定稿取数用 Python | 已全部就绪，无需额外安装 |
| `automation/win/` 会随 Assets 一起公开 | 与现有 `scripts/` 目录情况一致，脚本内**不含任何密钥或 token** | 需要隐藏的话加 `.assetsignore`（改动部署行为，需先本地验证） |

---

## 8. 文件清单

| 文件 | 作用 |
|---|---|
| `run_job.js` | 运行器：闸门 + 日志 + 状态记录 + 自愈推送 + 失败回滚 |
| `status.js` | 健康检查（查看清单），只读 |
| `install.cmd` / `uninstall.cmd` | 注册 / 删除计划任务 |
| `status.cmd` | 双击即可看健康报告 |
| `README.md` | 本文档 |
