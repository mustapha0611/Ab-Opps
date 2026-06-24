# ARBHUNT — Automated Execution Plan

Turn the scanner into a semi-automated cross-exchange arbitrage execution bot.
Manual-trigger, hold-until-sold approach.

---

## Architecture

```
┌──────────────┐     Manual trigger     ┌──────────────────────┐     CCXT     ┌──────────────┐
│   Scanner    │ ───────────────────────▶│  Execution Pipeline  │ ───────────▶│ Exchange A   │
│  (existing)  │     (user clicks)      │                      │             │ (market buy) │
│              │                        │ 1. Validate depth    │             └──────┬───────┘
│  Price fetch │                        │ 2. Market buy $100   │                    │
│  Spread      │                        │ 3. Withdraw TRC-20   │                    │ withdrawal
│  Detection   │                        │ 4. Wait for arrival  │                    │
└──────────────┘                        │ 5. Place limit sell  │                    ▼
                                        │ 6. Record & report   │            ┌──────────────┐
                                        └──────────────────────┘            │ Exchange B   │
                                              │                            │ (limit sell) │
                                              ▼                            └──────────────┘
                                       ┌──────────────┐
                                       │  SQLite DB   │
                                       │ (trade log)  │
                                       └──────────────┘
```

---

## New Dependencies

| Package | Purpose |
|---------|---------|
| `ccxt` | Universal exchange API (Binance, Bybit, KuCoin, MEXC, Bitget, Coinbase, Gate) |
| `better-sqlite3` | Persistent trade database |

---

## Phase 1 — Exchange Trading Layer

**Goal:** Connect to exchange APIs with CCXT for order placement, withdrawals, and balance checks.

### 1.1 Exchange Setup — `Backend/src/exchange/setup.ts`

- Load API keys from `.env`
- Initialize CCXT instances per exchange
- Enable sandbox/testnet mode via env var if needed
- Expose a `getExchange(name)` factory function

### 1.2 Trading Functions — `Backend/src/exchange/trading.ts`

| Function | Description |
|----------|-------------|
| `marketBuy(exchange, symbol, usdAmount)` | Place market buy order, return fill price + quantity |
| `limitSell(exchange, symbol, qty, price)` | Place limit sell order, return order ID |
| `cancelOrder(exchange, symbol, orderId)` | Cancel an open order |
| `withdraw(exchange, symbol, qty, toAddress)` | Withdraw USDT to external address |
| `getDepositAddress(exchange, symbol)` | Fetch exchange's deposit address for USDT-TRC20 |
| `fetchBalance(exchange, symbol?)` | Get available balance |
| `fetchOrder(exchange, symbol, orderId)` | Check order fill status |

### 1.3 Monitoring — `Backend/src/exchange/monitoring.ts`

| Function | Description |
|----------|-------------|
| `waitForDeposit(exchange, symbol, targetAmount, timeoutMs)` | Poll deposit history until funds arrive (max 30 min), return receipt tx |
| `waitForOrderFill(exchange, symbol, orderId, pollIntervalMs)` | Poll order status until filled or cancelled |

### 1.4 Env Config — `Backend/.env.example` additions

```
# Trading API Keys
BINANCE_API_KEY=
BINANCE_SECRET=
BYBIT_API_KEY=
BYBIT_SECRET=
KUCOIN_API_KEY=
KUCOIN_SECRET=
KUCOIN_PASSPHRASE=
MEXC_API_KEY=
MEXC_SECRET=
BITGET_API_KEY=
BITGET_SECRET=
COINBASE_API_KEY=
COINBASE_SECRET=
GATE_API_KEY=
GATE_SECRET=

# Execution config
EXECUTION_ENABLED=false
MIN_NET_PROFIT_USD=1.00
MAX_CONCURRENT_TRADES=1
```
### 1.5 Balance Endpoint

`GET /api/balances` — returns USDT balance per exchange.

---

## Phase 2 — Execution Pipeline

**Goal:** Automated buy → withdraw → wait → sell cycle, triggered manually per opportunity.

