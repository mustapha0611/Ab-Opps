export interface ExchangePrice {
  exchange: string;
  symbol: string;
  pair: string;
  price: number;
  change24h?: number;
  volume?: number;
  timestamp: number;
}

export interface ArbitrageOpportunity {
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

export interface ScanResult {
  prices: ExchangePrice[];
  opportunities: ArbitrageOpportunity[];
}

// ─── Analysis Pipeline Types ────────────────────────────────────────────────

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface InvestmentTier {
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

export interface LiquidityInfo {
  buyLiquidityUsd: number;
  sellLiquidityUsd: number;
  buyLevels: number;
  sellLevels: number;
  sufficient: boolean;
}

export interface TradeRecommendation {
  decision: "GO" | "NO-GO";
  optimalInvestment: number;
  expectedProfit: number;
  expectedRoi: number;
  reason: string;
}

export interface AnalysisResult {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  orderbook: {
    buyAsks: OrderbookLevel[];
    sellBids: OrderbookLevel[];
  };
  liquidity: LiquidityInfo;
  analysis: InvestmentTier[];
  recommendation: TradeRecommendation;
  timestamp: number;
}

