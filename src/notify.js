// 텔레그램 알림 — "오늘의 발굴" 요약을 매일 장마감 배치 후 발송.
//   실행:  npm run notify        (discover.json 생성 후)
//   env:   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (없으면 미리보기만 출력하고 정상 종료)
//          DRY_RUN=1  → 발송 없이 메시지 출력

import { readFile } from 'node:fs/promises';
import { outPath } from './lib/paths.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const DRY = process.env.DRY_RUN === '1' || !TOKEN || !CHAT;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sign = (v) => `${v > 0 ? '+' : ''}${v}%`;
const fmt = (v, isUs) => isUs ? Number(v).toFixed(2) : Math.round(v).toLocaleString();
const HK = { supply: '수급', steady: '매집', trend: '추세', volume: '거래' };

// 텔레그램 HTML은 색상 태그가 없다 — <a> 링크는 텔레그램이 항상 파란색으로 렌더링하므로
// <b><a>로 감싸면 "파란 굵은 글씨 + 클릭 시 시세 페이지 이동"을 동시에 얻는다.
const stockLink = (name, ticker, isUs) => {
  const url = isUs
    ? `https://stockanalysis.com/stocks/${ticker}/`
    : `https://m.stock.naver.com/domestic/stock/${ticker}/total`;
  return `<a href="${url}"><b>${esc(name)}</b></a>`;
};

// 한 시장(국내 or 해외)의 시장판단+집중후보+현황+성적을 리포트 섹션으로 구성
function buildSection(d, opts) {
  const { flagTitle, isUs, marketLine } = opts;
  const L = [];

  const R = { strong: ['🟢', '매수 우호'], neutral: ['🟡', '중립 — 선별 접근'], weak: ['🔴', '약세 — 관망 우선'] }[d.market.regime];
  const ACTION = {
    strong: '계획 종목 분할 진입 가능한 환경.',
    neutral: '수급 확실한 종목만 소액·분할로.',
    weak: '신규 매수보다 관망. 리스트는 반등 대비 관찰용.',
  }[d.market.regime];
  L.push(`<b>${flagTitle}</b>`);
  L.push(`${R[0]} <b>시장 판단: ${R[1]}</b>`);
  L.push(marketLine);
  L.push(`→ ${ACTION}`);
  if (d.themeFocus) L.push(`🔥 테마 쏠림: 발굴 종목의 ${d.themeFocus.share}%가 ${esc(d.themeFocus.name)}`);
  L.push('');

  if (d.focus?.length) {
    L.push(`<b>🎯 집중 후보 ${d.focus.length}종목</b> <i>(관점 교차검증 · 수급 근거 필수 · 과열주 제외)</i>`);
    d.focus.forEach((f, i) => {
      L.push('');
      L.push(`${i + 1}) ${stockLink(f.name, f.ticker, isUs)} · ${esc(f.sector || f.market)} ${sign(f.change)} · 대금 ${f.amountEok.toLocaleString()}억`);
      L.push(`  검증: [${f.hits.map((h) => HK[h]).join('+')}] ${f.hits.length}개 관점 동시 포착${f.freshDays === 1 ? ' · 오늘 첫 진입 🆕' : ` · ${f.freshDays}일째 유지`}`);
      L.push(`  근거: ${esc(f.reasons.slice(0, 3).join(' / '))}`);
      L.push(`  레벨: 진입 ${fmt(f.entry, isUs)} → 손절 ${fmt(f.stop, isUs)} <i>(${f.stopPct}%, 20일선 이탈 기준)</i> → 목표 ${fmt(f.target, isUs)} <i>(+${f.targetPct}%, 직전 고점권)</i>`);
      L.push(`  손익비 약 1:${Math.abs(f.targetPct / f.stopPct).toFixed(1)}`);
    });
    L.push('');
  }

  const dist = (rows) => {
    const g = { A: 0, B: 0, C: 0 };
    for (const r of rows || []) g[r.grade || 'B']++;
    return `${(rows || []).length}종목 (A급 ${g.A})`;
  };
  L.push(`<b>📋 관점별 발굴 현황</b> — 안전필터 통과 ${d.filter.passed}/${d.filter.universe}`);
  L.push(`수급 ${dist(d.lists.supply)} · 추세 ${dist(d.lists.trend)} · 거래폭발 ${dist(d.lists.volume)} · 장기매집 ${(d.lists.steady || []).length}종목`);
  L.push('');

  const rec = d.record;
  if (rec?.samples) {
    const bl = rec.byList || {};
    const pill = (k) => bl[k]?.samples ? `${HK[k]} ${sign(bl[k].avgReturn)}(적중 ${bl[k].hitRate}%)` : null;
    const parts = ['supply', 'trend', 'volume'].map(pill).filter(Boolean);
    L.push(`<b>📈 최근 2주 성적</b> (D+${rec.horizon} 실측 ${rec.samples}건)`);
    L.push(`전체 ${sign(rec.avgReturn)} vs 시장 ${sign(rec.benchReturn)}${parts.length ? ' · ' + parts.join(' · ') : ''}`);
  } else {
    L.push(`<i>📈 성적 데이터 쌓이는 중 (D+5 이력 필요)</i>`);
  }
  return L.join('\n');
}

