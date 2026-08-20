# 滚动回测月度更新 · 发布检查清单（RELEASE CHECKLIST）

本清单用于「把最后完整月之后的新月份补进回测并上线」。当前缺口：数据窗口停在 `2026-07`（131 个月），
站点「最后更新」戳为 2026年7月10日。

> 关键事实：滚动回测汇总由前端 `RollingBacktest.runAll()` 实时计算，没有写死的汇总表；
> 但 `finalConfig / goldSweep / trendData / 三档方案对比` 这些派生结果是**预先算好写死在 `js/data.js`** 的，
> 必须随数据窗口延伸而重算，否则展示会自相矛盾。

---

## 阶段 0 · 前置（9/1 前完成）

- [ ] 确认 `scripts/fund_map.json` 的基金代码与实际回测口径一致（原数据用 35,784 条基金净值，
      仓库未记录具体基金，此为待校验项）。脚本默认值是常见 ETF 猜测，必须核对。
- [ ] 确认月收益率口径：原数据用的是「自然月首个净值 / 末个净值」还是「复权净值」或其他，
      保证 `fetch_returns.py` 计算结果与原序列口径一致。
- [ ] 确保目标月已完全结束（如补 `2026-08`，需在 8/31 之后运行）。

## 阶段 1 · 取数（脚本自动）

- [ ] `cd hdszf && python scripts/fetch_returns.py 2026-08`
- [ ] 核对输出 5 个资产的月收益率是否合理（无异常 ±50% 之类的脏值）
- [ ] 检查 `js/data.js` 与 `js/real_returns.json`：
  - [ ] `months` 末追加 `"2026-08"`
  - [ ] 5 个资产数组各追加 1 个值
  - [ ] `month_count` 131 → 132
  - [ ] `data_range` / `n_months` 已更新
- [ ] 保留 `.bak` 备份，确认无误后可删

## 阶段 2 · 引擎与展示边界（手动改代码）

- [ ] `js/rolling.js`：`CONFIG.endMonth` 7 → 8；注释中 `131个月/2025-07` → `132个月/2025-08`
- [ ] `js/main.js`：`actualEndDate` `'2026-07'` → `'2026-08'`

## 阶段 3 · 派生指标重算（核心，手动/node）

> 这些数字现在写在 `js/data.js`，多一个月后所有年化/回撤/Sharpe/Sortino/终值会轻微漂移。
> 需本地重跑回测引擎（浏览器或 node 加载 `js/*.js` 后调用对应入口）得到新值，再回填：

- [ ] `finalConfig.backtest`（年化/总收益/最大回撤/Sharpe/Sortino/终值/月胜率/月度波动/回撤持续）
- [ ] `goldSweep` 全部 15 组（gold_pct 0~26）的 best_annual/best_dd/best_sharpe
- [ ] `trendData` 全部条目（约 30+ 行）的 annual/dd/sharpe/sortino/final/total
- [ ] 三档方案对比（稳健/均衡/进取）的回测数字（README 表 + 页面展示）
- [ ] 滚动汇总表：前端会新增一行起点 `2025-08`（1 年前入场），所有窗口长度 +1 个月，需目测渲染正确

## 阶段 4 · 文案与「最后更新」戳（多文件同步）

- [ ] `index.html`：L395 / L612 / L747（131个月→132个月；2026年7月→8月）；L814 / L862 更新日期戳
- [ ] `README.md`：数据缺口说明、回测表数字、数据范围指向新月份
- [ ] `CODEBUDDY.md`：日期、数据缺口、数组长度注释
- [ ] `PROJECT_SPEC.md`：日期与数据范围
- [ ] `wrangler.jsonc`：`compatibility_date`、sitemap.xml `lastmod` → 今天

## 阶段 5 · 验证与上线

- [ ] 本地 `python -m http.server` 或 `wrangler dev` 起服务，肉眼核对：
  - [ ] 滚动汇总表新增 `2025-08` 起点行且无 NaN/∞/负终值
  - [ ] 三档方案数字与 `data.js` 一致
  - [ ] 主题切换（三套）数字同步
- [ ] `git add -A && git commit -m "data: 滚动回测更新至 2026-08"`
- [ ] `git push origin main`（SSH，本仓库既定传输方式）→ 触发 Cloudflare 自动部署
- [ ] 受毛子云 CDN 最长 20 分钟缓存影响，公开页面约数分钟后刷新；部署后访问 `h.sugas.site` 复核

---

## 风险与边界

- 不要凭空造目标月收益：月未结束或无法取数时，宁可不更新，也不要用历史均值填（会污染结论并需全表标⚠️）。
- 双数据源（`data.js` + `real_returns.json`）必须同步改，漏改其一会导致前端与原始数据不一致。
- 派生指标若重算不全，页面会出现「汇总表是新的、方案数字是旧的」矛盾，上线前务必阶段 3 全量重算。
