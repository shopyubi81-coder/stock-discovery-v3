// 전환 신호 감지 — 당일 발생한 이벤트성 신호 (V2 검증 로직 이관·정리)
// grade: A(강) / B(중) / C(약)

import { sma, rsi, stdev, macd, streak } from './indicators.js';

export function computeSignals(closes, q, sup) {
  const n = closes.length;
  if (n < 22) return [];
  const signals = [];
  const prev = closes.slice(0, -1);
  const ma5 = sma(closes, 5), ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20), ma60 = sma(closes, 60);
  const pm5 = sma(prev, 5), pm10 = sma(prev, 10), pm20 = sma(prev, 20);

  const align = (m5, m20, m60) => !!(m5 && m20 && m60 && m5 > m20 && m20 > m60);
  if (align(ma5, ma20, ma60) && !align(pm5, pm20, sma(prev, 60)))
    signals.push({ code: 'align_new', label: '정배열 진입', grade: 'A' });
  if (ma5 && ma10 && pm5 && pm10 && pm5 <= pm10 && ma5 > ma10)
    signals.push({ code: 'cross_5_10', label: '5/10 골든크로스', grade: 'B' });
  if (ma5 && ma20 && pm5 && pm20 && pm5 <= pm20 && ma5 > ma20)
    signals.push({ code: 'cross_5_20', label: '5/20 골든크로스', grade: 'A' });
  if (ma10 && ma20 && pm10 && pm20 && pm10 <= pm20 && ma10 > ma20)
    signals.push({ code: 'cross_10_20', label: '10/20 골든크로스', grade: 'B' });

  const rNow = rsi(closes), rPrev = rsi(prev);
  if (rPrev < 30 && rNow >= 30)
    signals.push({ code: 'rsi_recover', label: 'RSI 과매도 탈출', grade: 'B' });

  if (ma20 && prev.length >= 20) {
    const sd = stdev(closes.slice(-20)), bbUp = ma20 + 2 * sd;
    const psd = stdev(prev.slice(-20)), pm20v = sma(prev, 20);
    if (pm20v && psd && (4 * psd) / pm20v < 0.12 && closes.at(-1) > bbUp)
      signals.push({ code: 'bb_break', label: 'BB 수축→상단돌파', grade: 'A' });
  }
  if (q.length >= 3) {
    const vols = q.map((r) => r.volume);
    const avgV = sma(vols.slice(0, -1), Math.min(20, vols.length - 1));
    if (avgV && vols.at(-1) >= 2 * avgV && vols.at(-2) < 2 * avgV)
      signals.push({ code: 'vol_surge', label: '거래량 2배 급변', grade: 'C' });
  }
  if (n >= 3) {
    const priorHi = Math.max(...closes.slice(-60, -1));
    if (closes.at(-1) > priorHi)
      signals.push({ code: 'new_high_60', label: '60일 신고가', grade: 'B' });
  }

  const m = macd(closes);
  if (m?.crossover) signals.push({ code: 'macd_gc', label: 'MACD 골든크로스', grade: 'A' });

  if (sup.length) {
    const fS = streak(sup.map((r) => r.foreign_net));
    const iS = streak(sup.map((r) => r.inst_net));
    if (fS === 1) signals.push({ code: 'foreign_start', label: '외인 순매수 시작', grade: 'C' });
    if (fS === 3) signals.push({ code: 'foreign_3d',    label: '외인 3일 연속',    grade: 'B' });
    if (fS === 5) signals.push({ code: 'foreign_5d',    label: '외인 5일 연속',    grade: 'A' });
    if (iS === 1) signals.push({ code: 'inst_start',    label: '기관 순매수 시작', grade: 'C' });
    if (iS === 3) signals.push({ code: 'inst_3d',       label: '기관 3일 연속',    grade: 'B' });
    if (iS === 5) signals.push({ code: 'inst_5d',       label: '기관 5일 연속',    grade: 'A' });
  }
  return signals;
}
