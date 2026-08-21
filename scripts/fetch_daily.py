#!/usr/bin/env python3
"""拉日K线落盘到 scripts/_daily_cache.json，供 rebalance_study 用。"""
import json, urllib.request, os

ROOT = r"C:/Users/23405/WorkBuddy/2026-08-20-17-46-50/hdszf"
FM = json.load(open(os.path.join(ROOT, "scripts/fund_map.json"), encoding="utf-8"))
ASSETS = FM["assets"]

def fetch_daily(sina_sym):
    url = ("https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
           "CN_MarketData.getKLineData?symbol=%s&scale=240&ma=no&datalen=900&adj=qfq" % sina_sym)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0",
                                                "Referer": "https://finance.sina.com.cn"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)

cache = {}
for asset, cfg in ASSETS.items():
    try:
        cache[asset] = fetch_daily(cfg["sina"])
        print("OK", asset, "len=", len(cache[asset]))
    except Exception as e:
        print("ERR", asset, repr(e))
        cache[asset] = []
out_p = os.path.join(ROOT, "scripts/_daily_cache.json")
with open(out_p, "w", encoding="utf-8") as f:
    json.dump(cache, f, ensure_ascii=False)
print("SAVED", out_p)
