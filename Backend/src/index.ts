import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import dns from "node:dns";
dotenv.config();

// Bypass local DNS blockings if needed (e.g. for KuCoin in some regions)
if (process.env.USE_PUBLIC_DNS === "true") {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

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
  "gate",
];

const KUCOIN_DOMAINS = [
  "api.kucoin.com",
  "api-sg.kucoin.com",
  "api-us.kucoin.com",
  "api.kucoin.net",
  "api-sg.kucoin.net",
];

/**
 * Resilient fetch for KuCoin that tries multiple domains to bypass DNS blocks.
 */
async function fetchKucoin(path: string, timeout = 5000): Promise<any> {
  for (const domain of KUCOIN_DOMAINS) {
    try {
      const url = `https://${domain}${path}`;
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(timeout),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      if (response.ok) {
        const data = await response.json();
        // KuCoin API usually returns a 'code' field. '200000' is success.
        if (data && (data.code === "200000" || data.code === 200000 || !data.code)) {
          return data;
        }
      }
      console.warn(`[API] KuCoin ${domain}${path} returned status ${response.status}`);
    } catch (err: any) {
      console.warn(`[API] KuCoin domain ${domain} failed for path ${path}: ${err.message}`);
    }
  }
  return null;
}

/**
 * Custom fetch for KuCoin to bypass DNS blocks by trying multiple domains.
 */
