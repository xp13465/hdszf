#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
恒市值助手 - 月收益取数脚本（已校验版）

数据源：新浪财经前复权日K线  money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData
口径：  月末最后一个交易日收盘价 / 上月末收盘价 - 1 = 当月收益（前复权）
标签偏移：项目 month 标签 = 真实日历月（无偏移）。已用源数据核验（2026-09-02 复核）：
         日历2026-08(8月)的真实收益 = data.js 末位标签 2026-08 的值，故标签直接等于日历月。
         => 日历 YM 的真实月收益，写入项目标签 YM 本身。
         => 例：日历2026-08(8月)收益 写入 项目标签 2026-08。
         ⚠️ 旧版曾写「标签 = 日历 − 1 个月」，已证伪；prev_label() 已改为恒等映射，勿改回。

用法：
  python fetch_returns.py --dry-run            # 只打印各资产最新若干月收益，不写文件
  python fetch_returns.py --target 2026-09     # 计算日历2026-09(9月)收益，打印对应项目标签与值
  python fetch_returns.py --target 2026-09 --write   # 真正写回 js/data.js 与 js/real_returns.json（先备份.bak）

约束：只填已结束的完整日历月。当前已填至日历 2026-08，下一次应填 2026-09（需在 10 月初之后运行）。

注意：本脚本只负责“取数+对齐”，不重算 finalConfig/goldSweep/trendData 等写死在 data.js 的派生字段，
      需另行重跑回测引擎回填（见 RELEASE_CHECKLIST.md）。
      三档方案对比卡片已在前端动态计算（main.js initComparisonCards -> simulateCMV），无需手工回填页面展示。
