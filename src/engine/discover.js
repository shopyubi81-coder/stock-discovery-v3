// 발굴 엔진 — "아침 5분, 오늘 볼 종목과 그 이유"
//
//   파이프라인:
//   1. 안전 필터   — 거래대금·시총 하한, 적자 제외 (FILTER)
//   2. 관점 리스트 — 수급 포착 / 추세 전환 / 거래 폭발, 각각 이유 문장 포함
//   3. 신선도      — 발굴 이력과 비교해 "오늘 진입 / N일째 포착" 계산
//   4. 성적표      — 과거 리스트에 뽑힌 종목의 D+5 실제 수익률 집계
//
//   실행:  npm run score
//   산출:  data/discover.json + data/detail/{ticker}.json + data/discover-history.json

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { outPath } from '../lib/paths.js';
import { FILTER, DISCOVER, REGIME, THEMES } from './config.js';
import { sma, rsi, obv, streak } from './indicators.js';
import { computeSignals } from './signals.js';

const read = async (n) => JSON.parse(await readFile(outPath(n), 'utf8'));
const tryRead = async (n) => { try { return await read(n); } catch { return null; } };

// ── 종목별 기초 지표 묶음 ────────────────────────────────────────────────────
function analyze(stock, q, sup) {
  const closes = q.map((r) => r.close);
  const vals = q.map((r) => r.value ?? r.close * r.volume);
  const last = closes.at(-1);
  const ma5 = sma(closes, 5), ma20 = sma(closes, 20), ma60 = sma(closes, 60);
  const avgVal = sma(vals.slice(0, -1), Math.min(20, vals.length - 1));
  const amountEok = Math.round(vals.at(-1) / 1e8);
  const valueRatio = avgVal ? Math.round((vals.at(-1) / avgVal) * 10) / 10 : null;
  const fS = streak(sup.map((r) => r.foreign_net));
  const iS = streak(sup.map((r) => r.inst_net));
  const o = obv(q);
  const aligned = !!(ma5 && ma20 && ma60 && ma5 > ma20 && ma20 > ma60);
  const hi60 = closes.length >= 60 ? Math.max(...closes.slice(-60)) : null;

  // 매집형: OBV 상승 + 최근 10일 주가 횡보(변동폭 5% 미만)
  let accumulating = false;
  if (o?.rising && closes.length >= 10) {
    const w = closes.slice(-10);
    accumulating = (Math.max(...w) - Math.min(...w)) / last < 0.05;
  }

  let theme = null;
  const uname = (stock.name || '').toUpperCase();
  for (const t of THEMES) {
    if (t.keys.some((k) => uname.includes(k.toUpperCase()))) { theme = t.name; break; }
  }

  // ── 맥락 지표: 신호가 "어떤 위치·국면에서" 나왔는지 ──
  const lo60 = closes.length >= 5 ? Math.min(...closes.slice(-60)) : null;
  const posIn60 = hi60 != null && lo60 != null && hi60 > lo60 ? (last - lo60) / (hi60 - lo60) : null; // 0=60일 바닥, 1=고점
  const ddFromHi = hi60 ? last / hi60 - 1 : null;                    // 고점 대비 낙폭
  const runup20 = closes.length >= 21 ? last / closes.at(-21) - 1 : null; // 최근 20일 상승률
  const distMa20 = ma20 ? last / ma20 - 1 : null;                    // 20일선 이격
  const reverseAligned = !!(ma5 && ma20 && ma60 && ma5 < ma20 && ma20 < ma60);
  // 이평선 터치 후 반등: 최근 5일 저점이 이평선 ±2.5% 이내 + 저점 대비 +1.5% 회복 + 이평선 위
  const w5lo = Math.min(...closes.slice(-5));
  const touch20 = !!(ma20 && Math.abs(w5lo / ma20 - 1) <= 0.025 && last / w5lo - 1 >= 0.015 && last > ma20);
  const touch60 = !!(ma60 && Math.abs(w5lo / ma60 - 1) <= 0.025 && last / w5lo - 1 >= 0.015 && last > ma60);
  // 최근 5일 내 정배열 진입 (5일 전엔 정배열 아니었음)
  const c5 = closes.slice(0, -5);
  const alignedPrev = c5.length >= 60
    && sma(c5, 5) > sma(c5, 20) && sma(c5, 20) > sma(c5, 60);
  const freshAlign = aligned && !alignedPrev;
  // 당일 수급 주체
  const lastSup = sup.at(-1) || {};
  const rsiV = Math.round(rsi(closes));
  const overheat = (runup20 != null && runup20 > 0.20) || (distMa20 != null && distMa20 > 0.10) || rsiV > 70;

  return {
    closes, last, ma5, ma20, ma60, aligned, hi60, lo60,
    amountEok, valueRatio, fS, iS, obvRising: !!o?.rising, accumulating, theme,
    change: Math.round(((last / closes.at(-2)) - 1) * 1000) / 10,
    aboveMa20: !!(ma20 && last > ma20),
    rsi: rsiV,
    signals: computeSignals(closes, q, sup),
    posIn60, ddFromHi, runup20, distMa20, reverseAligned,
    touch20, touch60, freshAlign, overheat,
    fToday: lastSup.foreign_net || 0, iToday: lastSup.inst_net || 0, rToday: lastSup.retail_net || 0,
  };
}