### 2.1 Pipeline — `Backend/src/execution/pipeline.ts`

```
executeTrade(opportunity, amountUsd):
  1. Validate
     - Fetch real orderbooks
     - Simulate $100 fill via existing runAnalysis()
     - Require net profit > MIN_NET_PROFIT_USD
     - Require liquidity > amountUsd on both sides
     - If fail → return { success: false, reason }

  2. Market Buy (Exchange A)
     - Call marketBuy(A, symbol, amountUsd)
     - Record fill price, quantity, cost
     - If fail → abort, insert failed trade record

  3. Withdrawal (Exchange A → Exchange B)
     - Fetch B's USDT-TRC20 deposit address
     - Initiate withdrawal with memo/tag if needed
     - Record txid, update trade status

  4. Wait for Deposit (Exchange B)
     - Poll B's deposit history every 15s
     - Match incoming USDT by txid/amount
     - Record deposit time (for P&L analytics)
     - Timeout after 30 min → mark stuck, notify

  5. Place Limit Sell (Exchange B)
     - Place limit sell at target sell price
     - Record order ID

  6. Monitor (indefinite — user chooses to hold)
     - Poll order status every 30s
     - When filled: record fill price, profit, mark completed
     - User can cancel via dashboard anytime

  7. Record
     - Insert full trade record into SQLite
```

### 2.2 Execute Endpoint

`POST /api/execute-trade`

```json
{
  "symbol": "BTC",
  "buyExchange": "binance",
  "sellExchange": "bybit",
  "buyPrice": 65000,
  "sellPrice": 68250,
  "investmentUsd": 100
}
```

Response: `{ tradeId, status: "started" }`

### 2.3 Status Endpoint

`GET /api/execute-trade/:id` — returns current status of an execution.

---

## Phase 3 — Trade Database

**Goal:** Persist all trade attempts for P&L tracking and analytics.

### 3.1 Schema — `Backend/src/db/setup.ts`

```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  investment_usd REAL,

  buy_price REAL,
  buy_qty REAL,
  buy_cost REAL,
  buy_fee REAL,

  withdrawal_fee REAL,
  txid TEXT,
  transfer_time_seconds INTEGER,

  target_sell_price REAL,
  sell_price REAL,
  sell_revenue REAL,
  sell_fee REAL,
  sell_order_id TEXT,

  gross_profit REAL,
  net_profit REAL,
  net_roi_pct REAL,

  status TEXT,
  -- Values: pending | buying | withdrawing | transferring | selling | completed | failed | stuck | cancelled

  started_at TEXT,
  buy_completed_at TEXT,
  withdrawal_initiated_at TEXT,
  deposit_confirmed_at TEXT,
  sell_placed_at TEXT,
  completed_at TEXT,
  error TEXT
);
```

### 3.2 Trade Store — `Backend/src/db/tradeStore.ts`

| Function | Description |
|----------|-------------|
| `insertTrade(trade)` | Create new trade record |
| `updateTrade(id, fields)` | Update status, prices, timestamps |
| `getTrade(id)` | Fetch single trade |
| `getAllTrades()` | Fetch all trades (newest first) |
| `getPnlSummary()` | Aggregate: total trades, wins, losses, net profit, win rate |
| `getActiveTrades()` | Trades in progress (not yet completed/failed) |

### 3.3 Trade Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/trades` | All trade history |
| `GET /api/trades/summary` | P&L summary stats |

---

## Phase 4 — Frontend Integration

**Goal:** Execute button on opportunities + trade history page.

### 4.1 Execute Button — `Frontend/src/views/arb.vue`

- After "Analyze" returns `decision: "GO"`, show an **Execute** button
- On click: call `POST /api/execute-trade`
- Show execution status inline:
  - 🟡 Pending / Buying / Withdrawing / Transferring / Selling
  - 🟢 Completed
  - 🔴 Failed / Stuck
- Show a "Cancel" button for active trades (cancels limit order)

### 4.2 Trade History Page — `Frontend/src/views/TradeHistory.vue`

New route: `/trades`

