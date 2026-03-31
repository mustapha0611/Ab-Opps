import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.FREECRYPTO_API_KEY || "";
const CC_API_KEY = process.env.CRYPTOCOMPARE_API_KEY || "";
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

// ─── Exchange Orderbook Fetchers (Free, Public, No Auth) ────────────────────

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

const OB_TIMEOUT = 100000; // 10s timeout

/** Binance: GET /api/v3/depth?symbol=BTCUSDT&limit=20 */
async function fetchOrderbookBinance(baseSymbol: string): Promise<OrderbookData> {
  const symbol = `${baseSymbol.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`;
  const r = await fetch(url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
  if (!r.ok) throw new Error(`Binance orderbook ${r.status} for ${symbol}`);
  const data = (await r.json()) as any;
  return {
    exchange: "binance", symbol: baseSymbol,
    asks: (data.asks || []).map((a: any) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
    bids: (data.bids || []).map((b: any) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
    timestamp: new Date().toISOString(),
  };
}

/** Bybit: GET /v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=20 */
async function fetchOrderbookBybit(baseSymbol: string): Promise<OrderbookData> {
  const symbol = `${baseSymbol.toUpperCase()}USDT`;
  // Use api.bytick.com to bypass local network blocks
  const url = `https://api.bytick.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=20`;
  const r = await fetch(url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
  if (!r.ok) throw new Error(`Bybit orderbook ${r.status} for ${symbol}`);
  const data = (await r.json()) as any;
  const result = data.result || {};
  return {
    exchange: "bybit", symbol: baseSymbol,
    asks: (result.a || []).map((a: any) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
    bids: (result.b || []).map((b: any) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
    timestamp: new Date().toISOString(),
  };
}

/** KuCoin: GET /api/v1/market/orderbook/level2_20?symbol=BTC-USDT */
async function fetchOrderbookKucoin(baseSymbol: string): Promise<OrderbookData> {
  const symbol = `${baseSymbol.toUpperCase()}-USDT`;
  const url = `https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=${symbol}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
  if (!r.ok) throw new Error(`KuCoin orderbook ${r.status} for ${symbol}`);
  const data = (await r.json()) as any;
  const d = data.data || {};
  return {
    exchange: "kucoin", symbol: baseSymbol,
    asks: (d.asks || []).map((a: any) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
    bids: (d.bids || []).map((b: any) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
    timestamp: new Date().toISOString(),
  };
}

/** MEXC: GET /api/v3/depth?symbol=BTCUSDT&limit=20 */
async function fetchOrderbookMexc(baseSymbol: string): Promise<OrderbookData> {
  const symbol = `${baseSymbol.toUpperCase()}USDT`;
  const url = `https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=20`;
  const r = await fetch(url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
  if (!r.ok) throw new Error(`MEXC orderbook ${r.status} for ${symbol}`);
  const data = (await r.json()) as any;
  return {
    exchange: "mexc", symbol: baseSymbol,
    asks: (data.asks || []).map((a: any) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
    bids: (data.bids || []).map((b: any) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
    timestamp: new Date().toISOString(),
  };
}

/** Bitget: GET /api/v2/spot/market/orderbook?symbol=BTCUSDT&limit=20 */
async function fetchOrderbookBitget(baseSymbol: string): Promise<OrderbookData> {
  const symbol = `${baseSymbol.toUpperCase()}USDT`;
  const url = `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${symbol}&limit=20`;
  const r = await fetch(url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
  if (!r.ok) throw new Error(`Bitget orderbook ${r.status} for ${symbol}`);
  const data = (await r.json()) as any;
  const d = data.data || {};
  return {
    exchange: "bitget", symbol: baseSymbol,
    asks: (d.asks || []).map((a: any) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
    bids: (d.bids || []).map((b: any) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
    timestamp: new Date().toISOString(),
  };
}

/** Gate.io: GET /api/v4/spot/order_book?currency_pair=BTC_USDT&limit=20 */
async function fetchOrderbookGate(baseSymbol: string): Promise<OrderbookData> {
  const pair = `${baseSymbol.toUpperCase()}_USDT`;
  const url = `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${pair}&limit=20`;
  const r = await fetch(url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
  if (!r.ok) throw new Error(`Gate.io orderbook ${r.status} for ${pair}`);
  const data = (await r.json()) as any;
  return {
    exchange: "gate", symbol: baseSymbol,
    asks: (data.asks || []).map((a: any) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
    bids: (data.bids || []).map((b: any) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
    timestamp: new Date().toISOString(),
  };
}

/** Coinbase: GET /api/v3/brokerage/market/product_book?product_id=BTC-USDT&limit=20 */
async function fetchOrderbookCoinbase(baseSymbol: string): Promise<OrderbookData> {
  const productId = `${baseSymbol.toUpperCase()}-USDT`;
  const url = `https://api.coinbase.com/api/v3/brokerage/market/product_book?product_id=${productId}&limit=20`;
  const r = await fetch(url, { signal: AbortSignal.timeout(OB_TIMEOUT) });
  if (!r.ok) throw new Error(`Coinbase orderbook ${r.status} for ${productId}`);
  const data = (await r.json()) as any;
  const book = data.pricebook || {};
  return {
    exchange: "coinbase", symbol: baseSymbol,
    asks: (book.asks || []).map((a: any) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })),
    bids: (book.bids || []).map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })),
    timestamp: new Date().toISOString(),
  };
}

/**
 * CryptoCompare (Aggregator): For exchanges blocked in your network (Binance, Kucoin, Bitget, Coinbase)
 * Requires CRYPTOCOMPARE_API_KEY in .env
 */
async function fetchOrderbookCryptoCompare(exchange: string, baseSymbol: string): Promise<OrderbookData> {
  if (!CC_API_KEY) {
    throw new Error(`CRYPTOCOMPARE_API_KEY not configured. Required for ${exchange} analysis.`);
  }

  // CC exchange IDs are usually capitalized
  const ccExchange = exchange === "gate" ? "Gateio" : exchange.charAt(0).toUpperCase() + exchange.slice(1);
  const url = `https://min-api.cryptocompare.com/data/ob/l2/snapshot?e=${ccExchange}&fsym=${baseSymbol.toUpperCase()}&tsym=USDT`;

  console.log(`[Aggregator] Fetching ${baseSymbol} from ${ccExchange} via CryptoCompare...`);

  const r = await fetch(url, {
    headers: { "Authorization": `Apikey ${CC_API_KEY}` },
    signal: AbortSignal.timeout(OB_TIMEOUT)
  });

  if (!r.ok) throw new Error(`CryptoCompare returned ${r.status} for ${ccExchange}:${baseSymbol}`);

  const data = (await r.json()) as any;
  if (data.Response === "Error") {
    throw new Error(`CryptoCompare Error: ${data.Message}`);
  }

  const ob = data.Data || {};
  return {
    exchange,
    symbol: baseSymbol,
    asks: (ob.Asks || []).slice(0, 20).map((a: any) => ({ price: parseFloat(a[0]), size: parseFloat(a[1]) })),
    bids: (ob.Bids || []).slice(0, 20).map((b: any) => ({ price: parseFloat(b[0]), size: parseFloat(b[1]) })),
    timestamp: new Date().toISOString(),
  };
}

/** Unified dispatcher: fetch orderbook from any supported exchange */
const ORDERBOOK_FETCHERS: Record<string, (symbol: string) => Promise<OrderbookData>> = {
  bybit: fetchOrderbookBybit,
  mexc: fetchOrderbookMexc,
  gate: fetchOrderbookGate,
};

async function fetchOrderbook(exchange: string, baseSymbol: string): Promise<OrderbookData> {
  const normalizedEx = exchange.toLowerCase();

  // 1. Direct fetchers for working exchanges
  const directFetcher = ORDERBOOK_FETCHERS[normalizedEx];
  if (directFetcher) {
    console.log(`[Orderbook] Direct fetch for ${baseSymbol} from ${exchange}...`);
    try {
      return await directFetcher(baseSymbol);
    } catch (err: any) {
      console.warn(`[Orderbook] Direct fetch failed for ${exchange}, falling back to aggregator: ${err.message}`);
      // Fall through to aggregator if direct fails (only for Bybit/MEXC/Gate)
    }
  }

  // 2. Use CryptoCompare aggregator for everything else or as fallback
  return fetchOrderbookCryptoCompare(normalizedEx, baseSymbol);
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
    const sellRevenue = buyResult.totalUnits * effectiveSellPrice;
    const sellFeeUsd = sellRevenue * (sellFeePct / 100);
    const totalFeesUsd = buyFeeUsd + sellFeeUsd + withdrawalFee;

    const grossProfitUsd = sellRevenue - buyCost;
    const netProfitUsd = grossProfitUsd - totalFeesUsd;
    const netProfitPct = buyCost > 0 ? (netProfitUsd / buyCost) * 100 : 0;
    const roiPct = netProfitPct;

    const feasible = netProfitUsd > 0 && buyResult.filledUsd >= investmentUsd * 0.9;

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
      reason: feasible ? "Profitable after fees and slippage" : netProfitUsd <= 0 ? "Fees exceed profit" : "Partial fill only",
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

// Orderbook endpoint: fetch depth directly from exchange APIs (free, no auth)
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
    console.error("[Server] Orderbook fetch failed:", err.message);
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

    // Step 1: Fetch Orderbooks from exchange APIs
    const [buyOrderbook, sellOrderbook] = await Promise.all([
      fetchOrderbook(buyExchange, symbol),
      fetchOrderbook(sellExchange, symbol),
    ]);

    // Step 2-8: Run full analysis pipeline
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

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ARBHUNT Backend");
  console.log(`  Port: ${PORT}`);
  console.log(`  FreeCrypto Key: ${API_KEY ? "configured" : "MISSING"}`);
  console.log(`  Orderbooks: Direct exchange APIs (free, no auth)`);
  console.log(`  Exchanges: ${EXCHANGES.join(", ")}`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`\n[Server] Running on http://localhost:${PORT}\n`);
});