// ── 안전 필터 ────────────────────────────────────────────────────────────────
function passesFilter(stock, a) {
  if (a.amountEok < FILTER.minAmountEok) return false;
  if ((stock.market_cap ?? 0) < FILTER.minMarketCap) return false;
  if (FILTER.excludeLoss) {
    if (stock.op_margin != null && stock.op_margin < 0) return false;
    if (stock.op_margin == null && stock.eps != null && stock.eps < 0) return false;
  }
  return true;
}

// ── 관점별 리스트 판정 — 편입 여부 + 이유 문장 + 정렬 키 ─────────────────────
function judgeSupply(a) {
  const strong = a.fS >= 2 || a.iS >= 2 || (a.fS >= 1 && a.iS >= 1);
  if (!strong) return null;

  // 맥락 분류: 같은 매집이라도 "어디서" 사는지가 다르다
  let ctx, grade = 'B', warn = false;
  if (a.posIn60 != null && a.posIn60 < 0.35 && a.ddFromHi <= -0.15) {
    ctx = `바닥권 매집 — 고점 대비 ${Math.round(a.ddFromHi * 100)}% 조정 후 저점 매수`;
    grade = 'A';
  } else if (a.posIn60 != null && a.posIn60 > 0.85 && a.runup20 > 0.15) {
    ctx = `⚠ 고점권 매집 — 20일간 +${Math.round(a.runup20 * 100)}% 상승 후, 추격 주의`;
    grade = 'C'; warn = true;
  } else {
    ctx = '상승 초입~중간 구간 매집';
    grade = a.aligned ? 'A' : 'B';
  }

  const reasons = [ctx];
  if (a.fS >= 1) reasons.push(`외국인 ${a.fS}일 연속 매수`);
  if (a.iS >= 1) reasons.push(`기관 ${a.iS}일 연속 매수`);
  if (a.fS >= 2 && a.iS >= 2) reasons.push('외인·기관 쌍끌이');
  if (a.accumulating) reasons.push('주가 횡보 중 매집형 거래');
  if (a.hi60 && a.last >= a.hi60) reasons.push('60일 신고가');
  if (a.valueRatio >= 2) reasons.push(`거래대금 평소 ${a.valueRatio}배`);
  if (a.aligned) reasons.push('정배열 유지');
  const sort = a.fS + a.iS + (a.fS >= 2 && a.iS >= 2 ? 3 : 0) + (a.accumulating ? 2 : 0)
    + (grade === 'A' ? 3 : 0) - (warn ? 6 : 0);
  return { reasons, sort, grade, warn };
}

