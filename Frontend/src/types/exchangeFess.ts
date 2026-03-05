/** Trading fee rates per exchange (taker fees in %) */
export const EXCHANGE_FEES: Record<string, number> = {
  binance: 0.1,
  okx: 0.1,
  bybit: 0.1,
  kucoin: 0.1,
  gateio: 0.2,
  bitget: 0.1,
  mexc: 0.1,
  coinbase: 0.6,
};

/**
 * Get the taker fee for an exchange as a percentage.
 * Returns a conservative default of 0.2% if exchange is unknown.
 */
export function getExchangeFee(exchange: string): number {
  return EXCHANGE_FEES[exchange.toLowerCase()] ?? 0.2;
}
