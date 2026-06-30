import axios from "axios";
import type { ArbitrageOpportunity, AnalysisResult } from "@/types/crypto";

const API_URL = import.meta.env.VITE_API_URL || "";

/**
 * Call the backend analysis endpoint for a specific opportunity.
 * This fetches orderbooks from CoinAPI and runs the full pipeline:
 * Orderbook → Liquidity → Depth Sim → Slippage → Fees → Profit → Decision
 */
export async function analyzeOpportunity(
  opp: ArbitrageOpportunity,
  investmentAmounts: number[] = [100, 200, 500, 1000, 5000]
): Promise<AnalysisResult> {
  const response = await axios.post<AnalysisResult>(
    `${API_URL}/api/analyze-opportunity`,
    {
      symbol: opp.symbol,
      buyExchange: opp.buyExchange,
      sellExchange: opp.sellExchange,
      buyPrice: opp.buyPrice,
      sellPrice: opp.sellPrice,
      investmentAmounts,
    }
  );
  return response.data;
}