const TREND_SIGS = { align_new: 3, cross_5_20: 3, bb_break: 3, macd_gc: 2, cross_10_20: 2, new_high_60: 2, cross_5_10: 1, rsi_recover: 1 };
function judgeTrend(a) {
  const hits = a.signals.filter((s) => TREND_SIGS[s.code]);
  // 신호가 없어도 "추세 지속 중 눌림목 반등"은 그 자체로 유효한 패턴
  const pullback = a.aligned && !a.freshAlign && a.touch20 && (a.posIn60 == null || a.posIn60 < 0.9);
  if (!hits.length && !pullback) return null;

  // 패턴 분류 — 확실성 순서: 전환+지지확인 > 눌림목 > 전환시도 > 단순돌파, 과열은 강등
  let pattern, grade;
  if (a.freshAlign && (a.touch20 || a.touch60)) {
    pattern = '역배열→정배열 전환 + 이평선 지지 확인 후 반등'; grade = 'A';
  } else if (pullback) {
    pattern = '추세 지속 중 조정 → 20일선 지지 반등 (눌림목)'; grade = 'A';
  } else if (a.freshAlign) {
    pattern = '정배열 전환 직후 — 지지 확인 전 초기 단계'; grade = 'B';
  } else if (!a.aligned && a.aboveMa20) {
    pattern = '역배열 속 20일선 돌파 — 전환 시도, 60일선 확인 필요'; grade = 'B';
  } else {
    pattern = '추세 신호 발생'; grade = 'B';
  }
  let warn = false;
  if (a.overheat) {
    pattern += '';
    grade = 'C'; warn = true;
  }

  const reasons = [pattern];
  if (warn) reasons.push(`⚠ 과열 구간 — 20일 ${a.runup20 != null ? '+' + Math.round(a.runup20 * 100) + '%' : ''} · RSI ${a.rsi} · 뒤늦은 진입 위험`);
  reasons.push(...hits.map((s) => s.label));
  if (a.aboveMa20 && !a.aligned) reasons.push('20일선 위 안착');
  if (a.fS >= 1 || a.iS >= 1) reasons.push(a.fS >= a.iS ? `외국인 ${a.fS}일 매수 동반` : `기관 ${a.iS}일 매수 동반`);
  const gradeW = { A: 10, B: 5, C: 0 };
  return { reasons, sort: gradeW[grade] + hits.reduce((x, s) => x + TREND_SIGS[s.code], 0) - (warn ? 8 : 0), grade, warn };
}

// 장기 매집 — 외인 또는 기관이 10일 이상 꾸준히 순매수 (수급 이력이 쌓여야 채워짐)
function judgeSteady(a) {
  const D = DISCOVER.steadyDays;
  if (a.fS < D && a.iS < D) return null;
  let grade = 'A', warn = false;
  const reasons = [];
  if (a.posIn60 != null && a.posIn60 > 0.85 && a.runup20 > 0.15) {
    reasons.push(`⚠ 이미 20일간 +${Math.round(a.runup20 * 100)}% 상승한 고점권 — 추격 주의`);
    grade = 'C'; warn = true;
  }
  if (a.fS >= D) reasons.push(`외국인 ${a.fS}일 연속 매수`);
  if (a.iS >= D) reasons.push(`기관 ${a.iS}일 연속 매수`);
  if (a.fS >= D / 2 && a.iS >= D / 2) reasons.push('외인·기관 동반 장기 매집');
  if (a.accumulating) reasons.push('주가 횡보 중 매집형 거래');
  if (a.aligned) reasons.push('정배열 유지');
  if (a.hi60 && a.last >= a.hi60) reasons.push('60일 신고가');
  return { reasons, sort: a.fS + a.iS - (warn ? 10 : 0), grade, warn };
}