"""
import json, os, sys, re, shutil, urllib.request, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FM = json.load(open(os.path.join(ROOT, "scripts/fund_map.json"), encoding="utf-8"))
ASSETS = FM["assets"]
ASSETS_ORDER = list(ASSETS.keys())  # 用于自检时取第一个资产的条数


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
    # 保留兼容：本项目标签=日历月（无偏移），故直接返回原值。
    # 旧版曾错误地返回 ym-1，会导致把当月收益误写进上月标签、覆盖真实值。
    return ym


def find_array_end(lines, start_idx):
    """
    给定数组起始行下标（含 '[' 的那一行），返回闭合行下标 j（该行 stripped 后以 ']' 开头）。
    只做括号计数，不依赖缩进，避免不同区块缩进不一致导致定位失败。
    """
    depth = 0
    for i in range(start_idx, len(lines)):
        s = lines[i]
        depth += s.count("[") - s.count("]")
        if depth == 0 and "[" in "".join(lines[start_idx:i + 1]):
            return i
    raise ValueError("找不到数组闭合行")


def append_to_js_array(path, header_regex, newline, indent):
    """
    在 JS 文件里定位 header_regex 命中的数组，往末尾追加一行。
    返回 True 表示成功。会自动给原最后一行补逗号。
    """
    raw = open(path, encoding="utf-8").read()
    lines = raw.splitlines(keepends=True)
    rx = re.compile(header_regex)
    start = None
    for i, ln in enumerate(lines):
        if rx.search(ln) and "[" in ln:
            start = i
            break
    if start is None:
        print("  ✗ [%s] 未找到数组头 %s" % (path, header_regex))
        return False
    end = find_array_end(lines, start)
    last = end - 1
    if last <= start:
        print("  ✗ [%s] 数组为空" % path)
        return False
    eol = "\r\n" if lines[last].endswith("\r\n") else "\n"
    body = lines[last].rstrip("\r\n").rstrip()
    if not body.endswith(","):
        body += ","
    lines[last] = body + eol
    lines.insert(end, indent + newline + eol)
    open(path, "w", encoding="utf-8", newline="").write("".join(lines))
    return True


def do_write(t, lab, data):
    """
    把日历月 t 的真实收益写入双数据源（标签 = 日历月，无偏移）。
    写入前自动备份 .bak。
    """
    djs = os.path.join(ROOT, "js", "data.js")
    rjs = os.path.join(ROOT, "js", "real_returns.json")

    # 1) 收集五资产收益，任一缺失即中止
    vals = {}
    for asset in ASSETS:
        v = data.get(asset, {}).get(t)
        if v is None:
            print("  ✗ %s 在 %s 无数据，中止写入" % (asset, t))
            return False
        vals[asset] = v
        print("     %-10s %+.6f" % (asset, v))

    for p in (djs, rjs):
        shutil.copyfile(p, p + ".bak")
    print("  已备份 js/data.js.bak / js/real_returns.json.bak")

    # 2) data.js：months 数组追加标签
    if not append_to_js_array(djs, r'"months":\s*\[', '"%s"' % lab, "      "):
        return False
    print("  ✓ data.js months 追加标签 %s" % lab)

    # 3) data.js：每个资产收益数组追加数值（保留完整精度，不加 + 号）
    for asset in ASSETS:
        rx = r'"%s":\s*\[' % re.escape(asset)
        if not append_to_js_array(djs, rx, repr(vals[asset]), "        "):
            return False
    print("  ✓ data.js asset_returns 追加 %d 个资产" % len(ASSETS))

    # 4) data.js：月数计数 +1
    #    ⚠️ data.js 里月数字段有两个名字：realReturns.month_count 与 meta.n_months，
    #        只改一个会导致「引擎读 month_count、文档写 n_months」的自相矛盾。
    src = open(djs, encoding="utf-8").read()
    total = 0
    for field in ("month_count", "n_months"):
        src, cnt = re.subn(r'("%s":\s*)(\d+)' % field,
                           lambda m: m.group(1) + str(int(m.group(2)) + 1), src)
        total += cnt
        if cnt:
            print("  ✓ data.js %s +1（%d 处）" % (field, cnt))
    open(djs, "w", encoding="utf-8", newline="").write(src)
    if total == 0:
        print("  ⚠ data.js 未找到 month_count / n_months 字段")

    # 5) real_returns.json：结构化追加
    j = json.load(open(rjs, encoding="utf-8"))
    if j["months"] and j["months"][-1] == lab:
        print("  ✗ json 中已存在标签 %s，可能重复写入，中止" % lab)
        return False
    j["months"].append(lab)
    for asset in ASSETS:
        j["asset_returns"][asset].append(vals[asset])
    j["month_count"] = len(j["asset_returns"][ASSETS_ORDER[0]])
    json.dump(j, open(rjs, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("  ✓ real_returns.json 追加标签 %s，month_count = %d" % (lab, j["month_count"]))

    # 6) 自检：data.js 两个计数字段 + json 三者必须一致，且标签数 = 收益数 + 1
    def getf(name):
        mm = re.search(r'"%s":\s*(\d+)' % name, open(djs, encoding="utf-8").read())
        return int(mm.group(1)) if mm else None

    src2 = open(djs, encoding="utf-8").read()
    n_json = j["month_count"]
    n_mc = getf("month_count")
    n_nm = getf("n_months")
    n_returns = len(j["asset_returns"][ASSETS_ORDER[0]])
    n_labels = len(re.findall(r'"\d{4}-\d{2}"', src2))
    print("  自检：json month_count=%s / data.js month_count=%s / n_months=%s / 标签数=%d"
          % (n_json, n_mc, n_nm, n_labels))

    bad = []
    if n_mc != n_json:
        bad.append("data.js month_count(%s) ≠ json month_count(%s)" % (n_mc, n_json))
    if n_nm is not None and n_nm != n_json:
        bad.append("data.js n_months(%s) ≠ json month_count(%s)" % (n_nm, n_json))
    if n_labels != n_returns + 1:
        bad.append("标签数(%d) ≠ 收益数+1(%d)" % (n_labels, n_returns + 1))
    if bad:
        for b in bad:
            print("  ✗ " + b)
        print("  ✗ 自检未通过，请检查（.bak 备份已保留）")
        return False
    print("  ✓ 自检通过：月数一致，标签数 = 收益数 + 1")
    return True


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
        lab = prev_label(t)   # 项目标签 = 日历月（无偏移）
        print("\n目标日历月 %s -> 项目标签 %s" % (t, lab))
        for asset, ret in data.items():
            v = ret.get(t)
            print("  %s: %s" % (asset, ("%+.4f%%" % (v * 100)) if v is not None else "NA"))
        if args.write:
            print("\n[write 模式] 写入双数据源：")
            ok = do_write(t, lab, data)
            if not ok:
                print("[write 模式] 失败，未提交改动")
                sys.exit(1)
            print("[write 模式] 完成。下一步：node scripts/recompute_derived.js 重算派生字段")
        return

    # dry-run：打印各资产最近 6 个日历月
    print("各资产最近日历月收益（前复权）：")
    for asset, ret in data.items():
        recent = sorted(ret)[-6:]
        s = ", ".join("%s=%+.2f%%" % (m, ret[m] * 100) for m in recent)
        print("  %s: %s" % (asset, s))


if __name__ == "__main__":
    main()
