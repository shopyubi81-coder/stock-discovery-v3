// 네이버 금융 모바일 API — per-ticker 일별 시세 히스토리 (모멘텀 계산용).
// Node 서버사이드 직접 호출(CORS 무관). 브라우저용은 supabase/functions/fetch-naver.
//
// 주의: 비공식 API → 변경·차단 가능. 실패 시 호출부에서 폴백.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => Number(String(s ?? '').replace(/,/g, '')) || 0;
const H = { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' } };

// 시총순 유니버스 — 코스피+코스닥에서 시총 minCap 이상 상위 limit 종목.
// (KRX MDC 는 봇 차단(LOGOUT)이라 네이버 시총 랭킹 API 사용)
//   minCap: 원 단위 / 네이버 marketValue 는 억원 단위 문자열
export async function fetchUniverse({ minCap = 5e10, limit = 300, maxPages = 6 } = {}) {
  const cand = [];
  for (const market of ['KOSPI', 'KOSDAQ']) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`;
      const res = await fetch(url, H);
      if (!res.ok) break;
      const { stocks = [] } = await res.json();
      if (!stocks.length) break;
      let belowAll = true;
      for (const s of stocks) {
        // ETF/ETN/리츠 등 제외 — 보통주만 (stockEndType === 'stock')
        if (s.stockEndType !== 'stock') continue;
        // 우선주·스팩 제외 (보통주 발굴 집중)
        if (/(우|우B|우C)$|스팩/.test(s.stockName || '')) continue;
        const cap = num(s.marketValueRaw);           // 원 단위 raw
        if (cap >= minCap) {
          belowAll = false;
          cand.push({
            ticker: s.itemCode, name: s.stockName, market,
            sector: null, market_cap: cap,
            close: num(s.closePriceRaw), is_active: true,
          });
        }
      }
      if (belowAll) break;                           // 이 시총 이하만 남음 → 다음 시장
      await sleep(80);
    }
  }
  cand.sort((a, b) => b.market_cap - a.market_cap);
  return cand.slice(0, limit);
}

// ticker 의 최근 N일 OHLCV (pageSize 최대치 활용)
export async function fetchHistory(ticker, pages = 3) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const url = `https://m.stock.naver.com/api/stock/${ticker}/price?pageSize=30&page=${p}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' },
    });
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;
    for (const d of rows) {
      const close = num(d.closePrice);
      const volume = num(d.accumulatedTradingVolume);
      out.push({
        ticker,
        date: d.localTradedAt,                 // YYYY-MM-DD
        open: num(d.openPrice), high: num(d.highPrice), low: num(d.lowPrice),
        close, volume, value: close * volume,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// 여러 종목을 throttle 하며 순차 수집 (네이버 차단 방지)
export async function fetchHistoryMany(tickers, { pages = 3, delayMs = 120, onProgress } = {}) {
  const all = [];
  for (let i = 0; i < tickers.length; i++) {
    try {
      const rows = await fetchHistory(tickers[i], pages);
      all.push(...rows);
    } catch (e) {
      console.warn(`  ! ${tickers[i]} 히스토리 실패: ${e.message}`);
    }
    onProgress?.(i + 1, tickers.length);
    await sleep(delayMs);
  }
  return all;
}

const toDate = (yyyymmdd) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
const pct = (s) => Number(String(s ?? '').replace(/[%,배원조억]/g, '').replace(/,/g, '')) || 0;

// /integration 한 콜 → 펀더멘털(PER/PBR/EPS) + 최근 수급(외국인·기관 순매수)
export async function fetchIntegration(ticker) {
  const res = await fetch(
    `https://m.stock.naver.com/api/stock/${ticker}/integration`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' } });
  if (!res.ok) throw new Error(`integration ${res.status}`);
  const j = await res.json();

  // 펀더멘털
  const info = Object.fromEntries((j.totalInfos || []).map((x) => [x.code, x.value]));
  const fundamentals = {
    per: pct(info.per), pbr: pct(info.pbr), eps: pct(info.eps),
    foreign_rate: pct(info.foreignRate),
  };
  // 수급 (최근 ~5영업일)
  const supply = (j.dealTrendInfos || []).map((d) => ({
    ticker, date: toDate(d.bizdate),
    foreign_net: num(d.foreignerPureBuyQuant),
    inst_net: num(d.organPureBuyQuant),
    retail_net: num(d.individualPureBuyQuant),
  })).sort((a, b) => a.date.localeCompare(b.date));

  // 업종코드 (네이버는 한글 업종명 미제공 → 코드로 섹터 그룹핑)
  const sector_code = j.industryCode != null ? String(j.industryCode) : null;

  return { fundamentals, supply, sector_code };
}

// /finance/annual → 최근 '확정'연도 재무지표 (영업이익률·ROE·부채비율). DART 키 불필요.
export async function fetchFinance(ticker) {
  const res = await fetch(
    `https://m.stock.naver.com/api/stock/${ticker}/finance/annual`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' } });
  if (!res.ok) throw new Error(`finance ${res.status}`);
  const fi = (await res.json()).financeInfo;
  if (!fi?.trTitleList?.length) return {};
  // 컨센서스(추정, isConsensus==='Y') 제외한 마지막 확정 연도 컬럼
  const confirmed = fi.trTitleList.filter((t) => t.isConsensus !== 'Y');
  const key = (confirmed.at(-1) || fi.trTitleList.at(-1)).key;
  const get = (title) => {
    const row = fi.rowList.find((r) => r.title === title);
    const v = row?.columns?.[key]?.value;
    return v && v !== '-' ? num(v) : null;
  };
  return { op_margin: get('영업이익률'), roe: get('ROE'), debt_ratio: get('부채비율') };
}

// 동시성 풀 — n개씩 병렬 처리(네이버 과부하 방지). 각 작업 사이 jitter.
async function mapPool(items, n, fn, onDone) {
  const out = new Array(items.length);
  let idx = 0, done = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
      onDone?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// 유니버스 1패스 수집: 종목별 [60일 시세 + 펀더(PER/PBR/EPS+영업이익률/ROE/부채) + 수급].
// price(3p)+integration(1)+finance(1) = 종목당 5콜, concurrency 풀로 가속.
export async function fetchBundleMany(tickers, { pages = 3, concurrency = 4, onProgress } = {}) {
  const quotes = [], supply = [];
  const funda = new Map();
  await mapPool(tickers, concurrency, async (t) => {
    try {
      const [q, ig, fin] = await Promise.all([
        fetchHistory(t, pages), fetchIntegration(t), fetchFinance(t).catch(() => ({})),
      ]);
      quotes.push(...q);
      supply.push(...ig.supply);
      funda.set(t, { ...ig.fundamentals, ...fin, sector_code: ig.sector_code });
    } catch (e) {
      console.warn(`  ! ${t} 수집 실패: ${e.message}`);
    }
    await sleep(40 + Math.random() * 60);
  }, onProgress);
  return { quotes, supply, funda };
}

// ── ETF ────────────────────────────────────────────────────────
// 시총순 ETF 유니버스 (stockEndType==='etf')
export async function fetchEtfUniverse({ minCap = 1e10, limit = 120, maxPages = 8 } = {}) {
  const cand = [];
  for (const market of ['KOSPI', 'KOSDAQ']) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`;
      const res = await fetch(url, H);
      if (!res.ok) break;
      const { stocks = [] } = await res.json();
      if (!stocks.length) break;
      let below = true;
      for (const s of stocks) {
        if (s.stockEndType !== 'etf') continue;
        const cap = num(s.marketValueRaw);
        if (cap >= minCap) { below = false; cand.push({ ticker: s.itemCode, name: s.stockName, market, market_cap: cap }); }
        else below = below && true;
      }
      await sleep(80);
    }
  }
  cand.sort((a, b) => b.market_cap - a.market_cap);
  return cand.slice(0, limit);
}

// /etfAnalysis → ETF 기본정보·NAV·괴리율·보수·분배·기간수익률·구성종목·섹터/국가
export async function fetchEtfAnalysis(ticker) {
  const res = await fetch(`https://m.stock.naver.com/api/stock/${ticker}/etfAnalysis`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' } });
  if (!res.ok) throw new Error(`etfAnalysis ${res.status}`);
  const j = await res.json();
  const ret = Object.fromEntries((j.returnPerformanceList || []).map((x) => [x.periodTypeCode, x.value]));
  return {
    issuer: (j.issuerName || '').replace(/\(ETF\)/, ''), baseIndex: j.etfBaseIndex || null, listedDate: j.listedDate || null,
    nav: Number(j.nav) || null, deviation: Number(j.deviationRate) || 0,
    fee: Number(j.totalFee) || null, trackErr: Number(j.chaseErrorRate) || null,
    ret1m: ret.M1 ?? null, ret3m: ret.M3 ?? null, ret1y: ret.Y1 ?? null,
    divYield: j.dividend?.dividendYieldTtm ?? null,
    top10: (j.etfTop10MajorConstituentAssets || []).map((x) => ({ code: x.itemCode, name: x.itemName, weight: pct(x.etfWeight) })),
    sectors: (j.sectorPortfolioList || []).map((x) => ({ name: x.detailTypeCode, weight: x.weight })),
    countries: (j.countryPortfolioList || []).map((x) => ({ name: x.detailTypeCode, weight: x.weight })),
  };
}

// ETF 1패스: price(60일) + etfAnalysis
export async function fetchEtfBundleMany(tickers, { pages = 3, concurrency = 4, onProgress } = {}) {
  const quotes = [], meta = new Map();
  await mapPool(tickers, concurrency, async (t) => {
    try {
      const [q, a] = await Promise.all([fetchHistory(t, pages), fetchEtfAnalysis(t)]);
      quotes.push(...q); meta.set(t, a);
    } catch (e) { console.warn(`  ! ${t} ETF 수집 실패: ${e.message}`); }
    await sleep(40 + Math.random() * 60);
  }, onProgress);
  return { quotes, meta };
}
