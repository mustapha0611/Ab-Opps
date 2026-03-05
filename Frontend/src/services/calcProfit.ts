import { getExchangeFee } from "@/types/exchangeFess";

/**
 * Calculate the net profit after trading fees for an arbitrage opportunity.
 *
 * @param buyPrice   - Price to buy at
 * @param sellPrice  - Price to sell at
 * @param buyExchange  - Exchange to buy on (for fee lookup)
 * @param sellExchange - Exchange to sell on (for fee lookup)
 * @returns Object with gross and net profit details
 */
export function calcProfit(
  buyPrice: number,
  sellPrice: number,
  buyExchange: string,
  sellExchange: string
) {
  const buyFeePct = getExchangeFee(buyExchange);
  const sellFeePct = getExchangeFee(sellExchange);

  const grossSpread = sellPrice - buyPrice;
  const grossSpreadPct = (grossSpread / buyPrice) * 100;

  // Net: subtract buy fee and sell fee
  const buyCost = buyPrice * (1 + buyFeePct / 100);
  const sellRevenue = sellPrice * (1 - sellFeePct / 100);
  const netSpread = sellRevenue - buyCost;
  const netSpreadPct = (netSpread / buyCost) * 100;

  return {
    grossSpread,
    grossSpreadPct: Math.round(grossSpreadPct * 100) / 100,
    netSpread,
    netSpreadPct: Math.round(netSpreadPct * 100) / 100,
    buyFeePct,
    sellFeePct,
    totalFeesPct: Math.round((buyFeePct + sellFeePct) * 100) / 100,
  };
}
