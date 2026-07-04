// 더미 데이터 생성기 — 인터넷/키 없이 UI·스코어링 개발용
// FETCH_MODE=sample 일 때 사용. 실데이터 연결 전까지 전체 파이프를 돌려볼 수 있다.

const NAMES = [
  ['005930', '삼성전자', 'KOSPI', '반도체'],
  ['000660', 'SK하이닉스', 'KOSPI', '반도체'],
  ['373220', 'LG에너지솔루션', 'KOSPI', '2차전지'],
  ['247540', '에코프로비엠', 'KOSDAQ', '2차전지'],
  ['091990', '셀트리온헬스케어', 'KOSDAQ', '바이오'],
  ['035420', 'NAVER', 'KOSPI', '인터넷'],
  ['035720', '카카오', 'KOSPI', '인터넷'],
  ['042700', '한미반도체', 'KOSPI', '반도체장비'],
  ['086520', '에코프로', 'KOSDAQ', '2차전지'],
  ['196170', '알테오젠', 'KOSDAQ', '바이오'],
  ['277810', '레인보우로보틱스', 'KOSDAQ', '로봇'],
  ['012450', '한화에어로스페이스', 'KOSPI', '방산'],
  ['042660', '한화오션', 'KOSPI', '조선'],
  ['010140', '삼성중공업', 'KOSPI', '조선'],
  ['034020', '두산에너빌리티', 'KOSPI', '원전'],
];

// 시드 기반 의사난수(날짜별 재현 가능)
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff);
}

const TODAY = new Date().toISOString().slice(0, 10);

// N일치 시세/수급 히스토리를 종목별로 생성
export function sampleHistory(days = 60) {
  const out = { stocks: [], quotes: [], supply: [] };
  NAMES.forEach(([ticker, name, market, sector], i) => {
    const r = rng(1000 + i);
    out.stocks.push({
      ticker, name, market, sector,
      market_cap: Math.round((1 + r() * 40) * 1e12),
      per: Math.round((5 + r() * 45) * 10) / 10,   // 5~50배
      pbr: Math.round((0.5 + r() * 5) * 100) / 100, // 0.5~5.5배
      op_margin: Math.round((r() * 30 - 5) * 10) / 10, // -5~25% (음수=적자)
      is_active: true,
    });
    let price = 10000 + Math.round(r() * 90000);
    const trend = (r() - 0.4) * 0.01; // 종목별 추세 편향
    for (let d = days - 1; d >= 0; d--) {
      const date = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
      const chg = trend + (r() - 0.5) * 0.04;
      const close = Math.max(1000, Math.round(price * (1 + chg)));
      const high = Math.round(close * (1 + r() * 0.02));
      const low = Math.round(close * (1 - r() * 0.02));
      const volume = Math.round((0.5 + r() * 3) * 1e6);
      out.quotes.push({
        ticker, date,
        open: price, high, low, close,
        volume, value: close * volume,
      });
      const foreign = Math.round((r() - 0.45) * 5e5);
      const inst = Math.round((r() - 0.45) * 3e5);
      out.supply.push({
        ticker, date,
        foreign_net: foreign,
        inst_net: inst,
        retail_net: -(foreign + inst),
      });
      price = close;
    }
  });
  return out;
}

export { TODAY };
