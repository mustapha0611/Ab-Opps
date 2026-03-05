// CoinGecko API helper (optional fallback for price data)
// Currently unused - backend uses FreeCryptoAPI instead.

import axios from "axios";

const COINGECKO_URL = "https://api.coingecko.com/api/v3";

/**
 * Fetch simple price for a list of coin IDs.
 */
export async function fetchCoinGeckoPrices(
  ids: string[],
  vsCurrency = "usd"
): Promise<Record<string, { usd: number }>> {
  const response = await axios.get(`${COINGECKO_URL}/simple/price`, {
    params: {
      ids: ids.join(","),
      vs_currencies: vsCurrency,
    },
  });
  return response.data;
}
