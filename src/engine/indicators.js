// 기술지표 유틸리티 — V2 score.js 에서 검증된 수식 이관.
// 모든 함수는 데이터 부족 시 null(또는 중립값)을 반환하고 던지지 않는다.

export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export function sma(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(-n).reduce((a, b) => a + b, 0) / n;
}

// EMA 전체 시계열 (arr[n-1]부터 시작)
export function emaAll(arr, n) {
  if (arr.length < n) return [];
  const k = 2 / (n + 1);
  let e = arr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const out = [e];
  for (let i = n; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out.push(e); }
  return out;
}

export function rsi(closes, n = 14) {
  if (closes.length < n + 1) return 50;
  let gain = 0, loss = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = (gain / n) / (loss / n);
  return 100 - 100 / (1 + rs);
}

export function stdev(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

export function stochastic(q, n = 14, d = 3) {
  if (q.length < n + d) return null;
  const kAt = (idx) => {
    const w = q.slice(idx - n + 1, idx + 1);
    const hi = Math.max(...w.map((x) => x.high)), lo = Math.min(...w.map((x) => x.low));
    return hi === lo ? 50 : ((q[idx].close - lo) / (hi - lo)) * 100;
  };
  const ks = [];
  for (let i = q.length - d; i < q.length; i++) ks.push(kAt(i));
  return { k: kAt(q.length - 1), d: ks.reduce((a, b) => a + b, 0) / ks.length };
}

// MACD(12/26/9) — 골든크로스 여부·히스토그램
export function macd(closes) {
  if (closes.length < 35) return null;
  const e12 = emaAll(closes, 12);
  const e26 = emaAll(closes, 26);
  const macdLine = e26.map((v, i) => e12[i + 14] - v); // e12/e26 시작 오프셋 차 = 14
  if (macdLine.length < 9) return null;
  const signalSeries = emaAll(macdLine, 9);
  const last = macdLine.at(-1), sig = signalSeries.at(-1);
  const prev = macdLine.at(-2), prevSig = signalSeries.at(-2);
  return {
    macd: last, signal: sig,
    histogram: last - sig,
    crossover: prev !== undefined && prevSig !== undefined && prev <= prevSig && last > sig,
    aboveZero: last > 0,
  };
}

// OBV — 최근 20일 상승 여부 + 정규화 기울기(가격 횡보 대비 매집 탐지용)
export function obv(q) {
  if (q.length < 2) return null;
  const arr = [0];
  for (let i = 1; i < q.length; i++) {
    const v = q[i].volume;
    arr.push(arr.at(-1) + (q[i].close > q[i - 1].close ? v : q[i].close < q[i - 1].close ? -v : 0));
  }
  const window = Math.min(20, arr.length - 1);
  const totVol = q.slice(-window).reduce((a, r) => a + r.volume, 0) || 1;
  return {
    rising: arr.at(-1) > arr.at(-window - 1),
    slope: (arr.at(-1) - arr.at(-window - 1)) / totVol, // -1 ~ +1 근사
  };
}

// MFI — 거래량 가중 RSI
export function mfi(q, n = 14) {
  if (q.length < n + 1) return 50;
  let pos = 0, neg = 0;
  const tp = (r) => (r.high + r.low + r.close) / 3;
  for (let i = q.length - n; i < q.length; i++) {
    const now = tp(q[i]), prev = tp(q[i - 1]);
    const flow = now * q[i].volume;
    if (now > prev) pos += flow; else neg += flow;
  }
  if (neg === 0) return 100;
  return 100 - 100 / (1 + pos / neg);
}

// 연속 양수 일수 (수급 연속 순매수 등)
export const streak = (arr) => { let c = 0; for (let i = arr.length - 1; i >= 0 && arr[i] > 0; i--) c++; return c; };

// n일 수익률(%) — 데이터 부족 시 null
export function ret(closes, n) {
  if (closes.length < n + 1) return null;
  return ((closes.at(-1) / closes.at(-(n + 1))) - 1) * 100;
}
