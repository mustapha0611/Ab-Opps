"""
Cross-Exchange Spot Arbitrage Scanner v4 (Multi-Exchange)
Scans all reachable exchanges: Bybit, MEXC, Gate.io, HTX, Bitstamp
Uses direct REST API calls for speed and reliability.
"""

import time
import sys
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ── Configuration ──────────────────────────────────────────────────────────────

PAIRS_TO_SCAN = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT",
    "ADA/USDT", "AVAX/USDT", "DOT/USDT", "LINK/USDT",
    "NEAR/USDT", "UNI/USDT", "ATOM/USDT", "LTC/USDT", "BCH/USDT",
    "APT/USDT", "ARB/USDT", "OP/USDT", "SUI/USDT",
    "TRX/USDT", "PEPE/USDT", "FET/USDT", "INJ/USDT",
    "SEI/USDT", "TIA/USDT", "RENDER/USDT", "STX/USDT",
    "BNB/USDT", "TON/USDT", "SHIB/USDT", "AAVE/USDT",
    "FIL/USDT", "WIF/USDT", "MATIC/USDT",
]

# Taker fees (worst-case, no VIP)
TAKER_FEES = {
    "bybit":    0.0010,   # 0.10%
    "mexc":     0.0010,   # 0.10% (actually 0% maker, 0.10% taker on some)
    "gateio":   0.0015,   # 0.15% (Gate default, can be lower with GT)
    "htx":      0.0020,   # 0.20% (HTX default, high)
    "bitstamp": 0.0050,   # 0.50% (Bitstamp retail tier -- high)
}

MIN_NET_PROFIT_PCT = 0.02
TIMEOUT = 15

# ── Exchange Fetchers ─────────────────────────────────────────────────────────