function judgeVolume(a) {
  if (!a.valueRatio || a.valueRatio < DISCOVER.volumeSurge) return null;
  const supBuyToday = a.fToday > 0 || a.iToday > 0;

  // 투매성 폭발(급락 + 외인·기관도 이탈)은 발굴 대상이 아니다 — 자동 제외
  if (a.change <= -3 && !supBuyToday) return null;

  // 주도 주체 분류
  let ctx, grade = 'B', warn = false;
  if (a.change <= -3 && supBuyToday) {
    ctx = `⚠ 급락(${a.change}%) 속 폭발 — ${a.fToday > 0 ? '외국인' : '기관'} 매수 유입 (낙폭 매집 가능성, 고위험)`;
    grade = 'C'; warn = true;
  } else if (a.change > 0 && a.fToday > 0 && a.iToday > 0) {
    ctx = '외인·기관 동반 매수 폭발 — 세력 주도';
    grade = 'A';
  } else if (a.change > 0 && supBuyToday) {
    ctx = `${a.fToday > 0 ? '외국인' : '기관'} 주도 상승 폭발`;
    grade = a.posIn60 != null && a.posIn60 < 0.6 ? 'A' : 'B';
  } else if (a.change > 0 && a.rToday > 0 && a.fToday <= 0 && a.iToday <= 0) {
    ctx = '⚠ 개인 주도 폭발 — 외인·기관은 매도, 과열·단타성 주의';
    grade = 'C'; warn = true;
  } else {
    ctx = '주체 불분명 폭발 — 수급 확인 필요';
  }

  const reasons = [ctx, `거래대금 평소 ${a.valueRatio}배`];
  if (a.overheat && !warn) { reasons.push(`⚠ 과열 구간 (RSI ${a.rsi}) — 추격 주의`); grade = 'C'; warn = true; }
  if (a.fS >= 1) reasons.push(`외국인 ${a.fS}일 연속 매수`);
  if (a.iS >= 1) reasons.push(`기관 ${a.iS}일 연속 매수`);
  if (a.hi60 && a.last >= a.hi60) reasons.push('60일 신고가');
  return { reasons, sort: a.valueRatio + (a.change > 0 ? 2 : 0) + (grade === 'A' ? 4 : 0) - (warn ? 6 : 0), grade, warn };
}

// ── 하루치 발굴 리스트 구성 (백필에서도 재사용 — qMap/sMap 을 그날 기준으로 자르면 소급 실행) ──
export function buildDayLists(stocks, qMap, sMap, newsMap = null) {
  const judges = { supply: judgeSupply, trend: judgeTrend, volume: judgeVolume, steady: judgeSteady };
  let universe = 0, passed = 0, aboveMa20 = 0;
  const candidates = [];
  const seenTicker = new Set();
  for (const stock of stocks) {
    if (stock.is_active === false) continue;
    if (seenTicker.has(stock.ticker)) continue; // 종목 마스터 중복 방어
    seenTicker.add(stock.ticker);
    const q = qMap.get(stock.ticker) || [];
    if (q.length < 21) continue;
    const a = analyze(stock, q, sMap.get(stock.ticker) || []);
    universe++;
    if (a.aboveMa20) aboveMa20++;
    if (!passesFilter(stock, a)) continue;
    passed++;
    candidates.push({ stock, a });
  }
  const lists = {};
  for (const [key, judge] of Object.entries(judges)) {
    const rows = [];
    for (const { stock, a } of candidates) {
      const j = judge(a);
      if (!j) continue;
      const reasons = [...j.reasons];
      if (newsMap && (newsMap.get(stock.ticker) ?? 0) >= 15) reasons.push('최근 호재성 뉴스 동반');
      rows.push({
        ticker: stock.ticker, name: stock.name, market: stock.market,
        sector: a.theme || stock.sector || null,
        change: a.change, amountEok: a.amountEok,
        reasons: reasons.slice(0, 5),
        grade: j.grade || 'B', warn: !!j.warn,
        _sort: j.sort,
      });
    }
    rows.sort((x, y) => y._sort - x._sort || y.change - x.change);
    lists[key] = rows.slice(0, DISCOVER.maxPerList).map(({ _sort, ...r }) => r);
  }
  return { lists, universe, passed, aboveMa20 };
}

// ── 신선도 — 발굴 이력에서 연속 포착일 계산 ──────────────────────────────────
// history: { "YYYY-MM-DD": { supply:[t...], trend:[...], volume:[...] } }
function freshness(history, dates, listKey, ticker, today) {
  let days = 1; // 오늘 포함
  let prev = today;
  for (let i = dates.length - 1; i >= 0; i--) {
    // 달력 기준 4일 초과 공백(연휴 이상)이면 연속으로 보지 않는다
    const gap = (new Date(prev) - new Date(dates[i])) / 864e5;
    if (gap > 4) break;
    if ((history[dates[i]]?.[listKey] || []).includes(ticker)) { days++; prev = dates[i]; }
    else break;
  }
  return days;
}

