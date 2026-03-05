# ARBHUNT - Crypto Arbitrage Scanner

A real-time cryptocurrency arbitrage opportunity scanner. It compares prices of the same trading pair across multiple exchanges and shows you where you can buy low on one exchange and sell high on another.

## How It Works

1. The **Backend** fetches live prices for all USDT trading pairs from 6 exchanges using the FreeCryptoAPI service
2. For each coin, it finds the exchange with the lowest price (buy) and the exchange with the highest price (sell)
3. The **Frontend** displays these opportunities in a dashboard, including net profit after trading fees

### Supported Exchanges

| Exchange | Taker Fee |
|----------|-----------|
| Binance  | 0.1%      |
| Bybit    | 0.1%      |
| KuCoin   | 0.1%      |
| Bitget   | 0.1%      |
| MEXC     | 0.1%      |
| Coinbase | 0.6%      |

---

## Prerequisites

Before you start, make sure you have these installed on your PC:

### 1. Node.js (v20.19+ or v22.12+)

Download and install from: https://nodejs.org/en/download

To check if you have it:
```
node --version
```
You should see something like `v22.14.0`. If the version is below v20.19, update it.

### 2. Git (optional, for cloning)

Download from: https://git-scm.com/downloads

### 3. FreeCryptoAPI Key

You need a free API key from FreeCryptoAPI:

1. Go to https://freecryptoapi.com
2. Sign up for a free account
3. Copy your API key from the dashboard

---

## Setup Instructions

### Step 1: Get the project files

If you received this as a zip file, extract it to a folder on your PC (e.g., `C:\Users\YourName\Desktop\Ab-opps`).

If cloning from git:
```
git clone <repo-url>
cd Ab-opps
```

### Step 2: Set up the Backend

Open a terminal (Command Prompt, PowerShell, or Git Bash) and navigate to the Backend folder:

```
cd Ab-opps/Backend
```

#### Install dependencies:
```
npm install
```

#### Configure your API key:

Open the file `Backend/.env` in any text editor (Notepad works fine). You will see:

```
FREECRYPTO_API_KEY=replace_with_your_key
PORT=3001
```

Replace `replace_with_your_key` with your actual FreeCryptoAPI key. For example:

```
FREECRYPTO_API_KEY=abc123xyz456
PORT=3001
```

Save the file.

> **Important:** Do NOT share your `.env` file or API key with anyone. Do NOT upload it to GitHub.

### Step 3: Set up the Frontend

Open a **second** terminal and navigate to the Frontend folder:

```
cd Ab-opps/Frontend
```

#### Install dependencies:
```
npm install
```

#### Configure the backend URL (usually no changes needed):

The file `Frontend/.env.local` contains:

```
VITE_API_URL=http://localhost:3001
```

If you changed the backend port in Step 2, update it here to match. Otherwise, leave it as-is.

---

## Running the App

You need **two terminals** open — one for the backend, one for the frontend.

### Terminal 1: Start the Backend

```
cd Ab-opps/Backend
npx tsx src/index.ts
```

You should see:
```
===============================================================
  ARBHUNT Backend
  Port: 3001
  API Key: configured
  Exchanges: binance, bybit, kucoin, bitget, mexc, coinbase
===============================================================

[Server] Running on http://localhost:3001
```

If it says `API Key: MISSING`, go back and check your `.env` file.

### Terminal 2: Start the Frontend

```
cd Ab-opps/Frontend
npm run dev
```

You should see:
```
VITE v7.x.x  ready in XXX ms

  -> Local:   http://localhost:5173/
```

### Step 4: Open the Dashboard

Open your browser and go to:

```
http://localhost:5173
```

You should see the ARBHUNT dashboard with live arbitrage opportunities.

---

## Using the Dashboard

- **Opportunities** — Total number of arbitrage opportunities found
- **Best Spread** — The highest price difference percentage across all pairs
- **Avg Spread** — Average spread across all opportunities
- **Exchanges** — Number of exchanges successfully scanned

Each opportunity card shows:
- **Pair** — e.g., `BTC/USDT`
- **Buy exchange** — Where the price is lowest (shown in cyan)
- **Sell exchange** — Where the price is highest (shown in purple)
- **Buy/Sell prices** — The actual prices on each exchange
- **Spread %** — Gross price difference percentage
- **Net %** — Profit after subtracting trading fees from both exchanges

Click the **refresh button** to fetch the latest prices manually.

---

## Troubleshooting

### "EADDRINUSE: address already in use :::3001"

Another process is using port 3001. Kill it:

**Windows (PowerShell):**
```
Get-Process -Name node | Stop-Process -Force
```

**Mac/Linux:**
```
kill $(lsof -t -i:3001)
```

Then start the backend again.

### "API Key: MISSING"

Your `.env` file is not set up correctly. Make sure:
- The file is named exactly `.env` (not `.env.txt`)
- It is inside the `Backend/` folder
- The key has no extra spaces: `FREECRYPTO_API_KEY=yourkey` (no spaces around `=`)

### Dashboard shows "No arbitrage opportunities detected"

- Make sure the backend is running (check Terminal 1 for errors)
- Click the refresh button on the dashboard
- Check that your API key is valid by opening this in your browser (replace `YOUR_KEY`):
  ```
  https://api.freecryptoapi.com/v1/getExchange?exchange=binance&token=YOUR_KEY
  ```
  You should see JSON data with `"status": "success"`. If you see an error, your API key may be invalid.

### Frontend can't connect to backend

- Make sure the backend is running on port 3001
- Make sure `Frontend/.env.local` has `VITE_API_URL=http://localhost:3001`
- If you changed the backend port, update the frontend `.env.local` to match

### Network / DNS errors in the backend

The backend connects to `api.freecryptoapi.com` to fetch prices. If your network blocks this domain, the app won't work. Try opening `https://api.freecryptoapi.com` in your browser to check.

---

## Project Structure

```
Ab-opps/
  Backend/
    .env                  <- Your API key goes here
    package.json
    tsconfig.json
    src/
      index.ts            <- Express server (single file)

  Frontend/
    .env.local            <- Backend URL config
    package.json
    vite.config.ts
    src/
      App.vue             <- Main app shell
      main.ts             <- Vue entry point
      views/
        arb.vue           <- Dashboard page
      stores/
        arbStore.ts       <- State management (Pinia)
      services/
        findPrice.ts      <- Calls backend API
        calcProfit.ts     <- Net profit calculation
        arbitrage.ts      <- Arbitrage finder logic
      types/
        crypto.ts         <- TypeScript interfaces
        exchangeFess.ts   <- Exchange fee rates
      assets/
        base.css          <- Tailwind theme + styles
```

---

## Disclaimer

This tool is for **informational purposes only**. It scans publicly available price data and displays potential arbitrage opportunities. It does **not** execute any trades. Always do your own research before trading. Cryptocurrency trading involves significant risk. The spreads shown may not be achievable in practice due to withdrawal fees, transfer times, slippage, and liquidity.
