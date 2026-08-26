# Stock Discovery V3 — 오늘의 발굴

> 공통 규칙(전 프로젝트 적용): [workspace-governance](https://github.com/shopyubi81-coder/workspace-governance)

한국장(코스피+코스닥) 종목 발굴 도구. **"아침 5분, 오늘 볼 종목 20개와 그 이유"** — 리스트 한 장.
Node.js 런타임 의존성 0 (내장 fetch만).

## 개념

발굴 = 거르기 → 줄세우기 → 이유 보여주기. 화면은 원페이지 하나다.

1. **안전 필터** (상시 표시) — 거래대금 100억↑ · 시총 1,000억↑ · 적자 제외. 초보자 보호 장치.
2. **관점 리스트 3개** (탭) — 하나의 종합점수 대신, 질문이 다른 리스트 3개:
   - **수급 포착**: 외국인·기관이 모으기 시작한 종목 (연속 매수 강도 순)
   - **추세 전환**: 오늘 정배열 진입·골든크로스·돌파가 발생한 종목
   - **거래 폭발**: 거래대금이 평소 대비 2배 이상 급증한 종목
3. **이유 문장** — 각 종목에 "외국인 5일 연속 매수 · 60일 신고가"처럼 검증 가능한 근거 표시.
4. **신선도** — "오늘 진입" vs "N일째 포착" 배지. 추격 매수 방지.
5. **추적 관찰** — 최근 2주간 발굴된 종목마다 처음 포착일 종가 기준 현재 수익률을 개별 추적. 오늘도 리스트에 남아있으면 초록점 표시.
6. **성적표** — 과거 리스트에 뽑힌 종목의 D+5 실제 수익률 vs 유니버스 평균, 적중률. 도구가 스스로 책임진다.

종목 클릭 → 60일 주가 차트 + 외국인·기관 수급 차트 + 발굴 근거 상세 (모달).

## 실행

```bash
FETCH_MODE=live npm run build            # 수집 + 발굴 (기본은 sample 더미)
npm run serve                            # http://localhost:5273/
BACKFILL_START=2026-06-15 npm run backfill  # 과거 발굴 이력 소급 재구성 (기존 이력 대체) → 이후 npm run score
```

작업 스케줄러 `StockDiscoveryV3Daily` 가 평일 18:40 에 `scripts/daily_batch.cmd` 를 자동 실행한다 (로그: `%TEMP%\stock-discovery-v3\batch.log`).

## 구조

```
src/
  fetch_daily.js       수집 (V2 검증본 재사용 — 네이버 모바일 API)
  server.js            의존성0 정적 서버 (:5273)
  lib/                 naver.js · supabase.js · sample.js · paths.js(EPERM 우회)
  engine/
    config.js          안전 필터·발굴 기준·레짐·테마 사전 (조정은 여기서)
    indicators.js      SMA/EMA/RSI/MACD/OBV/MFI 등
    signals.js         전환 신호 감지 (정배열 진입·GC·BB돌파 등)
    discover.js        메인 — 필터→리스트→신선도→성적표 → discover.json
public/
  index.html + css/main.css + js/app.js   원페이지 UI (다크 인디고)
```

산출물: `discover.json`(리스트), `detail/{ticker}.json`(차트), `discover-history.json`(발굴 이력 30일 — 신선도·성적표 계산에 사용).

## 주의

- 알약 백신 EPERM → 산출물은 `%TEMP%/stock-discovery-v3` (env `OUT_DIR` 로 변경 가능)
- 샘플 모드 테스트 시 `.env` 로드 없이 실행 (`node src/fetch_daily.js`) — 공유 Supabase 오염 방지
- 성적표는 발굴 이력이 D+5 이상 누적된 뒤부터 표시됨
- 신선도 연속 계산은 달력 공백 4일 초과 시 리셋 (연휴는 유지, 배치 장기 중단은 끊김)
