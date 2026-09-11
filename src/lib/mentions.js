// 인플루언서 언급 — x-watchlist-intel 이 Supabase 에 적재한 것을 읽어온다.
//
// 크로스 프로젝트 통합 2단계 (2026-09-11).
//
// 왜 이게 여기 있나: x-watchlist-intel 은 매일 2회 X/유튜브/뉴스에서 "오늘
// 누가 무슨 종목을 언급했는가"를 뽑아 쌓고 있었지만, 그 결과가 어떤 판단에도
// 연결되지 않고 구글시트에만 남아 있었다. 그 프로젝트의 목적 자체가
// "인사이트 → 투자 액션"이므로, 발굴 리스트에 근거 한 줄로 붙이는 것이
// 가장 값싼 첫 연결이다.
//
// ⚠️ 이건 **근거이지 신호가 아니다.**
//   - 발굴 여부·정렬·등급을 바꾸지 않는다. 언급됐다는 이유로 종목이 리스트에
//     올라오거나 순위가 오르는 일은 없다.
//   - 이 프로젝트는 실증되지 않은 것에 가중치를 주지 않는다(성적표로 사후
//     검증되는 것만 점수에 들어간다). 인플루언서 언급의 예측력은 아직 한 번도
//     측정된 적이 없다. 측정 전에 가중치를 주면 그 순간 리스트가 오염된다.
//   - 그래서 하는 일은 딱 하나 — 이미 발굴된 종목에 "어제 @누가 언급" 문장을
//     덧붙인다. 나중에 성적표로 "언급 동반 종목이 실제로 더 나았나"를 측정한
//     뒤에야 점수 편입을 논할 수 있다.
//
// 실패해도 발굴을 막지 않는다. Supabase 키가 없거나 표가 아직 없으면 빈
// Map 을 돌려주고, 배지만 안 나온다.

import { select } from './supabase.js';

const TABLE = 'influencer_mentions';

// 며칠 전 언급까지 근거로 볼 것인가. 3일: 주말을 사이에 낀 금요일 언급이
// 월요일 발굴에도 보이도록 하는 최소 길이.
export const LOOKBACK_DAYS = 3;

const ymd = (d) => d.toISOString().slice(0, 10);

// 언급자 표기 — 링크가 있으면 그쪽을 쓰기 위해 원본을 같이 보관한다.
function pack(row) {
  return {
    by: row.mentioned_by || '익명',
    on: row.mentioned_on,
    detail: row.detail || '',
    link: row.link || '',
    target: row.target || '',
  };
}

/**
 * 최근 언급을 { [symbol]: [ {by,on,detail,link,target}, ... ] } 로.
 * symbol 이 null 인 행(비상장사·제품명 등 약 43%)은 매칭할 대상이 없으므로 건너뛴다.
 *
 * @param {string} market 'KR' | 'US'
 * @param {number} days   조회 기간(일)
 */
export async function fetchMentions(market, { days = LOOKBACK_DAYS } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  let rows;
  try {
    rows = await select(
      TABLE,
      `select=symbol,market,mentioned_on,mentioned_by,detail,link,target` +
        `&symbol=not.is.null&market=eq.${market}&mentioned_on=gte.${ymd(since)}` +
        `&order=mentioned_on.desc&limit=2000`,
    );
  } catch (e) {
    // 표가 아직 안 만들어졌거나(42P01) 권한이 없어도 발굴은 계속돼야 한다.
    console.warn(`  ! 인플루언서 언급 조회 건너뜀: ${e.message}`);
    return new Map();
  }
  if (!rows?.length) return new Map();

  const out = new Map();
  for (const r of rows) {
    if (!r.symbol) continue;
    const list = out.get(r.symbol) || [];
    list.push(pack(r));
    out.set(r.symbol, list);
  }
  // 같은 종목을 같은 사람이 하루에 여러 번 얘기해도 한 번으로 센다 —
  // "몇 번 언급됐나"가 아니라 "누가 언급했나"가 근거로서 의미 있는 단위다.
  for (const [sym, list] of out) {
    const seen = new Set();
    out.set(
      sym,
      list.filter((m) => {
        const k = `${m.by}|${m.on}`;
        return seen.has(k) ? false : seen.add(k);
      }),
    );
  }
  return out;
}

/**
 * 근거 문장 한 줄. 붙일 게 없으면 null.
 * 예) '💬 어제 @ARKInvest 언급 — 목표주가 $360'
 *     '💬 최근 @rklb_invest 외 2명 언급'
 */
export function mentionReason(mentions, today = new Date()) {
  if (!mentions?.length) return null;

  const t = ymd(today);
  const y = ymd(new Date(today.getTime() - 86400000));
  const when = (on) => (on === t ? '오늘' : on === y ? '어제' : '최근');

  const [first] = mentions;
  const others = mentions.length - 1;
  let s = `💬 ${when(first.on)} @${first.by} 언급`;
  if (others > 0) s = `💬 ${when(first.on)} @${first.by} 외 ${others}명 언급`;
  if (first.detail) s += ` — ${first.detail}`;
  return s;
}

export default { fetchMentions, mentionReason, LOOKBACK_DAYS, TABLE };