// ── 오늘의 집중 후보 TOP 3 — 관점 리스트 교차 검증 ───────────────────────────
// 여러 리스트에 동시에 걸린 종목일수록 신뢰(수급 3 + 매집 3 + 추세 2 + 거래 1).
// 약세장 실증(수급만 시장 방어)에 따라 수급 계열(supply/steady) 근거를 필수로 요구.
function buildFocus(lists, qMap) {
  const W = { supply: 3, steady: 3, trend: 2, volume: 1 };
  const cand = new Map();
  for (const [key, rows] of Object.entries(lists)) {
    rows.forEach((r, idx) => {
      const c = cand.get(r.ticker) || { ...r, hits: [], score: 0, reasons: [], warn: false };
      c.hits.push(key);
      c.score += W[key] + Math.max(0, 10 - idx) * 0.05; // 리스트 상위 가중
      if (r.freshDays === 1) c.score += 0.5;
      if (r.grade === 'A') c.score += 1;      // 맥락 A급 가산
      if (r.warn) { c.score -= 3; c.warn = true; } // 과열·추격 경고는 감점
      c.reasons = [...new Set([...c.reasons, ...r.reasons])];
      cand.set(r.ticker, c);
    });
  }
  // 수급 근거 필수 + 경고(과열·추격) 종목은 집중 후보에서 제외
  let picks = [...cand.values()].filter((c) => (c.hits.includes('supply') || c.hits.includes('steady')) && !c.warn);
  if (picks.length < 3) picks = [...cand.values()].filter((c) => !c.warn);
  if (picks.length < 3) picks = [...cand.values()];
  picks.sort((a, b) => b.score - a.score);

  return picks.slice(0, 3).map((c) => {
    const q = qMap.get(c.ticker) || [];
    const closes = q.map((r) => r.close);
    const last = closes.at(-1);
    const ma20v = sma(closes, 20);
    const hi60 = closes.length >= 5 ? Math.max(...closes.slice(-60)) : null;
    // 참고 레벨 (기계적 계산):
    //   손절 = 20일선, 단 -8%보다 깊으면 -8%로 제한 (급등주는 20일선이 너무 멀다)
    //   목표 = 60일 고가, 단 +15%로 제한. 고가가 가까우면 +10%
    const stopRaw = ma20v && ma20v < last ? ma20v : last * 0.93;
    const stop = Math.round(Math.max(stopRaw, last * 0.92));
    const targetRaw = hi60 && hi60 > last * 1.03 ? hi60 : last * 1.10;
    const target = Math.round(Math.min(targetRaw, last * 1.15));
    return {
      ticker: c.ticker, name: c.name, sector: c.sector, market: c.market,
      change: c.change, amountEok: c.amountEok, freshDays: c.freshDays,
      hits: c.hits, reasons: c.reasons.slice(0, 4),
      entry: last,
      stop, stopPct: Math.round((stop / last - 1) * 1000) / 10,
      target, targetPct: Math.round((target / last - 1) * 1000) / 10,
    };
  });
}

// ── 추적 관찰 — 최근 발굴 종목의 "그 후" (처음 포착일 기준 수익률) ────────────
const LIST_ORDER = ['supply', 'steady', 'trend', 'volume'];
function buildTracking(history, histDates, qMap, nameOf, today, todayLists) {
  const anchor = new Map(); // ticker → { date, list } (기간 내 최초 포착)
  for (const d of histDates.slice(-DISCOVER.recordWindowDays)) {
    for (const key of LIST_ORDER) {
      for (const t of history[d]?.[key] || []) {
        if (!anchor.has(t)) anchor.set(t, { date: d, list: key });
      }
    }
  }
  for (const key of LIST_ORDER) {
    for (const r of todayLists[key]) {
      if (!anchor.has(r.ticker)) anchor.set(r.ticker, { date: today, list: key });
    }
  }
  const todaySet = new Set(Object.values(todayLists).flat().map((r) => r.ticker));

  const rows = [];
  for (const [t, a] of anchor) {
    const q = qMap.get(t);
    if (!q) continue;
    const idx = q.findIndex((r) => r.date === a.date);
    if (idx < 0) continue;
    const pick = q[idx].close, cur = q.at(-1).close;
    rows.push({
      ticker: t, name: nameOf(t), pickedAt: a.date, list: a.list,
      pickClose: pick, curClose: cur,
      ret: Math.round((cur / pick - 1) * 1000) / 10,
      tradingDays: q.length - 1 - idx,
      stillListed: todaySet.has(t),
    });
  }
  // 과거 포착분(수익률이 있는 것)이 본체 — 오래된 순으로 "그 후"를 보여준다.
  // 과거 이력이 하나도 없을 때(첫날)만 오늘 포착분을 자리표시로 노출.
  const past = rows.filter((r) => r.tradingDays > 0);
  past.sort((x, y) => x.pickedAt.localeCompare(y.pickedAt) || y.ret - x.ret);
  if (past.length) return past.slice(0, 200);
  return rows.slice(0, 60);
}

