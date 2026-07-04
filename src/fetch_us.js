// 미국(S&P500) 종목 수집 — 국내와 동일한 발굴 프레임에 태우기 위한 V3 스키마 산출
//   실행:  npm run us
//   산출:  stocks-us.json / quotes-us.json  (supply 는 미국 데이터 미제공 → 빈 배열)
//
// 소스: Yahoo Finance 비공식 API (의존성 0) + S&P500 구성종목 공개 CSV
// 거래대금은 원화 환산(환율 market-extra.json 참조)해서 국내와 같은 "억원" 필터를 그대로 쓴다.

import { readFile, writeFile } from 'node:fs/promises';
import { outPath } from './lib/paths.js';
import { fetchYahooMany } from './lib/yahoo.js';

const SECTOR_KO = {
  'Information Technology': 'IT/기술', 'Health Care': '헬스케어', 'Financials': '금융',
  'Consumer Discretionary': '소비재(임의)', 'Consumer Staples': '필수소비재',
  'Industrials': '산업재', 'Energy': '에너지', 'Utilities': '유틸리티',
  'Real Estate': '리츠/부동산', 'Materials': '소재', 'Communication Services': '커뮤니케이션',
};

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function fetchSP500Universe() {
  const url = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
  if (!res.ok) throw new Error(`S&P500 목록 HTTP ${res.status}`);
  const lines = (await res.text()).trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const iSym = header.indexOf('Symbol'), iName = header.indexOf('Security'), iSector = header.indexOf('GICS Sector');
  if (iSym < 0) throw new Error('S&P500 CSV 형식 변경(Symbol 컬럼 없음)');
  return lines.slice(1).filter((l) => l.trim()).map((l) => {
    const c = parseCsvLine(l);
    return {
      symbol: c[iSym]?.trim().replace(/\./g, '-'),
      name: c[iName]?.trim() || c[iSym],
      sector: SECTOR_KO[c[iSector]?.trim()] || c[iSector]?.trim() || '기타',
    };
  }).filter((s) => s.symbol);
}

async function main() {
  // 환율 (거래대금 원화 환산용) — 없으면 1,400 가정
  let fxRate = 1400;
  try { fxRate = JSON.parse(await readFile(outPath('market-extra.json'), 'utf8')).fx?.rate || 1400; } catch {}

  console.log('[fetch_us] S&P500 유니버스 수집…');
  const universe = await fetchSP500Universe();
  console.log(`  ${universe.length}종목 · 환율 ${fxRate}원 적용`);

  const charts = await fetchYahooMany(universe.map((s) => s.symbol), {
    range: '6mo', concurrency: 6,
    onProgress: (n, t) => { if (n % 100 === 0 || n === t) console.log(`  ${n}/${t}`); },
  });

  const stocks = [], quotes = [];
  for (const s of universe) {
    const data = charts.get(s.symbol);
    if (!data || data.quotes.length < 30) continue;
    stocks.push({
      ticker: s.symbol, name: s.name, market: 'US', sector: s.sector,
      market_cap: 1e13, // S&P500 은 전부 초대형주 — 국내 시총 필터를 통과시키기 위한 표기값
      is_active: true,
    });
    for (const q of data.quotes.slice(-130)) {
      quotes.push({
        ticker: s.symbol, date: q.date, close: q.close, volume: q.volume || 0,
        high: q.high ?? q.close, low: q.low ?? q.close, // CMF(매집 프록시) 계산용
        value: (q.close || 0) * (q.volume || 0) * fxRate, // 원화 환산 거래대금
      });
    }
  }

  await writeFile(outPath('stocks-us.json'), JSON.stringify(stocks));
  await writeFile(outPath('quotes-us.json'), JSON.stringify(quotes));
  await writeFile(outPath('supply-us.json'), '[]'); // 미국은 투자자별 수급 미제공
  console.log(`[fetch_us] 종목 ${stocks.length} · 시세 ${quotes.length}행 저장`);
}

main().catch((e) => { console.error('[fetch_us]', e.message); process.exit(1); });
