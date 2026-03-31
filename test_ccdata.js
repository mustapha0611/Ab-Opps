
async function test() {
  const url = 'https://min-api.cryptocompare.com/data/ob/l2/snapshot?e=Binance&fsym=BTC&tsym=USDT';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    console.log(`Status: ${r.status}`);
    const data = await r.json();
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}
test();
