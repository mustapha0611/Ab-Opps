
async function test() {
  const url = 'https://api.coingecko.com/api/v3/exchanges/binance/tickers?coin_ids=bitcoin';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    console.log(`Status: ${r.status}`);
    const data = await r.json();
    console.log('Response:', JSON.stringify(data).substring(0, 1000));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}
test();