async function fetchKucoinDirect(): Promise<ExchangePrice[]> {
  const data = await fetchKucoin("/api/v1/market/allTickers");
  if (!data || data.code !== "200000" || !data.data?.ticker) return [];

  const prices: ExchangePrice[] = [];
  for (const t of data.data.ticker) {
    if (!t.symbol.endsWith("-USDT")) continue;
    const baseSymbol = t.symbol.replace("-USDT", "");
    prices.push({
      exchange: "kucoin",
      symbol: baseSymbol,
      pair: `${baseSymbol}/USDT`,
      price: parseFloat(t.last || "0"),
      change24h: parseFloat(t.changeRate || "0") * 100,
      volume: parseFloat(t.volValue || "0"),
      timestamp: Date.now(),
    });
  }
  return prices;
}

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
  // Use direct fetch for KuCoin to avoid DNS/Proxy issues and get better data
  if (exchange === "kucoin") {
    const directPrices = await fetchKucoinDirect();
    if (directPrices.length > 0) return directPrices;
  }

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

    if (spreadPct >= 0.5 && spreadPct <= 10) {
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

// ─── Orderbook Configuration ────────────────────────────────────────────────

/** Taker fees per exchange (%) */
const TAKER_FEES: Record<string, number> = {
  binance: 0.10,
  bybit: 0.10,
  kucoin: 0.10,
  bitget: 0.10,
  mexc: 0.10,
  coinbase: 0.60,
  gate: 0.15,
};

/** Estimated withdrawal fees in USDT (flat) */
const WITHDRAWAL_FEES: Record<string, number> = {
  binance: 1.0,
  bybit: 1.0,
  kucoin: 1.0,
  bitget: 1.0,
  mexc: 1.0,
  coinbase: 0.0,
  gate: 1.0,
};

// ─── Direct Exchange Orderbook ──────────────────────────────────────────────

interface OrderbookLevel {
  price: number;
  size: number;
}

interface OrderbookData {
  exchange: string;
  symbol: string;
  asks: OrderbookLevel[];
  bids: OrderbookLevel[];
  timestamp: string;
}

const OB_TIMEOUT = 15000;

type ApiCall = {
  url: string;
  parse: (data: any) => { asks?: [string, string][]; bids?: [string, string][] };
};

type TickerData = {
  bidPrice: number;
  askPrice: number;
  volume24hUsd: number;
};

/** Build exchange-specific API configs for both orderbook and ticker endpoints */
function exchangeApis(ex: string, sym: string): { depth?: ApiCall; ticker?: ApiCall } {
  const map: Record<string, { depth?: ApiCall; ticker?: ApiCall }> = {
    binance: {
      ticker: {
        url: `https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`,
        parse: (d) => ({ asks: [[d.askPrice, d.askQty]], bids: [[d.bidPrice, d.bidQty]] }),
      },
    },
    bybit: {
      ticker: {
        url: `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}USDT`,
        parse: (d) => {
          const t = d.result?.list?.[0];
          return t ? { asks: [[t.ask1Price, t.ask1Size]], bids: [[t.bid1Price, t.bid1Size]] } : {};
        },
      },
    },
    kucoin: {
      depth: {
        url: `https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=${sym}-USDT`,
        parse: (d) => ({ asks: d.data?.asks || [], bids: d.data?.bids || [] }),
      },
      ticker: {
        url: `https://api.kucoin.com/api/v1/market/stats?symbol=${sym}-USDT`,
        parse: (d) => ({ asks: [[d.data?.sell, "0"]], bids: [[d.data?.buy, "0"]] }),
      },
    },
    mexc: {
      depth: {
        url: `https://api.mexc.com/api/v3/depth?symbol=${sym}USDT&limit=20`,
        parse: (d) => ({ asks: d.asks || [], bids: d.bids || [] }),
      },
      ticker: {
        url: `https://api.mexc.com/api/v3/ticker/24hr?symbol=${sym}USDT`,
        parse: (d) => ({
          asks: [[d.askPrice, d.askQty]],
          bids: [[d.bidPrice, d.bidQty]],
        }),
      },
    },
    bitget: {
      ticker: {
        url: `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${sym}USDT`,
        parse: (d) => {
          const t = d.data?.[0];
          return t ? { asks: [[t.askPr, t.askSz]], bids: [[t.bidPr, t.bidSz]] } : {};
        },
      },
    },
    coinbase: {
      ticker: {
        url: `https://api.exchange.coinbase.com/products/${sym}-USDT/ticker`,
        parse: (d) => ({ asks: [[d.ask, "0"]], bids: [[d.bid, "0"]] }),
      },
    },
    gate: {
      ticker: {
        url: `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${sym}_USDT`,
        parse: (d) => {
          const t = d?.[0];
          return t ? { asks: [[t.lowest_ask, "0"]], bids: [[t.highest_bid, "0"]] } : {};
        },
      },
    },
  };

  return map[ex] || {};
}

/** Fetch from a single API config — returns null on failure */
async function tryFetch(ex: string, api: ApiCall, label: string): Promise<{ asks: [string, string][]; bids: [string, string][] } | null> {
  try {
    let data;
    if (ex === "kucoin") {
      // Extract path from the pre-configured URL
      const path = api.url.split("kucoin.com")[1] || api.url.split("kucoin.net")[1];
      data = await fetchKucoin(path, OB_TIMEOUT);
    } else {
      const r = await fetch(api.url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
      if (!r.ok) return null;
      data = await r.json();
    }
    
    if (!data) return null;
    const result = api.parse(data);
    if (result.asks?.length && result.bids?.length) {
      return { asks: result.asks, bids: result.bids };
    }
    return null;
  } catch {
    return null;
  }
}

/** Parse ticker api response to extract best bid/ask + 24h volume in USD */
async function tryFetchTicker(ex: string, sym: string): Promise<TickerData | null> {
  if (ex === "kucoin") {
    const data = await fetchKucoin(`/api/v1/market/stats?symbol=${sym}-USDT`);
    return data?.data ? { bidPrice: +(data.data.buy || 0), askPrice: +(data.data.sell || 0), volume24hUsd: +(data.data.vol || 0) * +(data.data.last || 1) } : null;
  }

  const tickerApis: Record<string, { url: string; parse: (d: any) => TickerData | null }> = {
    binance: {
      url: `https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`,
      parse: (d) => d.bidPrice ? { bidPrice: +d.bidPrice, askPrice: +d.askPrice, volume24hUsd: +(d.quoteVolume || 0) } : null,
    },
    bybit: {
      url: `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}USDT`,
      parse: (d) => {
        const t = d.result?.list?.[0];
        return t ? { bidPrice: +t.bid1Price, askPrice: +t.ask1Price, volume24hUsd: +(t.volume24h || 0) * (+t.lastPrice || 1) } : null;
      },
    },
    kucoin: {
      url: `https://api.kucoin.com/api/v1/market/stats?symbol=${sym}-USDT`,
      parse: (d) => d.data ? { bidPrice: +(d.data.buy || 0), askPrice: +(d.data.sell || 0), volume24hUsd: +(d.data.vol || 0) * +(d.data.last || 1) } : null,
    },
    mexc: {
      url: `https://api.mexc.com/api/v3/ticker/24hr?symbol=${sym}USDT`,
      parse: (d) => d.bidPrice ? { bidPrice: +d.bidPrice, askPrice: +d.askPrice, volume24hUsd: +(d.quoteVolume || 0) } : null,
    },
    bitget: {
      url: `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${sym}USDT`,
      parse: (d) => {
        const t = d.data?.[0];
        return t ? { bidPrice: +t.bidPr, askPrice: +t.askPr, volume24hUsd: +(t.usdtVol || 0) } : null;
      },
    },
    coinbase: {
      url: `https://api.exchange.coinbase.com/products/${sym}-USDT/ticker`,
      parse: (d) => d.bid ? { bidPrice: +d.bid, askPrice: +d.ask, volume24hUsd: +(d.volume || 0) * (+d.price || 1) } : null,
    },
    gate: {
      url: `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${sym}_USDT`,
      parse: (d) => {
        const t = d?.[0];
        return t ? { bidPrice: +(t.highest_bid || 0), askPrice: +(t.lowest_ask || 0), volume24hUsd: +(t.quote_volume || 0) } : null;
      },
    },
  };

  const api = tickerApis[ex];
  if (!api) return null;

  try {
    const r = await fetch(api.url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
    if (!r.ok) return null;
    return api.parse(await r.json());
  } catch {
    return null;
  }
}

/**
 * Generate estimated multi-level orderbook from ticker data.
 * Uses 24h volume to estimate depth per level.
 */
function estimateOrderbook(ticker: TickerData, ex: string, sym: string): OrderbookData {
  const levels = 8;
  const price = (ticker.bidPrice + ticker.askPrice) / 2;
  const avgLevelSize = ticker.volume24hUsd / 28800 / price; // ~1 tick of 24h volume per level

  const stepPct = [0.001, 0.002, 0.003, 0.005, 0.008, 0.012, 0.018, 0.025];
  const sizeMult = [1.0, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.1];

  const asks: OrderbookLevel[] = [];
  const bids: OrderbookLevel[] = [];

  for (let i = 0; i < levels; i++) {
    asks.push({
      price: ticker.askPrice * (1 + stepPct[i]),
      size: Math.max(avgLevelSize * sizeMult[i], 1),
    });
    bids.push({
      price: ticker.bidPrice * (1 - stepPct[i]),
      size: Math.max(avgLevelSize * sizeMult[i], 1),
    });
  }

  return {
    exchange: ex,
    symbol: sym,
    asks,
    bids,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fetch orderbook for a symbol on an exchange.
 * Tier 1: Try full depth orderbook API
 * Tier 2: Fall back to ticker stats + estimated depth
 */
async function fetchOrderbook(exchange: string, baseSymbol: string): Promise<OrderbookData> {
  const ex = exchange.toLowerCase();
  const sym = baseSymbol.toUpperCase();

  console.log(`[Orderbook] Fetching ${ex}:${sym}...`);

  // Tier 1: try orderbook depth (limited to known depth-capable exchanges)
  const apis = exchangeApis(ex, sym);
  if (apis.depth) {
    const result = await tryFetch(ex, apis.depth, `${ex}:${sym} depth`);
    if (result) {
      const asks = result.asks.map(([p, s]: [string, string]) => ({ price: +p, size: +s }));
      const bids = result.bids.map(([p, s]: [string, string]) => ({ price: +p, size: +s }));
      return { exchange: ex, symbol: baseSymbol, asks, bids, timestamp: new Date().toISOString() };
    }
    console.log(`[Orderbook] Depth API failed for ${ex}:${sym}, trying ticker fallback...`);
  }

  // Tier 2: ticker stats → estimated orderbook
  const ticker = await tryFetchTicker(ex, sym);
  if (ticker && ticker.bidPrice > 0 && ticker.askPrice > 0) {
    console.log(`[Orderbook] Using ticker fallback for ${ex}:${sym} (vol $${(ticker.volume24hUsd / 1000).toFixed(0)}k)`);
    return estimateOrderbook(ticker, ex, sym);
  }

  throw new Error(`Cannot fetch orderbook or ticker data for ${ex} ${sym}`);
}

// ─── Analysis Engine ────────────────────────────────────────────────────────

interface InvestmentTier {
  investmentUsd: number;
  unitsToBuy: number;
  effectiveBuyPrice: number;
  effectiveSellPrice: number;
  slippageBuyPct: number;
  slippageSellPct: number;
  buyCost: number;
  sellRevenue: number;
  buyFeeUsd: number;
  sellFeeUsd: number;
  withdrawalFeeUsd: number;
  totalFeesUsd: number;
  grossProfitUsd: number;
  netProfitUsd: number;
  netProfitPct: number;
  roiPct: number;
  feasible: boolean;
  reason: string;
}

interface AnalysisResult {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  orderbook: {
    buyAsks: OrderbookLevel[];
    sellBids: OrderbookLevel[];
  };
  liquidity: {
    buyLiquidityUsd: number;
    sellLiquidityUsd: number;
    buyLevels: number;
    sellLevels: number;
    sufficient: boolean;
  };
  analysis: InvestmentTier[];
  recommendation: {
    decision: "GO" | "NO-GO";
    optimalInvestment: number;
    expectedProfit: number;
    expectedRoi: number;
    reason: string;
  };
  timestamp: number;
}

/**
 * Walk an orderbook (asks for buying, bids for selling) to simulate
 * filling a given USD amount. Returns effective avg price and total units.
 */
function simulateOrderbookFill(
  levels: OrderbookLevel[],
  amountUsd: number,
  side: "buy" | "sell"
): { effectivePrice: number; totalUnits: number; filledUsd: number; levelsUsed: number } {
  let remainingUsd = amountUsd;
  let totalUnits = 0;
  let totalCost = 0;
  let levelsUsed = 0;

  // For buying: walk asks (lowest first — already sorted by exchange)
  // For selling: walk bids (highest first — already sorted by exchange)
  for (const level of levels) {
    if (remainingUsd <= 0) break;
    levelsUsed++;

    const levelValueUsd = level.price * level.size;

    if (side === "buy") {
      if (levelValueUsd >= remainingUsd) {
        // Partial fill on this level
        const unitsToBuy = remainingUsd / level.price;
        totalUnits += unitsToBuy;
        totalCost += remainingUsd;
        remainingUsd = 0;
      } else {
        // Full level consumed
        totalUnits += level.size;
        totalCost += levelValueUsd;
        remainingUsd -= levelValueUsd;
      }
    } else {
      // Selling: we have units to sell, compute revenue
      const unitsToSell = Math.min(level.size, remainingUsd / level.price);
      const revenue = unitsToSell * level.price;
      totalUnits += unitsToSell;
      totalCost += revenue;
      remainingUsd -= revenue;
    }
  }

  const filledUsd = amountUsd - remainingUsd;
  const effectivePrice = totalUnits > 0 ? totalCost / totalUnits : 0;

  return { effectivePrice, totalUnits, filledUsd, levelsUsed };
}

/**
 * Run full analysis pipeline for an opportunity at multiple investment amounts.
 */
function runAnalysis(
  buyAsks: OrderbookLevel[],
  sellBids: OrderbookLevel[],
  symbol: string,
  buyExchange: string,
  sellExchange: string,
  spotBuyPrice: number,
  spotSellPrice: number,
  investmentAmounts: number[]
): AnalysisResult {
  // ── Liquidity Check ──
  const buyLiquidityUsd = buyAsks.reduce((sum, l) => sum + l.price * l.size, 0);
  const sellLiquidityUsd = sellBids.reduce((sum, l) => sum + l.price * l.size, 0);
  const sufficient = buyLiquidityUsd > 50 && sellLiquidityUsd > 50;

  // ── Per-tier analysis ──
  const buyFeePct = TAKER_FEES[buyExchange.toLowerCase()] ?? 0.15;
  const sellFeePct = TAKER_FEES[sellExchange.toLowerCase()] ?? 0.15;
  const withdrawalFee = WITHDRAWAL_FEES[buyExchange.toLowerCase()] ?? 1.0;

  const tiers: InvestmentTier[] = investmentAmounts.map((investmentUsd) => {
    // Simulate buying on buy exchange (walk the asks)
    const buyResult = simulateOrderbookFill(buyAsks, investmentUsd, "buy");

    if (buyResult.totalUnits <= 0 || buyResult.filledUsd < investmentUsd * 0.5) {
      return {
        investmentUsd,
        unitsToBuy: 0,
        effectiveBuyPrice: 0,
        effectiveSellPrice: 0,
        slippageBuyPct: 0,
        slippageSellPct: 0,
        buyCost: 0,
        sellRevenue: 0,
        buyFeeUsd: 0,
        sellFeeUsd: 0,
        withdrawalFeeUsd: withdrawalFee,
        totalFeesUsd: 0,
        grossProfitUsd: 0,
        netProfitUsd: 0,
        netProfitPct: 0,
        roiPct: 0,
        feasible: false,
        reason: `Insufficient buy-side liquidity (only $${buyResult.filledUsd.toFixed(2)} available)`,
      };
    }

    // Simulate selling those units on sell exchange (walk the bids)
    const sellValueUsd = buyResult.totalUnits * sellBids[0]?.price || 0;
    const sellResult = simulateOrderbookFill(sellBids, sellValueUsd, "sell");

    // Effective prices
    const effectiveBuyPrice = buyResult.effectivePrice;
    const effectiveSellPrice = sellResult.totalUnits > 0
      ? (sellResult.totalUnits * sellResult.effectivePrice) / sellResult.totalUnits
      : 0;

    // Slippage
    const slippageBuyPct = spotBuyPrice > 0
      ? ((effectiveBuyPrice - spotBuyPrice) / spotBuyPrice) * 100
      : 0;
    const slippageSellPct = spotSellPrice > 0
      ? ((spotSellPrice - effectiveSellPrice) / spotSellPrice) * 100
      : 0;

    // Costs and revenue
    const buyCost = buyResult.filledUsd;
    const buyFeeUsd = buyCost * (buyFeePct / 100);
    const sellRevenue = sellResult.totalCost;
    const sellFeeUsd = sellRevenue * (sellFeePct / 100);
    const totalFeesUsd = buyFeeUsd + sellFeeUsd + withdrawalFee;

    const grossProfitUsd = sellRevenue - buyCost;
    const netProfitUsd = grossProfitUsd - totalFeesUsd;
    const netProfitPct = buyCost > 0 ? (netProfitUsd / buyCost) * 100 : 0;
    const roiPct = netProfitPct;

    const buyFilled = buyResult.filledUsd >= investmentUsd * 0.9;
    const sellFilled = sellResult.totalUnits >= buyResult.totalUnits * 0.9;
    const feasible = netProfitUsd > 0 && buyFilled && sellFilled;

    return {
      investmentUsd,
      unitsToBuy: buyResult.totalUnits,
      effectiveBuyPrice: Math.round(effectiveBuyPrice * 1e8) / 1e8,
      effectiveSellPrice: Math.round(effectiveSellPrice * 1e8) / 1e8,
      slippageBuyPct: Math.round(slippageBuyPct * 100) / 100,
      slippageSellPct: Math.round(slippageSellPct * 100) / 100,
      buyCost: Math.round(buyCost * 100) / 100,
      sellRevenue: Math.round(sellRevenue * 100) / 100,
      buyFeeUsd: Math.round(buyFeeUsd * 100) / 100,
      sellFeeUsd: Math.round(sellFeeUsd * 100) / 100,
      withdrawalFeeUsd: withdrawalFee,
      totalFeesUsd: Math.round(totalFeesUsd * 100) / 100,
      grossProfitUsd: Math.round(grossProfitUsd * 100) / 100,
      netProfitUsd: Math.round(netProfitUsd * 100) / 100,
      netProfitPct: Math.round(netProfitPct * 100) / 100,
      roiPct: Math.round(roiPct * 100) / 100,
      feasible,
      reason: feasible ? "Profitable after fees and slippage" : netProfitUsd <= 0 ? "Fees exceed profit" : !buyFilled ? "Buy side partially filled" : "Sell side has insufficient liquidity to fully exit position",
    };
  });

  // ── Recommendation ──
  const profitableTiers = tiers.filter((t) => t.feasible);
  let recommendation: AnalysisResult["recommendation"];

  if (profitableTiers.length > 0) {
    // Pick the tier with best absolute profit
    const best = profitableTiers.reduce((a, b) =>
      b.netProfitUsd > a.netProfitUsd ? b : a
    );
    recommendation = {
      decision: "GO",
      optimalInvestment: best.investmentUsd,
      expectedProfit: best.netProfitUsd,
      expectedRoi: best.roiPct,
      reason: `Best ROI at $${best.investmentUsd} investment. Net profit: $${best.netProfitUsd.toFixed(2)} (${best.roiPct.toFixed(2)}% ROI). Slippage: ${best.slippageBuyPct.toFixed(2)}% buy, ${best.slippageSellPct.toFixed(2)}% sell.`,
    };
  } else {
    const bestTier = tiers.reduce((a, b) =>
      b.netProfitUsd > a.netProfitUsd ? b : a
    );
    recommendation = {
      decision: "NO-GO",
      optimalInvestment: 0,
      expectedProfit: bestTier.netProfitUsd,
      expectedRoi: bestTier.roiPct,
      reason: sufficient
        ? `Fees and slippage exceed the spread. Best case: $${bestTier.netProfitUsd.toFixed(2)} loss at $${bestTier.investmentUsd}.`
        : `Insufficient liquidity. Buy: $${buyLiquidityUsd.toFixed(0)}, Sell: $${sellLiquidityUsd.toFixed(0)}.`,
    };
  }

  return {
    symbol,
    buyExchange,
    sellExchange,
    orderbook: {
      buyAsks: buyAsks.slice(0, 10),
      sellBids: sellBids.slice(0, 10),
    },
    liquidity: {
      buyLiquidityUsd: Math.round(buyLiquidityUsd),
      sellLiquidityUsd: Math.round(sellLiquidityUsd),
      buyLevels: buyAsks.length,
      sellLevels: sellBids.length,
      sufficient,
    },
    analysis: tiers,
    recommendation,
    timestamp: Date.now(),
  };
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

// Orderbook endpoint: fetch depth from direct exchange APIs
app.get("/api/orderbook", async (req, res) => {
  try {
    const { symbol, buyExchange, sellExchange } = req.query;
    if (!symbol || !buyExchange || !sellExchange) {
      res.status(400).json({ error: "Missing required params: symbol, buyExchange, sellExchange" });
      return;
    }

    const [buyOrderbook, sellOrderbook] = await Promise.all([
      fetchOrderbook(buyExchange as string, symbol as string),
      fetchOrderbook(sellExchange as string, symbol as string),
    ]);

    res.json({ buyOrderbook, sellOrderbook });
  } catch (err: any) {
    console.error("[Orderbook] Fetch failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Full analysis endpoint
app.post("/api/analyze-opportunity", async (req, res) => {
  try {
    const {
      symbol,
      buyExchange,
      sellExchange,
      buyPrice,
      sellPrice,
      investmentAmounts = [100, 500, 1000, 5000],
    } = req.body;

    if (!symbol || !buyExchange || !sellExchange) {
      res.status(400).json({ error: "Missing required: symbol, buyExchange, sellExchange" });
      return;
    }

    console.log(`[Analysis] Analyzing ${symbol}: ${buyExchange} → ${sellExchange}`);

    // Step 1: Fetch real orderbooks from direct exchange APIs
    const [buyResult, sellResult] = await Promise.allSettled([
      fetchOrderbook(buyExchange, symbol),
      fetchOrderbook(sellExchange, symbol),
    ]);

    const errors: string[] = [];
    if (buyResult.status === "rejected") errors.push(`Buy (${buyExchange}): ${buyResult.reason?.message || buyResult.reason}`);
    if (sellResult.status === "rejected") errors.push(`Sell (${sellExchange}): ${sellResult.reason?.message || sellResult.reason}`);

    if (errors.length === 2) {
      res.status(500).json({ error: `Orderbook fetch failed for both exchanges: ${errors.join("; ")}` });
      return;
    }

    if (errors.length === 1) {
      console.warn(`[Analysis] Partial failure: ${errors[0]}`);
      res.status(500).json({
        error: `Could not fetch orderbook from one exchange: ${errors[0]}. Analysis requires depth data from both sides.`
      });
      return;
    }

    const buyOrderbook = (buyResult as PromiseFulfilledResult<OrderbookData>).value;
    const sellOrderbook = (sellResult as PromiseFulfilledResult<OrderbookData>).value;

    // Step 2: Run full analysis pipeline
    const result = runAnalysis(
      buyOrderbook.asks,
      sellOrderbook.bids,
      symbol,
      buyExchange,
      sellExchange,
      buyPrice || 0,
      sellPrice || 0,
      investmentAmounts
    );

    console.log(`[Analysis] ${symbol}: ${result.recommendation.decision} — ${result.recommendation.reason}`);
    res.json(result);
  } catch (err: any) {
    console.error("[Analysis] Failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Test exchange connectivity
app.get("/api/test-orderbook", async (req, res) => {
  const symbol = (req.query.symbol as string || "BTC").toUpperCase();
  const results: Record<string, any> = {};
  for (const ex of EXCHANGES) {
    try {
      const ob = await fetchOrderbook(ex, symbol);
      results[ex] = {
        status: "ok",
        asks: ob.asks.length,
        bids: ob.bids.length,
        spreadPct: ob.asks.length > 0 && ob.bids.length > 0
          ? (((ob.asks[0].price - ob.bids[0].price) / ob.bids[0].price) * 100).toFixed(3) + "%"
          : "N/A",
      };
    } catch (err: any) {
      results[ex] = { status: "error", message: err.message };
    }
  }
  res.json({ symbol, results });
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
  console.log(`  API Key:        ${API_KEY ? "configured" : "MISSING"}`);
  console.log(`  Orderbooks:     Direct exchange APIs (free, no key required)`);
  console.log(`  Exchanges: ${EXCHANGES.join(", ")}`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`\n[Server] Running on http://localhost:${PORT}\n`);
});
