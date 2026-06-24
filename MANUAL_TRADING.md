# ARBHUNT — Manual Trading Improvements

Enhance the scanner for **manual trading**: better visibility into real opportunities, quick exchange links, trade journal, and alerts.

---

## Enhancement 1 — Auto-Analyze All Opportunities (Batch)

**Problem:** Each opportunity must be clicked and analyzed one-by-one to see orderbook depth and real profitability. With 50+ opportunities, this is too slow.

**Solution:** Backend endpoint that batch-analyzes the top N opportunities in parallel.

### Backend

**New endpoint:** `GET /api/batch-analyze?limit=20`

- Takes the current scan results
- For the top `limit` opportunities by spread, fetches orderbooks in parallel
- Runs the existing `runAnalysis()` for each
- Returns GO/NO-GO decision, net profit, and slippage per opportunity

**Response format:**

```json
{
  "results": [
    {
      "key": "BTC-binance-bybit",
      "decision": "GO",
      "netProfitUsd": 3.87,
      "netProfitPct": 3.12,
      "slippageBuyPct": 0.08,
      "slippageSellPct": 0.15,
      "liquidity": { "sufficient": true, "buyLiquidityUsd": 52000, "sellLiquidityUsd": 48000 }
    }
  ],
  "timestamp": 1719000000000
}
```

### Frontend

- After the regular scan completes, auto-call `/api/batch-analyze`
- Merge results into the opportunity display
- Update cards with GO/NO-GO state

---

## Enhancement 2 — Color-Coded Opportunity Cards

**Problem:** No at-a-glance understanding of which opportunities are worth acting on.

**Solution:** Cards color-coded by analysis state with key metrics shown directly.

```
┌──────────────────────────────────────────────────────┐
│  🟢 BTC/USDT   Spread: 5.2%                        │
│  Buy: Binance $65,000  →  Sell: Bybit $68,380      │
│  Net: $3.87 │ Slippage: 0.12% │ Liq: ✅            │
│                                                     │
│  [Buy on Binance]  [Sell on Bybit]  [Log Trade]    │
└──────────────────────────────────────────────────────┘
```

### Color Legend

| Color | Meaning |
|-------|---------|
| 🟢 Green card | Analysis = GO. Profitable after fees + slippage |
| 🟡 Yellow card | Unanalyzed (no batch or individual analysis yet) |
| 🔴 Red card | Analysis = NO-GO. Fees/slippage exceed spread or insufficient liquidity |

### Card Content (always visible, no click needed)

| Field | Source |
|-------|--------|
| Spread % | From scan (already shown) |
| Net Profit $ | From batch analysis |
| Slippage % (buy + sell) | From batch analysis |
| Liquidity check | From batch analysis |
| Fees (buy + sell + withdrawal) | From batch analysis |

---

## Enhancement 3 — Quick Trade Links

**Problem:** Acting on an opportunity requires manually navigating to the right exchange page. Seconds matter during arbitrage.

**Solution:** One-click buttons that open the exchange trading page in a new browser tab.

### URL Patterns

| Exchange | URL |
|----------|-----|
| Binance | `https://www.binance.com/en/trade/{SYMBOL}_USDT` |
| Bybit | `https://www.bybit.com/en/trade/spot/{SYMBOL}/USDT` |
| KuCoin | `https://www.kucoin.com/trade/{SYMBOL}-USDT` |
| MEXC | `https://www.mexc.com/exchange/{SYMBOL}_USDT` |
| Bitget | `https://www.bitget.com/spot/{SYMBOL}USDT` |
| Coinbase | `https://exchange.coinbase.com/trade/{SYMBOL}-USD` |
| Gate.io | `https://www.gate.io/trade/{SYMBOL}_USDT` |

### Behavior

- Two buttons per card: **"Buy on [Exchange]"** and **"Sell on [Exchange]"**
- Each opens the corresponding URL in a new tab (`target="_blank"`)
- The symbol is substituted into the URL template

---

## Enhancement 4 — Trade Journal

**Problem:** Without tracking your manual trades, you can't know if you're actually profitable or just guessing.

**Solution:** In-app trade journal with localStorage persistence (no backend changes needed).

### Trade Form (Pre-populated)

When you click **"Log Trade"** on an opportunity card:

| Field | Pre-filled | Editable? |
|-------|-----------|-----------|
| Symbol | Yes | Yes |
| Buy Exchange | Yes | Yes |
| Sell Exchange | Yes | Yes |
| Target Buy Price | Yes (scanner price) | Yes |
| Target Sell Price | Yes (scanner price) | Yes |
| Spread % | Yes (auto-calculated) | No |
| Investment ($) | 100 | Yes |
| Actual Buy Price | Empty | Yes |
| Actual Sell Price | Empty | Yes |
| Withdrawal Fee ($) | 1.00 | Yes |
| Notes | Empty | Yes |

### Trade Status Workflow

