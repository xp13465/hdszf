#!/usr/bin/env python3
"""拉日K线落盘到 scripts/_daily_cache.json，供 rebalance_study 用。

新浪 K 线 scale=240 (日), datalen 单次上限~3000，覆盖约 12 年，足够项目 11 年需求。
输出 JSON 格式：{资产: [{day, open, high, low, close, volume}, ...]}，按日期升序。
"""
import json, urllib.request, os, time

ROOT = r"C:/Users/23405/WorkBuddy/2026-08-20-17-46-50/hdszf"
FM = json.load(open(os.path.join(ROOT, "scripts/fund_map.json"), encoding="utf-8"))
ASSETS = FM["assets"]

UA = {"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn"}


def fetch_daily(sina_sym, datalen=3000, retries=3):
    url = ("https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
           "CN_MarketData.getKLineData?symbol=%s&scale=240&ma=no&datalen=%d&adj=qfq"
           % (sina_sym, datalen))
    last_err = None
    for _ in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            last_err = e
            time.sleep(1)
    raise last_err


cache = {}
for asset, cfg in ASSETS.items():
    # 优先用 backup（老 ETF 代码）拿全期数据；失败回退到 primary
    candidates = (cfg.get("backup") or []) + [cfg["primary"]]
    data = None
    last_err = None
    for sym in candidates:
        # sina 代码转 sh/sz 前缀
        if not sym.startswith(("sh", "sz")):
            sym = "sh" + sym
        try:
            data = fetch_daily(sym)
            if data and len(data) >= 2000:
                print("OK", asset, "via", sym, "len=", len(data),
                      "first=", data[0].get("day"),
                      "last=", data[-1].get("day"))
                break
            last_err = "too few rows from " + sym
            data = None
        except Exception as e:
            last_err = repr(e)
            data = None
    if data is None:
        print("ERR", asset, "all candidates failed:", last_err)
        data = []
    cache[asset] = data

out_p = os.path.join(ROOT, "scripts/_daily_cache.json")
with open(out_p, "w", encoding="utf-8") as f:
    json.dump(cache, f, ensure_ascii=False)
print("SAVED", out_p)