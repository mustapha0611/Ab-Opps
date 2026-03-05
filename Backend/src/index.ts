import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.FREECRYPTO_API_KEY || "";
const BASE_URL = "https://api.freecryptoapi.com/v1";
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

const EXCHANGES = [
  "binance",
  "bybit",
  "kucoin",
  "bitget",
  "mexc",
  "coinbase",
  "gateio",
];


interface ExchangePrice {
  exchange: string;
  symbol: string;
  pair: string;
  price: number;
  change24h?: number;
  volume?: number;
  timestamp: number;
}

interface ArbitrageOpportunity {
  symbol: string;
  pair: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  spreadUsd: number;
  timestamp: number;
}

/**
 * Normalize a raw symbol string from any exchange into a base symbol.
 * Binance/Bybit/Bitget/MEXC/Coinbase: "BTCUSDT" → "BTC"
 * KuCoin: "BTC-USDT" → "BTC"
 */
function extractBaseSymbol(raw: string): string {
  return raw
    .replace(/-USDT$/i, "")
    .replace(/USDT$/i, "")
    .replace(/-USD$/i, "")
    .replace(/USD$/i, "")
    .toUpperCase();
}

/**
 * Fetch prices for all tracked symbols from a specific exchange
 * using the FreeCryptoAPI /getExchange endpoint.
 *
 * Response format:
 * { status: "success", symbols: [{ symbol: "BTCUSDT", last: "71265.2", daily_change_percentage: "-2.36", date: "..." }, ...] }
 */
async function fetchExchangePrices(exchange: string): Promise<ExchangePrice[]> {
  try {
    const url = `${BASE_URL}/getExchange?exchange=${exchange}&token=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[API] ${exchange} returned status ${response.status}`);
      return [];
    }
    const data = await response.json() as any;

    if (!data || data.status !== "success" || !Array.isArray(data.symbols)) {
      console.warn(`[API] ${exchange}: unexpected response format or status="${data?.status}"`);
      return [];
    }

    const prices: ExchangePrice[] = [];

    for (const item of data.symbols) {
      const rawSymbol: string = item.symbol || "";
      // Only consider USDT pairs
      if (!rawSymbol.toUpperCase().includes("USDT")) continue;

      const baseSymbol = extractBaseSymbol(rawSymbol);

      const price = parseFloat(item.last || "0");
      if (price <= 0) continue;

      prices.push({
        exchange,
        symbol: baseSymbol,
        pair: `${baseSymbol}/USDT`,
        price,
        change24h: parseFloat(item.daily_change_percentage || "0"),
        volume: undefined,
        timestamp: Date.now(),
      });
    }

    console.log(`[API] ${exchange}: ${data.symbols.length} total pairs, ${prices.length} tracked`);

    // Deduplicate: if the API returns the same symbol twice, keep the last one
    const deduped = new Map<string, ExchangePrice>();
    for (const p of prices) {
      deduped.set(p.symbol, p);
    }
    return Array.from(deduped.values());
  } catch (err: any) {
    console.error(`[API] Failed to fetch ${exchange}: ${err.message}`);
    return [];
  }
}

/**
 * Fetch prices from ALL exchanges and find arbitrage opportunities.
 */
async function scanArbitrageOpportunities(): Promise<{
  prices: ExchangePrice[];
  opportunities: ArbitrageOpportunity[];
}> {
  // Fetch all exchanges in parallel
  const results = await Promise.allSettled(
    EXCHANGES.map((ex) => fetchExchangePrices(ex))
  );

  const allPrices: ExchangePrice[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allPrices.push(...result.value);
    }
  }

  // Group by symbol
  const bySymbol: Record<string, ExchangePrice[]> = {};
  for (const price of allPrices) {
    if (!bySymbol[price.symbol]) bySymbol[price.symbol] = [];
    bySymbol[price.symbol].push(price);
  }

  // Find arbitrage opportunities — one per symbol (lowest buy vs highest sell)
  const opportunities: ArbitrageOpportunity[] = [];

  for (const [symbol, exchangePrices] of Object.entries(bySymbol)) {
    if (exchangePrices.length < 2) continue;

    // Find the cheapest and most expensive exchange for this symbol
    let lowest = exchangePrices[0];
    let highest = exchangePrices[0];
    for (const ep of exchangePrices) {
      if (ep.price < lowest.price) lowest = ep;
      if (ep.price > highest.price) highest = ep;
    }

    // Skip if same exchange somehow
    if (lowest.exchange === highest.exchange) continue;

    const spread = highest.price - lowest.price;
    const spreadPct = (spread / lowest.price) * 100;

    if (spreadPct > 0.01 && spreadPct <= 10) {
      opportunities.push({
        symbol,
        pair: `${symbol}/USDT`,
        buyExchange: lowest.exchange,
        sellExchange: highest.exchange,
        buyPrice: lowest.price,
        sellPrice: highest.price,
        spreadPct: Math.round(spreadPct * 100) / 100,
        spreadUsd: Math.round(spread * 100) / 100,
        timestamp: Date.now(),
      });
    }
  }

  // Sort by spread descending
  opportunities.sort((a, b) => b.spreadPct - a.spreadPct);

  return { prices: allPrices, opportunities };
}

// ─── REST Endpoints ─────────────────────────────────────────────────────────

// Main endpoint: get exchange prices + arbitrage opportunities
app.get("/api/exchange-prices", async (_req, res) => {
  try {
    const result = await scanArbitrageOpportunities();
    res.json(result);
  } catch (err: any) {
    console.error("[Server] Scan failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ARBHUNT Backend");
  console.log(`  Port: ${PORT}`);
  console.log(`  API Key: ${API_KEY ? "configured" : "MISSING - set FREECRYPTO_API_KEY in .env"}`);
  console.log(`  Exchanges: ${EXCHANGES.join(", ")}`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`\n[Server] Running on http://localhost:${PORT}\n`);
});
