import type { ExchangePrice, ArbitrageOpportunity } from "@/types/crypto";
import { calcProfit } from "./calcProfit";

/**
 * Take raw exchange prices and compute all arbitrage opportunities.
 * This is a frontend-side calculation that adds fee-adjusted net profit.
 */
export function findArbitrageOpportunities(
  prices: ExchangePrice[]
): ArbitrageOpportunity[] {
  // Group by symbol
  const bySymbol: Record<string, ExchangePrice[]> = {};
  for (const price of prices) {
    if (!bySymbol[price.symbol]) bySymbol[price.symbol] = [];
    bySymbol[price.symbol]!.push(price);
  }

  const opportunities: ArbitrageOpportunity[] = [];

  for (const [symbol, exchangePrices] of Object.entries(bySymbol)) {
    if (exchangePrices.length < 2) continue;

    for (let i = 0; i < exchangePrices.length; i++) {
      for (let j = i + 1; j < exchangePrices.length; j++) {
        const a = exchangePrices[i]!;
        const b = exchangePrices[j]!;

        let buy: ExchangePrice;
        let sell: ExchangePrice;
        if (a.price < b.price) {
          buy = a;
          sell = b;
        } else {
          buy = b;
          sell = a;
        }

        const profit = calcProfit(
          buy.price,
          sell.price,
          buy.exchange,
          sell.exchange
        );

        if (profit.grossSpreadPct > 0.01) {
          opportunities.push({
            symbol,
            pair: `${symbol}/USDT`,
            buyExchange: buy.exchange,
            sellExchange: sell.exchange,
            buyPrice: buy.price,
            sellPrice: sell.price,
            spreadPct: profit.grossSpreadPct,
            spreadUsd: Math.round(profit.grossSpread * 100) / 100,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.spreadPct - a.spreadPct);
}