function compose(dKr, dUs, mkt) {
  const day = ['일', '월', '화', '수', '목', '금', '토'][new Date(dKr.date + 'T00:00:00').getDay()];
  const L = [`<b>📊 오늘의 발굴 리포트 — ${dKr.date} (${day})</b>`, ''];

  const krLine = [`20일선 위 ${dKr.market.breadth}%`];
  if (mkt?.feargreed) krLine.push(`공포지수 ${mkt.feargreed.score}(${mkt.feargreed.rating})`);
  if (mkt?.indices?.kospi) krLine.push(`KOSPI ${sign(mkt.indices.kospi.ratio)}`);
  if (mkt?.fx) krLine.push(`환율 ${mkt.fx.rate.toLocaleString()}원`);
  L.push(buildSection(dKr, { flagTitle: '🇰🇷 국내', isUs: false, marketLine: krLine.join(' · ') }));

  if (dUs) {
    L.push('', '━━━━━━━━━━━━━━━', '');
    const usLine = [`S&P500 20일선 위 ${dUs.market.breadth}%`];
    if (mkt?.indicesUs?.dow) usLine.push(`다우 ${sign(mkt.indicesUs.dow.ratio)}`);
    if (mkt?.indicesUs?.nasdaq) usLine.push(`나스닥 ${sign(mkt.indicesUs.nasdaq.ratio)}`);
    L.push(buildSection(dUs, { flagTitle: '🇺🇸 해외', isUs: true, marketLine: usLine.join(' · ') }));
  }

  L.push('', `<i>레벨은 기계적 계산 참고치 · 투자 판단과 책임은 본인에게 있습니다</i>`);
  return L.join('\n');
}

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`텔레그램 발송 실패: ${JSON.stringify(body)}`);
}

async function main() {
  // 킬스위치 — .env 의 NOTIFY_DISABLED=1 이면 데이터 수집은 그대로 두고 텔레그램 발송만 중단(대기).
  // 재개: .env 에서 NOTIFY_DISABLED 줄을 지우거나 0 으로 바꾸면 됨.
  if (process.env.NOTIFY_DISABLED === '1') {
    console.log('[notify] NOTIFY_DISABLED=1 — 텔레그램 발송 중단(대기) 상태. 데이터 수집은 정상 진행됨.');
    return;
  }
  const dKr = JSON.parse(await readFile(outPath('discover.json'), 'utf8'));
  let dUs = null, mkt = null;
  try { dUs = JSON.parse(await readFile(outPath('discover-us.json'), 'utf8')); } catch {}
  try { mkt = JSON.parse(await readFile(outPath('market-extra.json'), 'utf8')); } catch {}

  const msg = compose(dKr, dUs, mkt);
  if (DRY) {
    console.log(TOKEN && CHAT ? '[notify] DRY_RUN — 발송 생략, 미리보기:' : '[notify] 토큰 없음 — 미리보기만 출력:');
    console.log(msg.replace(/<a href="[^"]*">|<\/a>/g, '').replace(/<[^>]+>/g, ''));
    return;
  }
  await send(msg);
  console.log(`[notify] 텔레그램 발송 완료 (${msg.length}자, 국내${dUs ? '+해외' : '만'})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
