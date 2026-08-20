#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
恒市值助手 - 月收益取数脚本（已校验版）

数据源：新浪财经前复权日K线  money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData
口径：  月末最后一个交易日收盘价 / 上月末收盘价 - 1 = 当月收益（前复权）
标签偏移：项目 month 标签比真实日历早 1 个月。
         => 日历 YM 的真实月收益，应写入项目标签 (YM - 1)。
         => 例：日历2026-07(7月)收益 写入 项目标签 2026-06。

用法：
  python fetch_returns.py --dry-run            # 只打印各资产最新若干月收益，不写文件
  python fetch_returns.py --target 2026-07     # 计算日历2026-07(7月)收益，打印对应项目标签与值
  python fetch_returns.py --target 2026-07 --write   # 真正写回 js/data.js 与 js/real_returns.json（先备份.bak）

注意：本脚本只负责“取数+对齐”，不重算 finalConfig/goldSweep/trendData/三档方案等派生字段，
      那些写死在 data.js 的汇总数字需另行重跑回测引擎回填（见 RELEASE_CHECKLIST.md）。
"""
import json, os, sys, urllib.request, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FM = json.load(open(os.path.join(ROOT, "scripts/fund_map.json"), encoding="utf-8"))
ASSETS = FM["assets"]


def fetch_daily(sina_sym):
    url = ("https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
           "CN_MarketData.getKLineData?symbol=%s&scale=240&ma=no&datalen=900&adj=qfq" % sina_sym)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0",
                                                "Referer": "https://finance.sina.com.cn"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def monthly_returns(daily):
    ends = {}
    for k in daily:
        d = k["day"]; c = float(k["close"]); ym = d[:7]
        if ym not in ends or d > ends[ym][0]:
            ends[ym] = (d, c)
    syms = sorted(ends)
    out = {}
    for i, ym in enumerate(syms[1:], 1):
        out[ym] = ends[ym][1] / ends[syms[i - 1]][1] - 1
    return out


def prev_label(ym):
    y, m = map(int, ym.split("-")); m -= 1
    if m == 0:
        m = 12; y -= 1
    return "%04d-%02d" % (y, m)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", help="目标日历月 YYYY-MM（计算该月真实收益）")
    ap.add_argument("--dry-run", action="store_true", help="只打印最近若干月，不写文件")
    ap.add_argument("--write", action="store_true", help="写回 data.js / real_returns.json")
    args = ap.parse_args()

    data = {}
    for asset, cfg in ASSETS.items():
        try:
            ret = monthly_returns(fetch_daily(cfg["sina"]))
            data[asset] = ret
        except Exception as e:
            print("ERR %s: %r" % (asset, e)); data[asset] = {}

    if args.target:
        t = args.target
        lab = prev_label(t)   # 项目标签 = 日历-1
        print("\n目标日历月 %s -> 项目标签 %s" % (t, lab))
        for asset, ret in data.items():
            v = ret.get(t)
            print("  %s: %s" % (asset, ("%+.4f%%" % (v * 100)) if v is not None else "NA"))
        if args.write:
            print("[write 模式] 此处应在备份后替换 data.js / real_returns.json 中标签 %s 的占位值" % lab)
            print("          并同步修正 rolling.js endMonth、main.js actualEndDate、派生指标。未自动执行。")
        return

    # dry-run：打印各资产最近 6 个日历月
    print("各资产最近日历月收益（前复权）：")
    for asset, ret in data.items():
        recent = sorted(ret)[-6:]
        s = ", ".join("%s=%+.2f%%" % (m, ret[m] * 100) for m in recent)
        print("  %s: %s" % (asset, s))


if __name__ == "__main__":
    main()