// ── 성적표 — 과거 리스트 종목의 D+N 수익률 vs 유니버스 평균 ──────────────────
// 전체 + 관점별(수급/추세/거래)로 나눠 집계해 "어떤 관점이 먹히는지" 보여준다.
function buildRecord(history, dates, qMap, today) {
  const H = DISCOVER.recordHorizon;
  const recent = dates.filter((d) => d < today).slice(-DISCOVER.recordWindowDays);

  // 날짜별 D+H 수익률 조회 헬퍼 + 벤치마크(유니버스 평균) 캐시
  const retOf = (t, d) => {
    const rows = qMap.get(t);
    if (!rows) return null;
    const idx = rows.findIndex((r) => r.date === d);
    if (idx < 0 || idx + H >= rows.length) return null;
    return rows[idx + H].close / rows[idx].close - 1;
  };
  const benchByDate = new Map();
  for (const d of recent) {
    let sum = 0, n = 0;
    for (const [t] of qMap) {
      const r = retOf(t, d);
      if (r != null) { sum += r; n++; }
    }
    if (n) benchByDate.set(d, sum / n);
  }

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const compute = (keys) => {
    const picks = [], benches = [];
    for (const d of recent) {
      if (!history[d] || !benchByDate.has(d)) continue;
      const tickers = [...new Set(keys.flatMap((k) => history[d][k] || []))];
      let used = false;
      for (const t of tickers) {
        const r = retOf(t, d);
        if (r != null) { picks.push(r); used = true; }
      }
      if (used) benches.push(benchByDate.get(d));
    }
    if (!picks.length) return { samples: 0 };
    return {
      samples: picks.length,
      horizon: H,
      avgReturn: Math.round(avg(picks) * 1000) / 10,
      hitRate: Math.round((picks.filter((r) => r > 0).length / picks.length) * 100),
      benchReturn: Math.round(avg(benches) * 1000) / 10,
    };
  };

  return {
    ...compute(LIST_ORDER),
    byList: Object.fromEntries(LIST_ORDER.map((k) => [k, compute([k])])),
  };
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const stocks = await read('stocks.json');
  const quotes = await read('quotes.json');
  const supply = await read('supply.json');

  const byTicker = (rows) => {
    const m = new Map();
    for (const r of rows) { (m.get(r.ticker) || m.set(r.ticker, []).get(r.ticker)).push(r); }
    for (const [k, v] of m) {
      v.sort((a, b) => a.date.localeCompare(b.date));
      // 동일 날짜 중복 행 제거 (수집 중복 방어 — 연속일·차트 왜곡 방지)
      m.set(k, v.filter((r, i) => i === 0 || r.date !== v[i - 1].date));
    }
    return m;
  };
  const qMap = byTicker(quotes), sMap = byTicker(supply);
  const today = quotes.at(-1)?.date || new Date().toISOString().slice(0, 10);

  const history = (await tryRead('discover-history.json')) || {};
  const histDates = Object.keys(history).filter((d) => d !== today).sort();

  // 1) 오늘 기준 발굴 리스트 + 신선도 부착 (전일 뉴스 감성은 호재 태그로 활용)
  const newsPrev = await tryRead('news.json');
  const newsMap = newsPrev ? new Map(newsPrev.items.map((n) => [n.ticker, n.rawScore])) : null;
  const day = buildDayLists(stocks, qMap, sMap, newsMap);
  if (!day.universe) { console.error('[discover] 유효 종목 0개 — fetch 먼저 실행'); process.exit(1); }
  const lists = Object.fromEntries(Object.entries(day.lists).map(([key, rows]) =>
    [key, rows.map((r) => ({ ...r, freshDays: freshness(history, histDates, key, r.ticker, today) }))]));

  // 2) 테마 쏠림 — 오늘 발굴 종목(중복 제거)이 특정 테마에 20% 이상 몰리면 표시
  const byTickerSector = new Map();
  for (const r of Object.values(lists).flat()) byTickerSector.set(r.ticker, r.sector);
  const themeCount = new Map();
  for (const sec of byTickerSector.values()) {
    if (sec) themeCount.set(sec, (themeCount.get(sec) || 0) + 1);
  }
  const topTheme = [...themeCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const themeFocus = topTheme && byTickerSector.size >= 10 && topTheme[1] / byTickerSector.size >= 0.2
    ? { name: topTheme[0], count: topTheme[1], share: Math.round((topTheme[1] / byTickerSector.size) * 100) }
    : null;

  // 3) 추적 관찰 + 성적표 (오늘 리스트 저장 전, 과거 이력 기준으로 계산)
  const nameMap = new Map(stocks.map((s) => [s.ticker, s.name]));
  const nameOf = (t) => nameMap.get(t) || t;
  const tracking = buildTracking(history, histDates, qMap, nameOf, today, lists);
  const record = buildRecord(history, histDates, qMap, today);
  const focus = buildFocus(lists, qMap);

  // 4) 발굴 이력 갱신
  history[today] = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.map((r) => r.ticker)]));
  const keep = Object.keys(history).sort().slice(-DISCOVER.historyKeep);
  const trimmed = Object.fromEntries(keep.map((d) => [d, history[d]]));
  await writeFile(outPath('discover-history.json'), JSON.stringify(trimmed));

  // 5) 시장 온도
  const breadth = day.aboveMa20 / day.universe;
  const regime = breadth >= REGIME.riskOnBreadth ? 'strong' : breadth < REGIME.riskOffBreadth ? 'weak' : 'neutral';

  const out = {
    version: 3, date: today, generated_at: new Date().toISOString(),
    market: { regime, breadth: Math.round(breadth * 100) },
    filter: {
      minAmountEok: FILTER.minAmountEok,
      minMarketCapEok: Math.round(FILTER.minMarketCap / 1e8),
      excludeLoss: FILTER.excludeLoss,
      universe: day.universe, passed: day.passed,
    },
    themeFocus, focus, lists, tracking, record,
  };
  await writeFile(outPath('discover.json'), JSON.stringify(out, null, 2));

  // 6) 종목 상세 (차트 모달용 — 오늘 리스트 + 추적 관찰 종목)
  await mkdir(outPath('detail'), { recursive: true });
  const listed = new Set([
    ...Object.values(lists).flat().map((r) => r.ticker),
    ...tracking.map((r) => r.ticker),
  ]);
  for (const ticker of listed) {
    const q = qMap.get(ticker);
    if (!q) continue;
    const sup = sMap.get(ticker) || [];
    const closeByDate = new Map(q.map((r) => [r.date, r.close]));
    await writeFile(outPath(`detail/${ticker}.json`), JSON.stringify({
      ticker, name: nameOf(ticker),
      quotes: q.slice(-120).map((r) => ({ date: r.date, close: r.close, volume: r.volume })),
      supply: sup.slice(-20).map((r) => ({ date: r.date, foreign_net: r.foreign_net, inst_net: r.inst_net, retail_net: r.retail_net ?? null, close: closeByDate.get(r.date) ?? null })),
    }));
  }

  console.log(`[discover] ${today} · 유니버스 ${day.universe} → 필터 통과 ${day.passed}`);
  console.log(`  수급 포착 ${lists.supply.length} · 추세 전환 ${lists.trend.length} · 거래 폭발 ${lists.volume.length} · 장기 매집 ${lists.steady.length} · 시장 ${regime}(${out.market.breadth}%)`);
  if (record.samples) console.log(`  성적표: ${record.samples}건 · D+${record.horizon} 평균 ${record.avgReturn}% (유니버스 ${record.benchReturn}%) · 적중률 ${record.hitRate}%`);
  else console.log('  성적표: 데이터 쌓이는 중 (이력 부족)');
  for (const r of lists.supply.slice(0, 3)) console.log(`    · ${r.name} — ${r.reasons.join(' · ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
