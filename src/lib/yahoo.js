// Yahoo Finance API 래퍼 — 미국 주식/지수 시세 수집
// 외부 의존성 없음, Node.js fetch 사용

const H = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', Accept: 'application/json' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 단일 종목 시세 (일봉)
//   range: '3mo' | '6mo' | '1y'
//   returns: { meta, quotes: [{date,open,high,low,close,volume}] }
export async function fetchYahooChart(symbol, range = '3mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, H);
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const j = await res.json();
  const result = j.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: 데이터 없음`);

  const ts     = result.timestamp ?? [];
  const quote  = result.indicators?.quote?.[0] ?? {};
  const closes = quote.close ?? [];
  const quotes = ts
    .map((t, i) => ({
      date:   new Date(t * 1000).toISOString().slice(0, 10),
      open:   quote.open?.[i]   ?? null,
      high:   quote.high?.[i]   ?? null,
      low:    quote.low?.[i]    ?? null,
      close:  closes[i]         ?? null,
      volume: quote.volume?.[i] ?? null,
    }))
    .filter((r) => r.close != null);

  return { meta: result.meta, quotes };
}

// 여러 종목 병렬 수집 (concurrency 제한)
export async function fetchYahooMany(symbols, { range = '3mo', concurrency = 5, onProgress } = {}) {
  const results = new Map();
  let idx = 0, done = 0;
  const worker = async () => {
    while (idx < symbols.length) {
      const i = idx++;
      const sym = symbols[i];
      try {
        const data = await fetchYahooChart(sym, range);
        results.set(sym, data);
      } catch (e) {
        console.warn(`  ! Yahoo ${sym}: ${e.message.slice(0, 60)}`);
      }
      onProgress?.(++done, symbols.length);
      await sleep(80 + Math.random() * 80); // rate limit
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return results;
}
