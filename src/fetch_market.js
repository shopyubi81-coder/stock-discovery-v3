// 시장 위젯 수집 — 공포지수(CNN) + 원/달러 환율(네이버) + 연기금 뉴스(구글뉴스 RSS)
//   실행:  npm run market
//   산출:  data/market-extra.json
// 각 소스는 독립적으로 실패 허용 (하나 죽어도 나머지는 저장)

import { writeFile } from 'node:fs/promises';
import { outPath } from './lib/paths.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' };

const RATING_KO = {
  'extreme fear': '극단적 공포', 'fear': '공포', 'neutral': '중립',
  'greed': '탐욕', 'extreme greed': '극단적 탐욕',
};

// ── CNN Fear & Greed (Referer 없으면 418 차단) ───────────────────────────────
async function fetchFearGreed() {
  const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
    headers: { ...UA, Accept: 'application/json', Referer: 'https://edition.cnn.com/markets/fear-and-greed', Origin: 'https://edition.cnn.com' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cur = (await res.json()).fear_and_greed;
  if (!cur) throw new Error('데이터 없음');
  return {
    score: Math.round(cur.score),
    rating: RATING_KO[cur.rating?.toLowerCase()] || cur.rating,
    prevClose: Math.round(cur.previous_close),
    prev1w: Math.round(cur.previous_1_week),
    prev1m: Math.round(cur.previous_1_month),
  };
}

// ── 원/달러 환율 60일 (네이버 모바일) ────────────────────────────────────────
async function fetchFx() {
  const res = await fetch(
    'https://m.stock.naver.com/front-api/marketIndex/prices?category=exchange&reutersCode=FX_USDKRW&page=1&pageSize=60',
    { headers: { ...UA, Referer: 'https://m.stock.naver.com/' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()).result || [];
  if (!rows.length) throw new Error('데이터 없음');
  const num = (s) => Number(String(s).replace(/,/g, ''));
  const history = rows.map((r) => ({ d: r.localTradedAt, v: num(r.closePrice) })).reverse();
  const cur = rows[0];
  const dir = cur.fluctuationsType?.name === 'FALLING' ? -1 : cur.fluctuationsType?.name === 'RISING' ? 1 : 0;
  return {
    rate: num(cur.closePrice),
    change: num(cur.fluctuations) * (dir || 1) * (dir === 0 ? 0 : 1),
    ratio: num(cur.fluctuationsRatio) * (dir || 1) * (dir === 0 ? 0 : 1),
    date: cur.localTradedAt,
    history,
  };
}

// ── KOSPI / KOSDAQ 지수 30일 ─────────────────────────────────────────────────
async function fetchIndex(code) {
  const res = await fetch(`https://m.stock.naver.com/api/index/${code}/price?pageSize=30&page=1`,
    { headers: { ...UA, Referer: 'https://m.stock.naver.com/' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  if (!rows?.length) throw new Error('데이터 없음');
  const num = (s) => Number(String(s).replace(/,/g, ''));
  const cur = rows[0];
  const change = num(cur.compareToPreviousClosePrice);
  return {
    value: num(cur.closePrice),
    change,
    ratio: Math.abs(num(cur.fluctuationsRatio)) * (change < 0 ? -1 : 1),
    date: cur.localTradedAt,
    history: rows.map((r) => ({ d: r.localTradedAt, v: num(r.closePrice) })).reverse(),
  };
}

// ── 연기금 리밸런싱 뉴스 (구글뉴스 RSS — 키 불필요) ──────────────────────────
async function fetchPensionNews() {
  const q = encodeURIComponent('연기금 리밸런싱 OR 국민연금 순매수');
  const res = await fetch(`https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  const pick = (b, tag) => {
    const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null;
  };
  for (const b of blocks.slice(0, 6)) {
    const title = pick(b, 'title');
    const link = pick(b, 'link');
    const pub = pick(b, 'pubDate');
    const source = pick(b, 'source');
    if (!title || !link) continue;
    items.push({
      title: title.replace(/ - [^-]+$/, ''), // 말미 "- 언론사" 제거
      link,
      source,
      date: pub ? new Date(pub).toISOString().slice(0, 10) : null,
    });
  }
  return items;
}

async function main() {
  const out = { generated_at: new Date().toISOString(), feargreed: null, fx: null, indices: {}, pensionNews: [] };

  for (const code of ['KOSPI', 'KOSDAQ']) {
    try { out.indices[code.toLowerCase()] = await fetchIndex(code); console.log(`[market] ${code} ${out.indices[code.toLowerCase()].value} (${out.indices[code.toLowerCase()].ratio}%)`); }
    catch (e) { console.warn(`[market] ${code} 실패: ${e.message}`); }
  }

  try { out.feargreed = await fetchFearGreed(); console.log(`[market] 공포지수 ${out.feargreed.score} (${out.feargreed.rating})`); }
  catch (e) { console.warn(`[market] 공포지수 실패: ${e.message}`); }

  try { out.fx = await fetchFx(); console.log(`[market] 환율 ${out.fx.rate} (${out.fx.change > 0 ? '+' : ''}${out.fx.change})`); }
  catch (e) { console.warn(`[market] 환율 실패: ${e.message}`); }

  try { out.pensionNews = await fetchPensionNews(); console.log(`[market] 연기금 뉴스 ${out.pensionNews.length}건`); }
  catch (e) { console.warn(`[market] 연기금 뉴스 실패: ${e.message}`); }

  await writeFile(outPath('market-extra.json'), JSON.stringify(out, null, 2));
  console.log('[market] data/market-extra.json 저장 완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
