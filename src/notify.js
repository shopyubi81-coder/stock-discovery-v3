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
const HK = { supply: '수급', steady: '매집', trend: '추세', volume: '거래' };

// 리서치 노트 형식 — "무엇을"이 아니라 "왜"가 읽히는 보고서
function compose(d, mkt) {
  const L = [];
  const day = ['일', '월', '화', '수', '목', '금', '토'][new Date(d.date + 'T00:00:00').getDay()];

  // ── 1. 시장 판단 (결론부터) ──
  const R = { strong: ['🟢', '매수 우호'], neutral: ['🟡', '중립 — 선별 접근'], weak: ['🔴', '약세 — 관망 우선'] }[d.market.regime];
  const ACTION = {
    strong: '계획 종목 분할 진입 가능한 환경.',
    neutral: '수급 확실한 종목만 소액·분할로.',
    weak: '신규 매수보다 관망. 리스트는 반등 대비 관찰용.',
  }[d.market.regime];
  L.push(`<b>📊 오늘의 발굴 리포트 — ${d.date} (${day})</b>`);
  L.push(`${R[0]} <b>시장 판단: ${R[1]}</b>`);
  const mb = [`20일선 위 ${d.market.breadth}%`];
  if (mkt?.feargreed) mb.push(`공포지수 ${mkt.feargreed.score}(${mkt.feargreed.rating})`);
  if (mkt?.indices?.kospi) mb.push(`KOSPI ${sign(mkt.indices.kospi.ratio)}`);
  if (mkt?.fx) mb.push(`환율 ${mkt.fx.rate.toLocaleString()}원`);
  L.push(mb.join(' · '));
  L.push(`→ ${ACTION}`);
  if (d.themeFocus) L.push(`🔥 테마 쏠림: 발굴 종목의 ${d.themeFocus.share}%가 ${esc(d.themeFocus.name)}`);
  L.push('');

  // ── 2. 집중 후보 — 종목별 미니 리포트 (근거 명시) ──
  if (d.focus?.length) {
    L.push(`<b>🎯 집중 후보 ${d.focus.length}종목</b> <i>(4개 관점 교차검증 · 수급 근거 필수 · 과열주 제외)</i>`);
    d.focus.forEach((f, i) => {
      L.push('');
      L.push(`<b>${i + 1}) ${esc(f.name)}</b> · ${esc(f.sector || f.market)} ${sign(f.change)} · 대금 ${f.amountEok.toLocaleString()}억`);
      L.push(`  검증: [${f.hits.map((h) => HK[h]).join('+')}] ${f.hits.length}개 관점 동시 포착${f.freshDays === 1 ? ' · 오늘 첫 진입 🆕' : ` · ${f.freshDays}일째 유지`}`);
      L.push(`  근거: ${esc(f.reasons.slice(0, 3).join(' / '))}`);
      L.push(`  레벨: 진입 ${f.entry.toLocaleString()} → 손절 ${f.stop.toLocaleString()} <i>(${f.stopPct}%, 20일선 이탈 기준)</i> → 목표 ${f.target.toLocaleString()} <i>(+${f.targetPct}%, 직전 고점권)</i>`);
      L.push(`  손익비 약 1:${Math.abs(f.targetPct / f.stopPct).toFixed(1)}`);
    });
    L.push('');
  }

  // ── 3. 관점별 리스트 요약 (등급 분포로 오늘의 "질" 표시) ──
  const dist = (rows) => {
    const g = { A: 0, B: 0, C: 0 };
    for (const r of rows) g[r.grade || 'B']++;
    return `${rows.length}종목 (A급 ${g.A})`;
  };
  L.push(`<b>📋 관점별 발굴 현황</b> — 안전필터 통과 ${d.filter.passed}/${d.filter.universe}`);
  L.push(`수급 ${dist(d.lists.supply)} · 추세 ${dist(d.lists.trend)} · 거래폭발 ${dist(d.lists.volume)} · 장기매집 ${(d.lists.steady || []).length}종목`);
  L.push('');

  // ── 4. 신뢰 지표 — 이 도구의 최근 실제 성적 ──
  const rec = d.record;
  if (rec?.samples) {
    const bl = rec.byList || {};
    const pill = (k) => bl[k]?.samples ? `${HK[k]} ${sign(bl[k].avgReturn)}(적중 ${bl[k].hitRate}%)` : null;
    const parts = ['supply', 'trend', 'volume'].map(pill).filter(Boolean);
    L.push(`<b>📈 최근 2주 성적</b> (D+${rec.horizon} 실측 ${rec.samples}건)`);
    L.push(`전체 ${sign(rec.avgReturn)} vs 시장 ${sign(rec.benchReturn)} · ${parts.join(' · ')}`);
    L.push('');
  }

  L.push(`<i>레벨은 기계적 계산 참고치 · 투자 판단과 책임은 본인에게 있습니다</i>`);
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
  const d = JSON.parse(await readFile(outPath('discover.json'), 'utf8'));
  let mkt = null;
  try { mkt = JSON.parse(await readFile(outPath('market-extra.json'), 'utf8')); } catch {}
  const msg = compose(d, mkt);
  if (DRY) {
    console.log(TOKEN && CHAT ? '[notify] DRY_RUN — 발송 생략, 미리보기:' : '[notify] 토큰 없음 — 미리보기만 출력:');
    console.log(msg.replace(/<[^>]+>/g, ''));
    return;
  }
  await send(msg);
  console.log(`[notify] 텔레그램 발송 완료 (${msg.length}자)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
