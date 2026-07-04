// 미국(S&P500) 발굴 — 국내와 동일한 엔진(buildDayLists)을 미국 데이터에 적용
//   실행:  npm run score:us   (fetch_us 이후)
//   산출:  discover-us.json + detail-us/{ticker}.json + discover-history-us.json
//
// 미국은 투자자별 수급 데이터가 없어 수급 포착·장기 매집 리스트는 비고,
// 추세 전환·거래 폭발(맥락 분류 포함) 중심으로 동작한다.
// 집중 후보는 buildFocus 의 수급 필수 조건이 자동 완화(후보 부족 시 전체)되어 추세 A급 위주로 뽑힌다.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { outPath } from '../lib/paths.js';
import { REGIME, DISCOVER } from './config.js';
import {
  buildDayLists, freshness, buildTracking, buildRecord, buildFocus,
} from './discover.js';

const read = async (n) => JSON.parse(await readFile(outPath(n), 'utf8'));
const tryRead = async (n) => { try { return await read(n); } catch { return null; } };

async function main() {
  const stocks = await read('stocks-us.json');
  const quotes = await read('quotes-us.json');

  const qMap = new Map();
  for (const r of quotes) { (qMap.get(r.ticker) || qMap.set(r.ticker, []).get(r.ticker)).push(r); }
  for (const [k, v] of qMap) {
    v.sort((a, b) => a.date.localeCompare(b.date));
    qMap.set(k, v.filter((r, i) => i === 0 || r.date !== v[i - 1].date));
  }
  const sMap = new Map(); // 수급 없음
  const today = [...qMap.values()][0]?.at(-1)?.date || new Date().toISOString().slice(0, 10);

  const history = (await tryRead('discover-history-us.json')) || {};
  const histDates = Object.keys(history).filter((d) => d !== today).sort();

  const day = buildDayLists(stocks, qMap, sMap);
  if (!day.universe) { console.error('[discover_us] 유효 종목 0개 — npm run us 먼저'); process.exit(1); }
  const lists = Object.fromEntries(Object.entries(day.lists).map(([key, rows]) =>
    [key, rows.map((r) => ({ ...r, freshDays: freshness(history, histDates, key, r.ticker, today) }))]));

  const nameMap = new Map(stocks.map((s) => [s.ticker, s.name]));
  const nameOf = (t) => nameMap.get(t) || t;
  const tracking = buildTracking(history, histDates, qMap, nameOf, today, lists);
  const record = buildRecord(history, histDates, qMap, today);
  const focus = buildFocus(lists, qMap);

  history[today] = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.map((r) => r.ticker)]));
  const keep = Object.keys(history).sort().slice(-DISCOVER.historyKeep);
  await writeFile(outPath('discover-history-us.json'),
    JSON.stringify(Object.fromEntries(keep.map((d) => [d, history[d]]))));

  const breadth = day.aboveMa20 / day.universe;
  const regime = breadth >= REGIME.riskOnBreadth ? 'strong' : breadth < REGIME.riskOffBreadth ? 'weak' : 'neutral';

  await writeFile(outPath('discover-us.json'), JSON.stringify({
    version: 3, scope: 'us', date: today, generated_at: new Date().toISOString(),
    market: { regime, breadth: Math.round(breadth * 100) },
    filter: { minAmountEok: 100, minMarketCapEok: null, excludeLoss: false, universe: day.universe, passed: day.passed },
    themeFocus: null, focus, lists, tracking, record,
  }, null, 2));

  await mkdir(outPath('detail-us'), { recursive: true });
  const listed = new Set([
    ...Object.values(lists).flat().map((r) => r.ticker),
    ...tracking.map((r) => r.ticker),
  ]);
  for (const ticker of listed) {
    const q = qMap.get(ticker);
    if (!q) continue;
    await writeFile(outPath(`detail-us/${ticker}.json`), JSON.stringify({
      ticker, name: nameOf(ticker),
      quotes: q.slice(-120).map((r) => ({ date: r.date, close: r.close, volume: r.volume })),
      supply: [],
    }));
  }

  console.log(`[discover_us] ${today} · 유니버스 ${day.universe} → 통과 ${day.passed}`);
  console.log(`  추세 ${lists.trend.length} · 거래폭발 ${lists.volume.length} · 시장 ${regime}(${Math.round(breadth * 100)}%)`);
  for (const f of focus) console.log(`  🎯 ${f.name} [${f.hits.join('+')}] — ${f.reasons[0]}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