```
Log Trade (Pending)
    │
    ├──▶ Execute buy manually
    │       │
    │       ├──▶ Edit: fill in Actual Buy Price
    │       │       Status → Open
    │       │
    │       ├──▶ Execute sell manually
    │       │       │
    │       │       ├──▶ Edit: fill in Actual Sell Price
    │       │       │       Status → Completed (P&L calculated)
    │       │       │
    │       │       └──▶ If trade fails or aborts
    │       │               Status → Failed (mark reason)
    │       │
    │       └──▶ ... sell limit still open
    │               Status stays Open
    │
    └──▶ Cancel
            Status → Cancelled
```

### Trade History View

New route: **`/journal`**

| Column | Content |
|--------|---------|
| Date | When trade was logged |
| Symbol | e.g. BTC/USDT |
| Buy → Sell | Binance → Bybit |
| Investment | $100 |
| P&L ($) | `(sellPrice - buyPrice) * qty - fees` |
| ROI % | `(P&L / investment) * 100` |
| Status | Pending / Open / Completed / Failed |

- Sortable by date or P&L
- Color-coded rows (green profit, red loss)
- Click row to edit

### Summary Stats

Cards at top of journal page:

| Stat | Calculation |
|------|------------|
| Total Trades | Count of all completed trades |
| Wins | Count where P&L > 0 |
| Losses | Count where P&L < 0 |
| Win Rate | `wins / total * 100` |
| Net P&L | Sum of all P&L |
| Best Trade | Max P&L |
| Worst Trade | Min P&L |
| Avg ROI | Average ROI % across all trades |

### Storage

- `localStorage` key: `arbhunt-trades`
- No backend changes needed
- Data persists across browser sessions

---

## Enhancement 5 — Desktop Notifications

**Problem:** You can't watch the dashboard all day. Good opportunities appear and disappear while you're away.

**Solution:** Browser desktop notifications when a high-confidence opportunity appears.

### Trigger Conditions

- Spread > configurable threshold (default: 3%)
- Analysis = GO (liquidity sufficient, net profit positive)
- Same opportunity not already notified in the last 5 minutes (dedup)

### Behavior

- Uses the [Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notification)
- Requests permission on first scan
- Notification content:

```
ARBHUNT: BTC/USDT — 5.2% spread
Buy: Binance $65,000 → Sell: Bybit $68,380
Net profit: $3.87
```

- Clicking the notification brings the dashboard tab to focus
- Audio chime (optional, toggleable)

### Configuration

Toggle in dashboard header:
```
[🔔 Alerts: ON ]  Min spread: [3% ▼]
```

---

## Implementation Order

| Step | What | Files | Complexity |
|------|------|-------|------------|
| 1 | `GET /api/batch-analyze` endpoint | `Backend/src/index.ts` | Medium |
| 2 | Auto-call batch + color-coded cards | `Frontend/src/stores/arbStore.ts`, `Frontend/src/views/arb.vue` | Medium |
| 3 | Quick trade links (buy/sell buttons) | `Frontend/src/views/arb.vue` | Small |
| 4 | Trade journal store (localStorage) | `Frontend/src/stores/tradeStore.ts` | Medium |
| 5 | Trade form + history views | `Frontend/src/views/TradeJournal.vue`, `Frontend/src/views/TradeForm.vue` | Medium |
| 6 | Desktop notifications | `Frontend/src/views/arb.vue` | Small |

---

## File Summary

### New Files

| File | Est. Lines | Purpose |
|------|-----------|---------|
| `Frontend/src/stores/tradeStore.ts` | 80 | Pinia store for trade journal (localStorage) |
| `Frontend/src/views/TradeJournal.vue` | 200 | Trade history table + summary stats |
| `Frontend/src/views/TradeForm.vue` | 150 | Pre-populated trade logging form |

### Modified Files

| File | Change |
|------|--------|
| `Backend/src/index.ts` | Add `GET /api/batch-analyze` route |
| `Frontend/src/stores/arbStore.ts` | Add batch analysis state, auto-fetch after scan |
| `Frontend/src/views/arb.vue` | Color-coded cards, quick trade buttons, desktop notifications, batch analysis display |
| `Frontend/src/router/index.ts` | Add `/journal` route |
| `Frontend/src/types/crypto.ts` | Add `BatchAnalysisResult`, `TradeRecord`, `TradeStatus` types |

**Total: ~430 new lines, ~150 modified lines**

---

## What These Changes Enable

1. Open dashboard → **immediately see** which opportunities are real (🟢 green cards)
2. Click **"Buy on Binance"** → exchange opens at the right trading page
3. Execute your buy manually
4. Switch tab → click **"Sell on Bybit"** → exchange opens at the right page
5. Execute your sell (market or limit)
6. Click **"Log Trade"** → form pre-filled with the opportunity data
7. Fill in actual prices → track your real P&L over time
8. Get **desktop notifications** when good opportunities appear while multitasking
