const FEE_CACHE_TTL = 5 * 60 * 1000;
const feeCache = new Map<string, { takerFee: number; withdrawalFee: number; fetchedAt: number }>();

const HARDCODED_TAKER: Record<string, number> = {
  binance: 0.10,
  bybit: 0.10,
  kucoin: 0.10,
  bitget: 0.10,
  mexc: 0.10,
  coinbase: 0.60,
  gate: 0.15,
};

const HARDCODED_WITHDRAWAL: Record<string, number> = {
  binance: 0.3,
  bybit: 0.3,
  kucoin: 1.0,
  bitget: 1.0,
  mexc: 0.3,
  coinbase: 0.0,
  gate: 1.0,
};

const KUCOIN_DOMAINS = [
  "api.kucoin.com",
  "api-sg.kucoin.com",
  "api-us.kucoin.com",
  "api.kucoin.net",
  "api-sg.kucoin.net",
];

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
        if (data && (data.code === "200000" || data.code === 200000 || !data.code)) {
          return data;
        }
      }
    } catch { }
  }
  return null;
}

async function fetchBinanceTakerFee(): Promise<number | null> {
  try {
    const r = await fetch("https://api.binance.com/api/v3/exchangeInfo", {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data?.takerCommission !== undefined) {
      return data.takerCommission / 100;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchMexcTakerFee(): Promise<number | null> {
  try {
    const r = await fetch("https://api.mexc.com/api/v3/exchangeInfo", {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data?.takerCommission !== undefined) {
      return data.takerCommission / 100;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchBitgetTakerFee(): Promise<number | null> {
  try {
    const r = await fetch("https://api.bitget.com/api/v2/spot/market/vip-fee-rate", {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const rates = data?.data?.[0];
    if (rates?.takerFeeRate) {
      return parseFloat(rates.takerFeeRate) * 100;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchKucoinWithdrawalFee(): Promise<number | null> {
  try {
    const data = await fetchKucoin("/api/v3/currencies/USDT");
    if (!data?.data) return null;
    const chains = Array.isArray(data.data) ? data.data : [data.data];
    let minFee = Infinity;
    for (const chain of chains) {
      const fee = parseFloat(chain.withdrawalMinFee || "0");
      if (fee > 0 && fee < minFee) minFee = fee;
    }
    return minFee < Infinity ? minFee : null;
  } catch {
    return null;
  }
}

async function fetchBitgetWithdrawalFee(): Promise<number | null> {
  try {
    const r = await fetch("https://api.bitget.com/api/v2/spot/public/coins?coin=USDT", {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const coin = data?.data?.[0];
    if (!coin?.chains) return null;
    let minFee = Infinity;
    for (const chain of coin.chains) {
      const fee = parseFloat(chain.withdrawFee || "0");
      if (fee > 0 && fee < minFee) minFee = fee;
    }
    return minFee < Infinity ? minFee : null;
  } catch {
    return null;
  }
}

export interface ExchangeFeeInfo {
  takerFee: number;
  withdrawalFee: number;
}

export async function getExchangeFees(exchange: string): Promise<ExchangeFeeInfo> {
  const ex = exchange.toLowerCase();
  const now = Date.now();
  const cached = feeCache.get(ex);
  if (cached && now - cached.fetchedAt < FEE_CACHE_TTL) {
    return { takerFee: cached.takerFee, withdrawalFee: cached.withdrawalFee };
  }

  let takerFee: number | null = null;
  let withdrawalFee: number | null = null;

  switch (ex) {
    case "binance":
      takerFee = await fetchBinanceTakerFee();
      break;
    case "mexc":
      takerFee = await fetchMexcTakerFee();
      break;
    case "bitget":
      takerFee = await fetchBitgetTakerFee();
      withdrawalFee = await fetchBitgetWithdrawalFee();
      break;
    case "kucoin":
      withdrawalFee = await fetchKucoinWithdrawalFee();
      break;
  }

  if (takerFee === null) takerFee = HARDCODED_TAKER[ex] ?? 0.15;
  if (withdrawalFee === null) withdrawalFee = HARDCODED_WITHDRAWAL[ex] ?? 1.0;

  feeCache.set(ex, { takerFee, withdrawalFee, fetchedAt: now });

  if (cached?.takerFee !== takerFee || cached?.withdrawalFee !== withdrawalFee) {
    console.log(`[Fees] ${ex}: taker=${takerFee.toFixed(3)}% withdrawal=$${withdrawalFee.toFixed(2)}`);
  }

  return { takerFee, withdrawalFee };
}

export function clearFeeCache(): void {
  feeCache.clear();
}
