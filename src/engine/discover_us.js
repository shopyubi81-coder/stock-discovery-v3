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
import { obv } from './indicators.js';
import {
  buildDayLists, freshness, buildTracking, buildRecord, buildFocus,
} from './discover.js';

// ── 수급 프록시 — 미국은 투자자별 수급이 비공개라 가격·거래량 지문으로 기관성 매집을 추정 ──
// CMF(Chaikin Money Flow): 종가가 일중 범위 어디서 끝났는지 × 거래량. +면 고가권 마감이 잦음 = 매집 신호.
function cmf(rows, n) {
  let mfv = 0, vol = 0;
  for (const r of rows.slice(-n)) {
    const range = (r.high ?? r.close) - (r.low ?? r.close);
    if (!range || !r.volume) continue;
    mfv += ((r.close - r.low) - (r.high - r.close)) / range * r.volume;
    vol += r.volume;
  }
  return vol ? mfv / vol : 0;
}

// 최근 n일 동안 상승일 거래량 ÷ 하락일 거래량 — 1.3배↑면 매수 우위
function upDownVolRatio(rows, n) {
  const win = rows.slice(-(n + 1));
  let up = 0, down = 0;
  for (let i = 1; i < win.length; i++) {
    if (win[i].close > win[i - 1].close) up += win[i].volume;
    else if (win[i].close < win[i - 1].close) down += win[i].volume;
  }
  return down ? up / down : (up ? 9 : 1);
}

function buildProxySupply(stocks, qMap) {
  const supply = [], steady = [];
  for (const s of stocks) {
    const q = qMap.get(s.ticker);
    if (!q || q.length < 61) continue;
    const closes = q.map((r) => r.close);
    const last = closes.at(-1);
    const c20 = cmf(q, 20), c60 = cmf(q, 60);
    const udr = upDownVolRatio(q, 20);
    const o = obv(q);
    const hi60 = Math.max(...closes.slice(-60)), lo60 = Math.min(...closes.slice(-60));
    const pos = hi60 > lo60 ? (last - lo60) / (hi60 - lo60) : 0.5;
    const runup20 = last / closes.at(-21) - 1;
    const base = {
      ticker: s.ticker, name: s.name, market: s.market, sector: s.sector,
      change: Math.round((last / closes.at(-2) - 1) * 1000) / 10,
      amountEok: Math.round((q.at(-1).value || 0) / 1e8),
    };

    // 단기 매집 프록시 (수급 포착 탭)
    if (c20 >= 0.12 && (udr >= 1.25 || o?.rising)) {
      let grade = 'B', warn = false;
      const reasons = [`매집 프록시 — 20일 CMF +${c20.toFixed(2)} (고가권 마감 + 거래량 동반)`];
      reasons.push(`상승일 거래량이 하락일의 ${udr.toFixed(1)}배`);
      if (o?.rising) reasons.push('OBV 상승 추세');
      if (pos < 0.4) { reasons.push('60일 저가권 — 바닥 매집 추정'); grade = 'A'; }
      else if (pos > 0.85 && runup20 > 0.15) { reasons.unshift(`⚠ 고점권 — 20일 +${Math.round(runup20 * 100)}% 후, 추격 주의`); grade = 'C'; warn = true; }
      else if (c20 >= 0.2 && udr >= 1.5) grade = 'A';
      supply.push({ ...base, reasons: reasons.slice(0, 5), grade, warn, _sort: c20 * 10 + udr + (grade === 'A' ? 2 : 0) - (warn ? 6 : 0) });
    }

    // 장기 매집 프록시 (장기 매집 탭)
    if (c60 >= 0.1 && c20 >= 0.05 && o?.rising) {
      steady.push({
        ...base, grade: 'A', warn: false,
        reasons: [
          `장기 매집 프록시 — 60일 CMF +${c60.toFixed(2)} · OBV 상승 지속`,
          `상승일 거래량 우위 ${udr.toFixed(1)}배`,
        ],
        _sort: c60 * 10,
      });
    }
  }
  const cap = (arr) => arr.sort((a, b) => b._sort - a._sort)
    .slice(0, DISCOVER.maxPerList).map(({ _sort, ...r }) => r);
  return { supply: cap(supply), steady: cap(steady) };
}

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

  // 빈 수급/매집 리스트를 가격·거래량 기반 프록시로 대체
  const proxy = buildProxySupply(stocks, qMap);
  day.lists.supply = proxy.supply;
  day.lists.steady = proxy.steady;

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
  console.log(`  매집프록시 ${lists.supply.length} · 장기프록시 ${lists.steady.length} · 추세 ${lists.trend.length} · 거래폭발 ${lists.volume.length} · 시장 ${regime}(${Math.round(breadth * 100)}%)`);
  for (const f of focus) console.log(`  🎯 ${f.name} [${f.hits.join('+')}] — ${f.reasons[0]}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
