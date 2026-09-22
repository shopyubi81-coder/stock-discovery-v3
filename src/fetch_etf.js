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
// Supabase 테이블 없음 — 새 스키마를 만들려면 Founder가 SQL Editor에서
// 직접 실행해야 하는 수동 단계라(이 프로젝트의 다른 신규 테이블들과 동일
// 패턴), 지금은 JSON 폴백만 저장한다. 나중에 테이블이 생기면 이 스크립트
// 끝에 upsert 호출 한 줄만 추가하면 된다.
//
// 실행: node src/fetch_etf.js

import { writeFile } from 'node:fs/promises';
import { fetchEtfUniverse, fetchEtfBundleMany } from './lib/naver.js';
import { outPath } from './lib/paths.js';

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
  console.log('  ✓ JSON 저장 완료 (Supabase 테이블 없음 — 신설 시 이 스크립트 그대로 재사용 가능)');
}

main().catch((e) => {
  console.error('[fetch_etf] FAILED', e);
  process.exitCode = 1;
});
