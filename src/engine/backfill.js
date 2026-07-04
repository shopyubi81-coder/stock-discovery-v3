// 백필 — "그날 프로그램을 돌렸다면 뭐가 뽑혔을까"를 소급 재구성해 발굴 이력 생성.
// 이미 받아둔 60일 시세·수급에서 날짜별로 데이터를 잘라 buildDayLists 를 그대로 실행한다.
//
//   실행:  npm run backfill                          (기본: 14일 전부터)
//          BACKFILL_START=2026-06-15 npm run backfill
//
//   산출:  data/discover-history.json (기존 이력을 대체) — 이후 npm run score 로 오늘분 반영
//
//   한계(정직하게): 과거 시점의 펀더멘털(적자 여부 등)은 현재값을 사용하고,
//   유니버스도 "오늘 기준 시총 상위"라서 완전한 과거 재현은 아니다. 추적 관찰 용도로는 충분.

import { readFile, writeFile } from 'node:fs/promises';
import { outPath } from '../lib/paths.js';
import { buildDayLists } from './discover.js';

const read = async (n) => JSON.parse(await readFile(outPath(n), 'utf8'));

// 날짜 D 까지만 남긴 시계열 맵
function truncate(map, D) {
  const out = new Map();
  for (const [t, rows] of map) {
    let i = rows.length;
    while (i > 0 && rows[i - 1].date > D) i--;
    if (i > 0) out.set(t, rows.slice(0, i));
  }
  return out;
}

async function main() {
  const stocks = await read('stocks.json');
  const quotes = await read('quotes.json');
  const supply = await read('supply.json');

  const byTicker = (rows) => {
    const m = new Map();
    for (const r of rows) { (m.get(r.ticker) || m.set(r.ticker, []).get(r.ticker)).push(r); }
    for (const [k, v] of m) {
      v.sort((a, b) => a.date.localeCompare(b.date));
      m.set(k, v.filter((r, i) => i === 0 || r.date !== v[i - 1].date)); // 중복 날짜 방어
    }
    return m;
  };
  const qMap = byTicker(quotes), sMap = byTicker(supply);

  const dates = [...new Set(quotes.map((r) => r.date))].sort();
  const today = dates.at(-1);
  const START = process.env.BACKFILL_START || new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const targets = dates.filter((d) => d >= START && d < today);

  if (!targets.length) {
    console.log(`[backfill] ${START} 이후 재구성할 과거 거래일이 없습니다 (데이터 ${dates[0]} ~ ${today})`);
    return;
  }

  const history = {};
  for (const D of targets) {
    const day = buildDayLists(stocks, truncate(qMap, D), truncate(sMap, D));
    history[D] = Object.fromEntries(Object.entries(day.lists).map(([k, v]) => [k, v.map((r) => r.ticker)]));
    console.log(`  ${D}  수급 ${history[D].supply.length} · 추세 ${history[D].trend.length} · 거래 ${history[D].volume.length}  (통과 ${day.passed}/${day.universe})`);
  }

  await writeFile(outPath('discover-history.json'), JSON.stringify(history));
  console.log(`[backfill] ${targets[0]} ~ ${targets.at(-1)} · ${targets.length}일치 이력 재구성 완료 (기존 이력 대체)`);
  console.log('  → npm run score 를 실행하면 오늘분이 더해지고 추적 관찰·성적표에 반영됩니다');
}

main().catch((e) => { console.error(e); process.exit(1); });
