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
