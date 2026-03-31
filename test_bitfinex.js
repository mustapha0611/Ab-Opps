
async function test() {
  const url = 'https://api-pub.bitfinex.com/v2/book/tBTCUSD/P0?len=25';
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
