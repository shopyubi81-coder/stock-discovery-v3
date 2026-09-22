// B단계 — ETF 시총순 유니버스 + NAV/보수/괴리율/구성종목 등 ETF 전용 지표 수집.
//
// naver.js의 fetchEtfUniverse/fetchEtfBundleMany/fetchEtfAnalysis는 이미
// 만들어져 있었지만 daily_batch.cmd 어디에도 호출되는 곳이 없어 죽은
// 코드였다 (2026-09-22, AlphaFactory 쪽 수급 데이터 점검 중 발견).
//
// ETF의 수급(외국인·기관 순매수)은 이 스크립트가 아니라 fetch_daily.js
// 쪽 force_track.js로 이미 별도 확보한다 — /integration 엔드포인트가
// ETF 티커에도 dealTrendInfos를 정상 반환함을 실측 확인했고, 그건
// 주식 파이프라인(quotes/supply, Supabase supply_demand)을 그대로
// 재사용하는 게 가장 간단했기 때문이다. 이 스크립트가 다루는 건 그
// 파이프라인엔 없는 ETF 고유 지표(NAV·괴리율·보수·추적오차·분배수익률·
// 구성종목 top10·섹터/국가 비중)뿐이다 — 역할이 겹치지 않는다.
//
// Supabase: 시세는 fetch_daily.js와 같은 daily_quotes 표에 그대로
// upsert한다(같은 ticker/date/OHLCV 스키마 — 주식이냐 ETF냐로 구분할
// 이유가 없다). daily_quotes.ticker가 stocks.ticker를 참조하는 외래키라서
// (실측 확인, 2026-09-22) ETF도 먼저 stocks에 올려야 한다 — fetchUniverse()가
// stockEndType!=='stock'을 걸러서 정규 스크리닝 유니버스엔 안 들어가지만,
// stocks 표 자체엔 그런 제약이 없다.
//
// ETF 전용 지표(NAV 등)는 새 표 `etfs`가 필요해서 sql/etfs.sql을 Founder가
// Supabase SQL Editor에서 한 번 실행해야 한다(다른 신규 표들과 동일한
// 수동 단계). 표가 아직 없으면 그 upsert만 404로 실패하는데, stocks/
// daily_quotes와 JSON 폴백은 그와 무관하게 먼저 저장되므로 SQL 실행 전에도
// 이 스크립트 자체는 안전하다.
//
// 실행: node src/fetch_etf.js

import { writeFile } from 'node:fs/promises';
import { fetchEtfUniverse, fetchEtfBundleMany } from './lib/naver.js';
import { outPath } from './lib/paths.js';
import { upsert, hasSupabase } from './lib/supabase.js';

const MIN_CAP = Number(process.env.ETF_MIN_MARKET_CAP || 1e10); // 100억
const LIMIT = Number(process.env.ETF_UNIVERSE_LIMIT || 120);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

async function main() {
  console.log(`[fetch_etf] date=${new Date().toISOString().slice(0, 10)}`);

  console.log('  · 네이버 시총순 ETF 유니버스 수집…');
  const universe = await fetchEtfUniverse({ minCap: MIN_CAP, limit: LIMIT });
  console.log(`    유니버스 ${universe.length}종목 (시총 ${(MIN_CAP / 1e8).toFixed(0)}억↑, 상한 ${LIMIT})`);
  if (!universe.length) {
    console.log('  · 유니버스 0건 — 종료');
    return;
  }

  console.log('  · 네이버 시세+ETF지표 수집… (concurrency)');
  const tickers = universe.map((s) => s.ticker);
  const { quotes, meta } = await fetchEtfBundleMany(tickers, {
    pages: 4, concurrency: CONCURRENCY,
    onProgress: (i, n) => { if (i % 30 === 0 || i === n) console.log(`    ${i}/${n}`); },
  });

  const etfs = universe.map((u) => ({ ...u, ...(meta.get(u.ticker) || {}) }));

  await writeFile(outPath('etfs.json'), JSON.stringify(etfs, null, 2));
  await writeFile(outPath('etf-quotes.json'), JSON.stringify(quotes, null, 2));
  console.log(`  종목 ${etfs.length} · 시세 ${quotes.length}`);
  console.log('  ✓ JSON 저장 완료');

  if (hasSupabase) {
    // daily_quotes.ticker는 stocks.ticker를 참조하는 외래키다(실측 확인,
    // 2026-09-22) — ETF는 fetchUniverse()의 stocks 표에 원천 제외되므로
    // 먼저 stocks에 ETF 행을 올려야 daily_quotes upsert가 통과한다.
    const stockRows = universe.map((u) => ({
      ticker: u.ticker, name: u.name, market: u.market,
      sector: null, market_cap: u.market_cap ?? null, is_active: true,
    }));
    await upsert('stocks', stockRows);
    await upsert('daily_quotes', quotes);
    const etfRows = etfs.map((e) => ({
      ticker: e.ticker, name: e.name, market: e.market, market_cap: e.market_cap ?? null,
      issuer: e.issuer ?? null, base_index: e.baseIndex ?? null, listed_date: e.listedDate ?? null,
      nav: e.nav ?? null, deviation: e.deviation ?? null, fee: e.fee ?? null, track_err: e.trackErr ?? null,
      ret_1m: e.ret1m ?? null, ret_3m: e.ret3m ?? null, ret_1y: e.ret1y ?? null, div_yield: e.divYield ?? null,
      top10: e.top10 ?? [], sectors: e.sectors ?? [], countries: e.countries ?? [],
    }));
    try {
      await upsert('etfs', etfRows);
      console.log('  ✓ Supabase upsert 완료 (daily_quotes + etfs)');
    } catch (e) {
      // sql/etfs.sql 이 아직 Supabase에서 실행되기 전이면 여기서 404로
      // 떨어진다 — daily_quotes는 이미 위에서 별도로 upsert했으니 그건
      // 안전하고, etfs 표만 못 쓸 뿐이라 JSON 폴백(etfs.json)으로 계속 확인 가능.
      console.warn(`  ! etfs 표 upsert 실패 (sql/etfs.sql 미실행 가능성): ${e.message}`);
    }
  } else {
    console.log('  (Supabase 키 없음 — JSON 폴백만)');
  }
}

main().catch((e) => {
  console.error('[fetch_etf] FAILED', e);
  process.exitCode = 1;
});
