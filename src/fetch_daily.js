// A단계 — 일별 시세·수급 수집 → Supabase upsert (+ JSON 폴백 저장)
//
//  실행:  npm run fetch
//  모드:  FETCH_MODE=sample  (기본, 더미 데이터)
//         FETCH_MODE=live    (KRX 전종목 시세 + 네이버 60일 히스토리)
//  주요 env:
//    MIN_MARKET_CAP   시총 하한 (기본 500억)
//    UNIVERSE_LIMIT   히스토리 수집 종목 수 상한 (시총순, 기본 300 — 네이버 콜 제한)
//
// 설계 원칙
//  - 수집 실패 시 전일 데이터 폴백 (대시보드가 비지 않게)
//  - Supabase 키 없으면 data/*.json 으로만 저장 → 키 연결 전에도 동작

import { writeFile, readFile } from 'node:fs/promises';
import { upsert, hasSupabase } from './lib/supabase.js';
import { sampleHistory, TODAY } from './lib/sample.js';
import { fetchUniverse, fetchBundleMany } from './lib/naver.js';
import { resolveSectorNames } from './lib/sector.js';
import { outPath } from './lib/paths.js';

const MODE = process.env.FETCH_MODE || 'sample';
const MIN_CAP = Number(process.env.MIN_MARKET_CAP || 5e10);    // 500억
const UNIVERSE_LIMIT = Number(process.env.UNIVERSE_LIMIT || 400);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);      // 동시 수집 종목 수

async function saveJson(name, obj) {
  await writeFile(outPath(name), JSON.stringify(obj, null, 2));
}

async function loadPrevJson(name) {
  try { return JSON.parse(await readFile(outPath(name), 'utf8')); }
  catch { return null; }
}

async function collectLive() {
  // 1) 네이버 시총순 유니버스 (시총 필터 + 상한)
  console.log('  · 네이버 시총순 유니버스 수집…');
  const rawUniverse = await fetchUniverse({ minCap: MIN_CAP, limit: UNIVERSE_LIMIT });
  // 중복 티커 제거 — 네이버 목록에 간혹 동일 종목이 두 번 등장 (Supabase upsert 21000 에러 방지)
  const seenT = new Set();
  const universe = rawUniverse.filter((s) => !seenT.has(s.ticker) && seenT.add(s.ticker));
  if (universe.length !== rawUniverse.length)
    console.log(`    중복 티커 ${rawUniverse.length - universe.length}건 제거`);
  console.log(`    유니버스 ${universe.length}종목 (시총 ${(MIN_CAP / 1e8).toFixed(0)}억↑, 상한 ${UNIVERSE_LIMIT})`);
  if (!universe.length) return { stocks: [], quotes: [], supply: [] };

  // 2) 종목별 [60일 시세 + 펀더(PER/PBR/EPS+영업이익률/ROE/부채) + 수급] 수집.
  console.log('  · 네이버 시세+펀더+수급 수집… (concurrency)');
  const tickers = universe.map((s) => s.ticker);
  const { quotes, supply, funda } = await fetchBundleMany(tickers, {
    pages: 4, concurrency: CONCURRENCY, // 4페이지 ≈ 120일 — 60일선을 차트 전 구간에 그리기 위함
    onProgress: (i, n) => { if (i % 50 === 0 || i === n) console.log(`    ${i}/${n}`); },
  });

  // 펀더멘털·업종코드를 종목 마스터에 부착 + 업종명 해석(캐시)
  const sectorNames = await resolveSectorNames([...funda.values()].map((f) => f.sector_code));
  const stocks = universe.map(({ close, ...s }) => {
    const f = funda.get(s.ticker) || {};
    return {
      ...s, sector: sectorNames[f.sector_code] ?? null, sector_code: f.sector_code ?? null,
      per: f.per ?? null, pbr: f.pbr ?? null, eps: f.eps ?? null,
      op_margin: f.op_margin ?? null, roe: f.roe ?? null, debt_ratio: f.debt_ratio ?? null,
    };
  });
  return { stocks, quotes, supply };
}

async function main() {
  console.log(`[fetch_daily] mode=${MODE} supabase=${hasSupabase ? 'on' : 'off(json)'} date=${TODAY}`);

  let data = MODE === 'live' ? await collectLive() : sampleHistory(60);

  // 폴백: 이번 수집이 비면 전일 JSON 재사용
  if (!data.quotes.length) {
    const [stocks, quotes, supply] = await Promise.all(
      ['stocks.json', 'quotes.json', 'supply.json'].map(loadPrevJson));
    if (quotes?.length) { console.warn('  ! 수집 0건 → 전일 데이터 폴백'); data = { stocks: stocks || [], quotes, supply: supply || [] }; }
  }

  // 수급 이력 누적 — 네이버는 최근 5일치만 제공하므로 기존 저장분과 병합해 쌓는다 (70일 보관)
  if (data.supply.length) {
    const prev = await loadPrevJson('supply.json');
    if (Array.isArray(prev) && prev.length) {
      const seen = new Set(data.supply.map((r) => r.ticker + '|' + r.date));
      const cutoff = new Date(Date.now() - 70 * 864e5).toISOString().slice(0, 10);
      let merged = 0;
      for (const r of prev) {
        if (r.date >= cutoff && !seen.has(r.ticker + '|' + r.date)) { data.supply.push(r); merged++; }
      }
      if (merged) console.log(`  · 수급 이력 병합: 기존 ${merged}행 유지 (누적 ${data.supply.length}행)`);
    }
  }

  // ticker+date 중복 행 제거 (수집 중복·과거 오염 방어 — Supabase PK 충돌 방지)
  const dedupeRows = (rows) => {
    const s = new Set();
    return rows.filter((r) => {
      const k = r.ticker + '|' + r.date;
      if (s.has(k)) return false;
      s.add(k); return true;
    });
  };
  data.quotes = dedupeRows(data.quotes);
  data.supply = dedupeRows(data.supply);

  // JSON 폴백 저장 (항상)
  await saveJson('stocks.json', data.stocks);
  await saveJson('quotes.json', data.quotes);
  await saveJson('supply.json', data.supply);

  // Supabase upsert — stocks 는 스키마에 있는 기본 컬럼만 전송.
  // (per/pbr/roe 등 펀더 원자료는 점수 계산용이라 stocks.json 에만 보관,
  //  결과 점수는 stock_scores 에 저장됨)
  if (hasSupabase) {
    const stockRows = data.stocks.map(({ ticker, name, market, sector, market_cap, is_active }) =>
      ({ ticker, name, market, sector, market_cap, is_active }));
    await upsert('stocks', stockRows);
    await upsert('daily_quotes', data.quotes);
    if (data.supply.length) await upsert('supply_demand', data.supply);
    console.log('  ✓ Supabase upsert 완료');
  } else {
    console.log('  ✓ JSON 저장 완료 (Supabase 키 없음 — .env 설정 시 자동 연동)');
  }

  console.log(`  종목 ${data.stocks.length} · 시세 ${data.quotes.length} · 수급 ${data.supply.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
