// 종목 뉴스 수집 + 키워드 감성 분석 — 발굴·추적 종목만 대상 (가볍게)
//   실행:  npm run news   (discover.json 생성 후 — 배치에서 discover 다음 단계)
//   산출:  data/news.json  (종목 팝업 "최근 뉴스" 섹션이 읽음)
// 네이버 /api/news/stock/{ticker} 무료 API · 감성은 키워드 규칙 기반 (V2 검증 사전)

import { readFile, writeFile } from 'node:fs/promises';
import { outPath } from './lib/paths.js';

const H = { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' } };
const CONC = Number(process.env.CONCURRENCY || 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const POS = [
  ['수주', 25], ['수주잔고', 20], ['흑자전환', 25], ['어닝서프라이즈', 25],
  ['실적 상향', 20], ['목표주가 상향', 20], ['증설', 18], ['자사주 매입', 15],
  ['자사주 취득', 15], ['신제품', 12], ['출시', 10], ['양산', 15], ['파트너십', 12],
  ['MOU', 10], ['계약', 15], ['M&A', 18], ['인수', 15], ['합병', 15],
  ['정부 지원', 12], ['국책', 10], ['매출 성장', 15], ['영업이익 증가', 18],
  ['배당', 10], ['주주환원', 12],
];
const NEG = [
  ['영업손실', -22], ['적자 전환', -22], ['대규모 적자', -25], ['실적 하향', -18],
  ['목표주가 하향', -15], ['투자의견 하향', -15], ['리콜', -25], ['결함', -18],
  ['불량', -18], ['소송', -15], ['과징금', -20], ['제재', -18], ['구조조정', -15],
  ['희망퇴직', -12], ['부도', -30], ['법정관리', -30], ['채권단', -20],
  ['횡령', -25], ['배임', -25], ['수사', -15],
];

const sentiment = (text) => {
  let s = 0;
  for (const [kw, p] of POS) if (text.includes(kw)) s += p;
  for (const [kw, p] of NEG) if (text.includes(kw)) s += p;
  return Math.max(-100, Math.min(100, s));
};
const parseDate = (dt) => dt && dt.length >= 8 ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : null;

async function fetchTickerNews(ticker) {
  try {
    const res = await fetch(`https://m.stock.naver.com/api/news/stock/${ticker}?page=1&pageSize=10`, H);
    if (!res.ok) return [];
    // 응답은 [그룹{items:[기사]}...] 구조 — 그룹당 1건씩이라 전체를 펼쳐야 한다 (첫 그룹만 읽으면 1건뿐)
    const groups = await res.json();
    const items = (Array.isArray(groups) ? groups : []).flatMap((g) => g.items || []);
    return items.map((n) => {
      const text = (n.title || '') + ' ' + (n.body || '');
      return {
        title: n.title, date: parseDate(n.datetime), source: n.officeName,
        url: n.mobileNewsUrl, score: sentiment(text),
      };
    });
  } catch { return []; }
}

async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i]); }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function main() {
  const d = JSON.parse(await readFile(outPath('discover.json'), 'utf8'));
  const tickers = [...new Set([
    ...Object.values(d.lists).flat().map((r) => r.ticker),
    ...(d.tracking || []).map((r) => r.ticker),
  ])];
  console.log(`[news] 발굴·추적 ${tickers.length}종목 뉴스 수집 (concurrency ${CONC})`);

  const results = await mapPool(tickers, CONC, async (t) => {
    const articles = await fetchTickerNews(t);
    await sleep(30 + Math.random() * 40);
    // 최근 5건 가중 평균 (최신 가중 5 → 1)
    const recent = articles.slice(0, 5);
    let w = 0, sum = 0;
    recent.forEach((a, i) => { const k = 5 - i; sum += a.score * k; w += k; });
    return { ticker: t, rawScore: w ? Math.round(sum / w) : 0, articles: articles.slice(0, 3) };
  });

  const items = results.filter((r) => r.articles.length);
  await writeFile(outPath('news.json'), JSON.stringify({
    generated_at: new Date().toISOString(), count: items.length, items,
  }));
  const hot = [...items].sort((a, b) => Math.abs(b.rawScore) - Math.abs(a.rawScore)).slice(0, 3);
  console.log(`[news] ${items.length}종목 저장. 감성 강한 순:`);
  for (const r of hot) console.log(`  ${r.ticker} raw=${r.rawScore} · ${r.articles[0]?.title?.slice(0, 40)}`);
}

main().catch((e) => { console.error('[news]', e.message); process.exit(1); });
