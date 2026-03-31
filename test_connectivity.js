
const exchanges = {
  gate: 'https://api.gateio.ws/api/v4/spot/order_book?currency_pair=BTC_USDT&limit=5',
  binance_us: 'https://api.binance.us/api/v3/depth?symbol=BTCUSDT&limit=5',
  bybit_bytick: 'https://api.bytick.com/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=5',
};

async function test() {
  for (const [name, url] of Object.entries(exchanges)) {
    console.log(`Testing ${name}...`);
    try {
      const start = Date.now();
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const duration = Date.now() - start;
      console.log(`  Result: ${r.status} (${duration}ms)`);
      if (name.includes('_ob')) {
        const data = await r.json();
        console.log(`  Data fragment ${name}: ${JSON.stringify(data).substring(0, 500)}`);
      }
    } catch (e) {
      console.log(`  Failed: ${e.message}`);
    }
  }
}

test();