def fetch_bybit_tickers() -> dict[str, dict]:
    """Bybit spot tickers."""
    urls = [
        "https://api.bybit.com/v5/market/tickers?category=spot",
        "https://api.bytick.com/v5/market/tickers?category=spot",
    ]
    for url in urls:
        try:
            r = requests.get(url, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()
            if data.get("retCode") != 0:
                continue
            result = {}
            for item in data["result"]["list"]:
                symbol = item["symbol"]
                if symbol.endswith("USDT"):
                    base = symbol[:-4]
                    pair = f"{base}/USDT"
                    bid = float(item.get("bid1Price", 0) or 0)
                    ask = float(item.get("ask1Price", 0) or 0)
                    if bid > 0 and ask > 0:
                        result[pair] = {"bid": bid, "ask": ask}
            return result
        except Exception:
            continue
    return {}


def fetch_mexc_tickers() -> dict[str, dict]:
    """MEXC spot tickers."""
    url = "https://api.mexc.com/api/v3/ticker/bookTicker"
    try:
        r = requests.get(url, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        result = {}
        for item in data:
            symbol = item["symbol"]
            if symbol.endswith("USDT"):
                base = symbol[:-4]
                pair = f"{base}/USDT"
                bid = float(item.get("bidPrice", 0) or 0)
                ask = float(item.get("askPrice", 0) or 0)
                if bid > 0 and ask > 0:
                    result[pair] = {"bid": bid, "ask": ask}
        return result
    except Exception:
        return {}


def fetch_gateio_tickers() -> dict[str, dict]:
    """Gate.io spot tickers."""
    url = "https://api.gateio.ws/api/v4/spot/tickers"
    try:
        r = requests.get(url, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        result = {}
        for item in data:
            cp = item.get("currency_pair", "")  # e.g. "BTC_USDT"
            if cp.endswith("_USDT"):
                base = cp[:-5]
                pair = f"{base}/USDT"
                bid = float(item.get("highest_bid", 0) or 0)
                ask = float(item.get("lowest_ask", 0) or 0)
                if bid > 0 and ask > 0:
                    result[pair] = {"bid": bid, "ask": ask}
        return result
    except Exception:
        return {}


def fetch_htx_tickers() -> dict[str, dict]:
    """HTX (Huobi) spot tickers."""
    url = "https://api.huobi.pro/market/tickers"
    try:
        r = requests.get(url, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        result = {}
        for item in data.get("data", []):
            symbol = item.get("symbol", "")  # e.g. "btcusdt"
            if symbol.endswith("usdt"):
                base = symbol[:-4].upper()
                pair = f"{base}/USDT"
                bid = float(item.get("bid", 0) or 0)
                ask = float(item.get("ask", 0) or 0)
                # HTX uses "open/close/high/low" in tickers, bid/ask may be 0
                # If no bid/ask, skip
                if bid > 0 and ask > 0:
                    result[pair] = {"bid": bid, "ask": ask}
        return result
    except Exception:
        return {}


def fetch_bitstamp_tickers() -> dict[str, dict]:
    """Bitstamp tickers (limited pairs, but good for BTC/ETH)."""
    # Bitstamp doesn't have a bulk ticker endpoint easily, so we fetch specific pairs
    pairs_map = {
        "btcusdt": "BTC/USDT",
        "ethusdt": "ETH/USDT",
        "solusdt": "SOL/USDT",
        "xrpusdt": "XRP/USDT",
        "ltcusdt": "LTC/USDT",
        "linkusdt": "LINK/USDT",
        "uniusdt": "UNI/USDT",
        "avaxusdt": "AVAX/USDT",
        "dotusdt": "DOT/USDT",
        "adausdt": "ADA/USDT",
    }
    result = {}
    try:
        # Use the trading pairs info endpoint
        r = requests.get("https://www.bitstamp.net/api/v2/ticker/", timeout=TIMEOUT)
        if r.status_code != 200:
            # Fall back to individual fetches for key pairs
            for bs_pair, our_pair in list(pairs_map.items())[:5]:
                try:
                    r2 = requests.get(f"https://www.bitstamp.net/api/v2/ticker/{bs_pair}/", timeout=TIMEOUT)
                    if r2.status_code == 200:
                        d = r2.json()
                        bid = float(d.get("bid", 0) or 0)
                        ask = float(d.get("ask", 0) or 0)
                        if bid > 0 and ask > 0:
                            result[our_pair] = {"bid": bid, "ask": ask}
                except Exception:
                    continue
    except Exception:
        pass
    return result


EXCHANGE_FETCHERS = {
    "bybit":    fetch_bybit_tickers,
    "mexc":     fetch_mexc_tickers,
    "gateio":   fetch_gateio_tickers,
    "htx":      fetch_htx_tickers,
    "bitstamp": fetch_bitstamp_tickers,
}


@dataclass
class ArbOpportunity:
    pair: str
    buy_exchange: str
    sell_exchange: str
    buy_price: float
    sell_price: float
    gross_spread_pct: float
    net_spread_pct: float
    est_profit_per_1000: float
    timestamp: float = field(default_factory=time.time)


def run_scanner():
    scan_time = time.strftime('%Y-%m-%d %H:%M:%S')
    print("=" * 110)
    print("   CROSS-EXCHANGE SPOT ARBITRAGE SCANNER")
    print(f"   {scan_time}")
    print(f"   Scanning {len(PAIRS_TO_SCAN)} pairs across {len(EXCHANGE_FETCHERS)} exchanges")
    print(f"   Min net profit threshold: {MIN_NET_PROFIT_PCT}% (after taker fees on both sides)")
    print("=" * 110)

    # ── Fetch all tickers in parallel ─────────────────────────────────────
    print("\n   Fetching tickers from all exchanges...\n")
    exchange_data: dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=len(EXCHANGE_FETCHERS)) as executor:
        futures = {
            executor.submit(fetcher): name
            for name, fetcher in EXCHANGE_FETCHERS.items()
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                data = future.result()
                exchange_data[name] = data
                status = f"{len(data)} pairs" if data else "FAILED"
                icon = "[OK]" if data else "[XX]"
                print(f"   {icon} {name:<12} {status:<20} (fee: {TAKER_FEES[name]*100:.2f}%)")
            except Exception as e:
                exchange_data[name] = {}
                print(f"   [XX] {name:<12} ERROR: {e}")

    active = {k: v for k, v in exchange_data.items() if v}
    if len(active) < 2:
        print(f"\n   ERROR: Only {len(active)} exchange(s) responded.")
        return []

    print(f"\n   Active: {', '.join(sorted(active.keys()))} ({len(active)} exchanges)")

    # ── Build price table & find arbs ─────────────────────────────────────
    opportunities: list[ArbOpportunity] = []
    pair_price_table: dict[str, dict[str, dict]] = {}

    for pair in PAIRS_TO_SCAN:
        prices_for_pair = {}
        for ex_name, tickers in active.items():
            if pair in tickers:
                prices_for_pair[ex_name] = tickers[pair]
        if len(prices_for_pair) >= 2:
            pair_price_table[pair] = prices_for_pair
            ex_names = list(prices_for_pair.keys())
            for i in range(len(ex_names)):
                for j in range(len(ex_names)):
                    if i == j:
                        continue
                    buy_ex = ex_names[i]
                    sell_ex = ex_names[j]
                    buy_price = prices_for_pair[buy_ex]["ask"]
                    sell_price = prices_for_pair[sell_ex]["bid"]
                    if buy_price <= 0:
                        continue
                    gross = ((sell_price - buy_price) / buy_price) * 100
                    total_fee = (TAKER_FEES[buy_ex] + TAKER_FEES[sell_ex]) * 100
                    net = gross - total_fee
                    if net > MIN_NET_PROFIT_PCT:
                        opportunities.append(ArbOpportunity(
                            pair=pair, buy_exchange=buy_ex, sell_exchange=sell_ex,
                            buy_price=buy_price, sell_price=sell_price,
                            gross_spread_pct=gross, net_spread_pct=net,
                            est_profit_per_1000=1000.0 * (net / 100),
                        ))

    opportunities.sort(key=lambda x: x.net_spread_pct, reverse=True)

    # ── RESULTS ───────────────────────────────────────────────────────────
    print("\n" + "=" * 110)
    print("   ARBITRAGE OPPORTUNITIES" + (f" ({len(opportunities)} found)" if opportunities else " (none above threshold)"))
    print("=" * 110)

    if opportunities:
        print(f"\n   {'#':>3}  {'Signal':<6} {'Pair':<14} {'Buy On':<12} {'Ask Price':>16} {'Sell On':<12} {'Bid Price':>16} {'Gross':>8} {'Net':>8} {'$/1k':>8}")
        print("   " + "-" * 108)
        for idx, opp in enumerate(opportunities[:50], 1):
            if opp.net_spread_pct > 0.30:
                sig = "!!!"
            elif opp.net_spread_pct > 0.15:
                sig = " !!"
            elif opp.net_spread_pct > 0.08:
                sig = "  !"
            else:
                sig = "   "
            fee_info = f"({TAKER_FEES[opp.buy_exchange]*100:.1f}+{TAKER_FEES[opp.sell_exchange]*100:.1f})"
            print(
                f"   {idx:>3}  {sig:<6} {opp.pair:<14} {opp.buy_exchange:<12} "
                f"{opp.buy_price:>16.8f} {opp.sell_exchange:<12} "
                f"{opp.sell_price:>16.8f} {opp.gross_spread_pct:>+7.3f}% "
                f"{opp.net_spread_pct:>+7.3f}% ${opp.est_profit_per_1000:>6.2f}"
            )

        # Group by pair for clarity
        print("\n   --- GROUPED BY PAIR ---")
        pairs_with_opps = sorted(set(o.pair for o in opportunities))
        for pair in pairs_with_opps:
            pair_opps = [o for o in opportunities if o.pair == pair]
            best = pair_opps[0]
            print(f"\n   {pair}:")
            for o in pair_opps[:5]:
                print(f"     Buy {o.buy_exchange:<10} @ {o.buy_price:<16.8f} -> Sell {o.sell_exchange:<10} @ {o.sell_price:<16.8f} = net {o.net_spread_pct:+.4f}% (${o.est_profit_per_1000:.2f}/1k)")

    # ── Build all spreads for analysis ────────────────────────────────────
    all_spreads: list[tuple] = []
    for pair, prices in pair_price_table.items():
        ex_names = list(prices.keys())
        for i in range(len(ex_names)):
            for j in range(len(ex_names)):
                if i == j:
                    continue
                bp = prices[ex_names[i]]["ask"]
                sp = prices[ex_names[j]]["bid"]
                if bp > 0:
                    gross = ((sp - bp) / bp) * 100
                    fee = (TAKER_FEES[ex_names[i]] + TAKER_FEES[ex_names[j]]) * 100
                    net = gross - fee
                    all_spreads.append((pair, ex_names[i], ex_names[j], bp, sp, gross, net, fee))
    all_spreads.sort(key=lambda x: x[6], reverse=True)

    # Always show top spreads
    print("\n" + "=" * 110)
    label = "TOP OPPORTUNITIES" if opportunities else "CLOSEST NEAR-MISSES"
    print(f"   {label} (top 25)")
    print("=" * 110)
    print(f"   {'Pair':<14} {'Buy On':<12} {'Ask':>16} {'Sell On':<12} {'Bid':>16} {'Gross':>8} {'Fees':>6} {'Net':>8}")
    print("   " + "-" * 96)
    for s in all_spreads[:25]:
        pair, buy_ex, sell_ex, bp, sp, gross, net, fee = s
        marker = " <<<" if net > 0.02 else " <<" if net > 0 else ""
        print(f"   {pair:<14} {buy_ex:<12} {bp:>16.8f} {sell_ex:<12} {sp:>16.8f} {gross:>+7.3f}% {fee:>5.2f}% {net:>+7.3f}%{marker}")

    # ── Price comparison table ────────────────────────────────────────────
    print("\n" + "=" * 110)
    print("   PRICE COMPARISON TABLE (ask / bid)")
    print("=" * 110)
    ex_list = sorted(active.keys())
    col_w = 18
    header = f"   {'Pair':<14}" + "".join(f" {ex:>{col_w}}" for ex in ex_list) + " MaxSprd%"
    print(header)
    print("   " + "-" * (14 + (col_w + 1) * len(ex_list) + 10))

    for pair in PAIRS_TO_SCAN:
        if pair not in pair_price_table:
            continue
        prices = pair_price_table[pair]
        row = f"   {pair:<14}"
        all_asks = []
        all_bids = []
        for ex in ex_list:
            if ex in prices:
                a = prices[ex]["ask"]
                b = prices[ex]["bid"]
                row += f" {a:>{col_w}.8f}"
                all_asks.append(a)
                all_bids.append(b)
            else:
                row += f" {'---':>{col_w}}"
        # Max spread = (highest bid - lowest ask) / lowest ask -- the actual arb spread
        if len(all_asks) >= 2:
            # Cross-exchange spread: max bid vs min ask
            max_bid = max(all_bids)
            min_ask = min(all_asks)
            arb_spread = ((max_bid - min_ask) / min_ask) * 100
            row += f" {arb_spread:>+7.3f}%"
        print(row)

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 110)
    print("   SUMMARY")
    print("=" * 110)
    print(f"   Scan time:            {scan_time}")
    print(f"   Exchanges online:     {len(active)} / {len(EXCHANGE_FETCHERS)} ({', '.join(sorted(active.keys()))})")
    print(f"   Pairs with 2+ exch:   {len(pair_price_table)} / {len(PAIRS_TO_SCAN)}")
    print(f"   Opportunities found:  {len(opportunities)} (net > {MIN_NET_PROFIT_PCT}%)")
    
    if opportunities:
        best = opportunities[0]
        print(f"\n   BEST OPPORTUNITY:")
        print(f"   {best.pair}: Buy on {best.buy_exchange} @ {best.buy_price:.8f} -> Sell on {best.sell_exchange} @ {best.sell_price:.8f}")
        print(f"   Gross: {best.gross_spread_pct:+.4f}%, Net: {best.net_spread_pct:+.4f}%, Est profit: ${best.est_profit_per_1000:.2f} per $1,000")
        total_profit = sum(o.est_profit_per_1000 for o in opportunities)
        print(f"\n   Total potential (all opps, $1k each): ${total_profit:.2f}")
    elif all_spreads:
        best = all_spreads[0]
        print(f"\n   Closest to profitable: {best[0]}: {best[1]} -> {best[2]} (net: {best[6]:+.4f}%)")
        deficit = abs(best[6]) if best[6] < 0 else 0
        if deficit > 0:
            print(f"   Gap to profitability: {deficit:.4f}% -- need tighter spreads or lower fees (e.g., maker orders, VIP tiers)")

    print(f"\n   Fee assumptions used:")
    for ex, fee in sorted(TAKER_FEES.items()):
        status = "ONLINE" if ex in active else "offline"
        print(f"     {ex:<12} {fee*100:.2f}% taker  [{status}]")

    print(f"\n   IMPORTANT:")
    print(f"   * Spreads are SNAPSHOTS -- they close in milliseconds")
    print(f"   * Net % does NOT include withdrawal fees ($1-5 USDT) or slippage")
    print(f"   * Always check orderbook DEPTH before sizing orders")
    print(f"   * Pre-fund all exchanges for inventory-based arb (no transfer delay)")
    print(f"   * Use maker orders where possible to reduce fees significantly")
    print(f"   * Past spreads do NOT guarantee future profitability")
    print("=" * 110)

    return opportunities


if __name__ == "__main__":
    opps = run_scanner()
