import type { ExchangePrice } from "@/types/crypto";

/**
 * Find the price for a specific symbol on a specific exchange.
 */
export function findPairPrice(
  prices: ExchangePrice[],
  symbol: string,
  exchange: string
): ExchangePrice | undefined {
  return prices.find(
    (p) =>
      p.symbol.toUpperCase() === symbol.toUpperCase() &&
      p.exchange.toLowerCase() === exchange.toLowerCase()
  );
}

/**
 * Get all prices for a given symbol across all exchanges.
 */
export function getPricesForSymbol(
  prices: ExchangePrice[],
  symbol: string
): ExchangePrice[] {
  return prices.filter(
    (p) => p.symbol.toUpperCase() === symbol.toUpperCase()
  );
}