Columns:
| Symbol | Buy Ex | Sell Ex | Investment | Net Profit | ROI % | Status | Duration | Date |

- Color-coded profit/loss
- Click to expand details (all prices, fees, transfer time)
- Summary card at top: Total trades, Wins, Losses, Best/Worst, Net P&L

### 4.3 Store Updates — `Frontend/src/stores/arbStore.ts`

New state and actions:
- `activeTrades` — currently running executions
- `tradeHistory` — past trades
- `executeTrade(opp, amount)` — calls backend
- `cancelTrade(tradeId)` — cancels limit order
- `refreshTrades()` — fetch latest trade data

---

## Phase 5 — Risk & Safety

### 5.1 Price Drop Guard

- While the sell limit order is open, monitor the current spot price on Exchange B every 60s
- If spot drops >3% below your limit price, send a notification (log + frontend badge)
- User decides: hold, cancel, or market sell

### 5.2 Max Concurrent Trades

- Default: 1 active trade at a time (configurable in `.env`)
- Prevents tying up all capital in transfers

### 5.3 Minimum Profit Threshold

- `MIN_NET_PROFIT_USD = 1.00` — don't execute for pennies
- Hard-coded safety: refuse if simulated net profit is less

### 5.4 Manual Cancel

- User can cancel an active sell limit order from the dashboard
- Option to immediately market sell (take the loss/lesser profit) or just cancel and hold

---

## Fee Estimates (TRC-20 USDT, $100 Trade)

| Item | Cost | % of $100 |
|------|------|-----------|
| Market buy taker (0.1%) | $0.10 | 0.10% |
| Withdrawal (TRC-20) | ~$0.50 | 0.50% |
| Limit sell maker (~0.08%) | ~$0.08 | 0.08% |
| **Total friction** | **~$0.68** | **0.68%** |

| Gross Spread | Gross Profit | Fees | Net Profit |
|-------------|-------------|------|-----------|
| 1% | $1.00 | $0.68 | $0.32 |
| 2% | $2.00 | $0.68 | $1.32 |
| 3% | $3.00 | $0.68 | $2.32 |
| 5% | $5.00 | $0.68 | $4.32 |

---

## File Summary

### New Files

| File | Lines (est.) |
|------|-------------|
| `Backend/src/exchange/setup.ts` | 80 |
| `Backend/src/exchange/trading.ts` | 120 |
| `Backend/src/exchange/monitoring.ts` | 60 |
| `Backend/src/execution/pipeline.ts` | 180 |
| `Backend/src/execution/types.ts` | 30 |
| `Backend/src/db/setup.ts` | 40 |
| `Backend/src/db/tradeStore.ts` | 80 |
| `Frontend/src/views/TradeHistory.vue` | 200 |
| `Frontend/src/services/executeService.ts` | 30 |

### Modified Files

| File | Change |
|------|--------|
| `Backend/src/index.ts` | +4 endpoints (execute, cancel, trades, balances) |
| `Backend/.env.example` | +17 API key config entries |
| `Frontend/src/views/arb.vue` | +Execute button + status indicator |
| `Frontend/src/stores/arbStore.ts` | +execution state + actions |
| `Frontend/src/router/index.ts` | +/trades route |

**Total: ~820 new lines, ~150 modified lines**

---

## Build Order

```
Step 1: Install deps (ccxt, better-sqlite3, @types/better-sqlite3)
Step 2: exchange/setup.ts + types.ts
Step 3: trading.ts + monitoring.ts
Step 4: db/setup.ts + tradeStore.ts
Step 5: pipeline.ts (core execution)
Step 6: index.ts endpoints
Step 7: Frontend execute button + status
Step 8: TradeHistory.vue page
Step 9: Risk guards (price drop monitor, cancel)
```

---

## Questions to Answer Before Starting

1. **Deposit addresses** — Auto-fetch via API or manual config file?
2. **Test mode** — Start with a tiny amount ($5-10) to verify the full cycle?
3. **Post-execution** — After the limit sell fills, do you want the USDT to stay on Exchange B (for future sells) or auto-withdraw back to A?
