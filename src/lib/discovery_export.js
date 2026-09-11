// discovery_picks 로 오늘의 신규 발굴을 Supabase에 내보낸다.
//
// 크로스 프로젝트 통합 3단계 ("C안", 2026-09-11): AlphaFactory는 더 이상
// 매일 직접 스크리닝하지 않고, 이 프로젝트가 발굴한 것을 측정만 한다.
// AlphaFactory의 rolling_ic.py(중첩보정 Spearman IC)가 이 표를 읽는다.
//
// **오늘 새로 진입한 것만** 내보낸다(freshDays === 1). 이미 알고 있던
// 종목을 매일 다시 보내면 AlphaFactory의 add_pick() 재확인 로직이 매일
// reconfirmed_count 만 올릴 뿐 새 앵커가 생기진 않으니 안전하긴 하지만,
// 굳이 매일 전체 리스트를 보낼 이유가 없다 — 신규 진입 시점이 정확히
// discovery_date 가 돼야 할 앵커라서, 그 시점 하나만 정직하게 보낸다.
//
// 같은 티커가 오늘 여러 리스트에 동시에 걸리면 하나만 남긴다 — 리스트별로
// 별도 행을 보내면 AlphaFactory 쪽에서 같은 종목이 여러 앵커로 잡힐 여지가
// 있다(그쪽은 종목당 앵커가 하나뿐이라야 한다). 우선순위는 LIST_ORDER와
// 동일(수급 > 장기매집 > 추세 > 거래폭발) — discover.js 의 성적표·추적관찰이
// 이미 쓰는 순서를 그대로 따른 것이지 여기서 새로 정한 게 아니다.

import { upsert, hasSupabase } from './supabase.js';

const TABLE = 'discovery_picks';
const LIST_PRIORITY = ['supply', 'steady', 'trend', 'volume'];

/**
 * @param {Record<string, Array>} lists  discover.js 의 lists (freshDays 부착됨)
 * @param {Map<string, Array>} qMap      ticker -> [{date, close, ...}, ...]
 * @param {string} market                'KR' | 'US'
 * @param {{ code: 'KRW'|'USD' }} opts
 */
export async function exportNewDiscoveries(lists, qMap, market, { currency } = {}) {
  currency = currency || (market === 'US' ? 'USD' : 'KRW');
  if (!hasSupabase) return { skipped: true, reason: 'no-supabase-env' };

  // 티커별로 우선순위가 가장 높은 리스트 하나만 남긴다.
  const best = new Map(); // ticker -> row
  for (const key of LIST_PRIORITY) {
    for (const r of lists[key] || []) {
      if (r.freshDays !== 1) continue; // 오늘 신규 진입만
      if (best.has(r.ticker)) continue; // 더 높은 우선순위 리스트에서 이미 잡음
      best.set(r.ticker, { ...r, list_key: key });
    }
  }
  if (!best.size) return { count: 0 };

  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const r of best.values()) {
    const q = qMap.get(r.ticker) || [];
    const price = q.at(-1)?.close;
    if (!price) continue; // 종가가 없으면 discovery_price 를 만들 수 없다 — 건너뜀

    const gradeWeight = { A: 1.5, B: 1, C: 0.4 }[r.grade] ?? 1;
    const listWeight = { supply: 3, steady: 3, trend: 2, volume: 1 }[r.list_key] ?? 1;

    rows.push({
      ticker: r.ticker,
      market,
      name: r.name,
      sector: r.sector || null,
      list_key: r.list_key,
      grade: r.grade || null,
      signal_score: Math.round(listWeight * gradeWeight * 100) / 100,
      discovered_on: today,
      price,
      currency,
    });
  }
  if (!rows.length) return { count: 0 };

  await upsert(TABLE, rows);
  return { count: rows.length };
}

export default { exportNewDiscoveries };
