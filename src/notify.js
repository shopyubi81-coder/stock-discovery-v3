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

function compose(d) {
  const R = { strong: '🟢 강세', neutral: '🟡 중립', weak: '🔴 약세' }[d.market.regime];
  const L = [];
  L.push(`<b>📋 오늘의 발굴 — ${d.date}</b>`);
  L.push(`시장 ${R} (20일선 위 ${d.market.breadth}%) · 필터 통과 ${d.filter.passed}/${d.filter.universe}종목`);
  if (d.market.regime === 'weak') L.push(`⚠ 약세장 — 신규 진입보다 관찰 위주로.`);
  if (d.themeFocus) L.push(`🔥 발굴 종목의 ${d.themeFocus.share}%가 ${esc(d.themeFocus.name)}`);
  L.push('');

  if (d.focus?.length) {
    const HK = { supply: '수급', steady: '매집', trend: '추세', volume: '거래' };
    L.push('<b>🎯 오늘의 집중 후보</b>');
    for (const f of d.focus) {
      L.push(`· <b>${esc(f.name)}</b> [${f.hits.map((h) => HK[h]).join('+')}] ${sign(f.change)}`);
      L.push(`  진입 ${f.entry.toLocaleString()} · 손절 ${f.stop.toLocaleString()}(${f.stopPct}%) · 목표 ${f.target.toLocaleString()}(+${f.targetPct}%)`);
    }
    L.push('');
  }

  const sec = (title, rows, n) => {
    if (!rows.length) return;
    L.push(`<b>${title}</b>`);
    for (const r of rows.slice(0, n)) {
      const fresh = r.freshDays === 1 ? ' 🆕' : ` (${r.freshDays}일째)`;
      L.push(`· <b>${esc(r.name)}</b> ${sign(r.change)}${fresh}`);
      L.push(`  ${esc(r.reasons.slice(0, 3).join(' · '))}`);
    }
    L.push('');
  };
  sec('💰 수급 포착', d.lists.supply, 5);
  sec('📈 추세 전환', d.lists.trend, 3);
  sec('🧲 장기 매집', d.lists.steady || [], 3);

  const rec = d.record;
  if (rec?.samples) {
    const bl = rec.byList || {};
    const pill = (k, label) => bl[k]?.samples ? `${label} ${sign(bl[k].avgReturn)}` : null;
    const parts = [pill('supply', '수급'), pill('trend', '추세'), pill('volume', '거래')].filter(Boolean);
    L.push(`📊 성적표(D+${rec.horizon}): 평균 ${sign(rec.avgReturn)} · 적중 ${rec.hitRate}%${parts.length ? ' · ' + parts.join(' / ') : ''}`);
  }
  L.push(`<i>투자 판단과 책임은 본인에게 있습니다</i>`);
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
  const msg = compose(d);
  if (DRY) {
    console.log(TOKEN && CHAT ? '[notify] DRY_RUN — 발송 생략, 미리보기:' : '[notify] 토큰 없음 — 미리보기만 출력:');
    console.log(msg.replace(/<[^>]+>/g, ''));
    return;
  }
  await send(msg);
  console.log(`[notify] 텔레그램 발송 완료 (${msg.length}자)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
