
async function test() {
  const url = 'https://open-api.coinglass.com/public/v1/quote/orderbook?symbol=BTCUSDT';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    console.log(`Status: ${r.status}`);
    const data = await r.json();
    console.log('Response:', JSON.stringify(data).substring(0, 500));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}
test();
