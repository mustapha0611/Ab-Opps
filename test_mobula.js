
async function test() {
  const url = 'https://api.mobula.io/api/1/market/orderbook?symbol=BTC&exchange=Binance';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    console.log(`Status: ${r.status}`);
    const data = await r.json();
    console.log('Response:', JSON.stringify(data, null, 2).substring(0, 1000));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}
test();
