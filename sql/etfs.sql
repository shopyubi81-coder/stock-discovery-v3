-- etfs — ETF 전용 지표(NAV/괴리율/보수/추적오차/분배수익률/구성종목/섹터·국가
-- 비중). src/fetch_etf.js가 매일 갱신한다 (2026-09-22 신설, ETF 파이프라인
-- 배선 작업의 일부 — fetchEtfUniverse/fetchEtfBundleMany는 이미 있었지만
-- 실행부에 안 불려서 죽은 코드였음).
--
-- daily_quotes/supply_demand과 역할이 안 겹친다: ETF 가격은 daily_quotes에
-- 그대로 들어가고(같은 ticker/date/OHLCV 스키마, 주식과 구분 안 함), ETF
-- 수급은 force_track.js로 별도 확보해 supply_demand에 들어간다. 이 표는
-- 그 둘로는 못 담는, ETF에만 있는 지표만 담는다.
--
-- "current snapshot" 성격이다(stocks 표와 동일) — 시계열이 아니라 티커당
-- 최신 상태 1행만 유지. 그래서 기본 키가 ticker 단독이다(supply_demand처럼
-- (ticker,date) 복합키가 아님) — 매일 upsert가 그날 값으로 덮어쓴다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 새 쿼리에 붙여넣고 Run.
--   https://supabase.com/dashboard/project/xjmktxwnyesxvvigypqj/sql/new
-- 멱등하다 — 여러 번 실행해도 안전하다.
create table if not exists public.etfs (
  ticker         text        not null,   -- 6자리 코드(069500) 또는 영문4자리(0162Z0 등)
  name           text        not null,
  market         text        not null,   -- KOSPI / KOSDAQ
  market_cap     numeric,

  issuer         text,                   -- 운용사 ("삼성자산운용" 등)
  base_index     text,                   -- 추종 지수
  listed_date    text,                   -- YYYYMMDD (네이버 원문 그대로, 파싱 안 함)

  nav            numeric,                -- 순자산가치
  deviation      numeric,                -- 괴리율(%)
  fee            numeric,                -- 총보수(%)
  track_err      numeric,                -- 추적오차율(%)

  ret_1m         numeric,                -- 1개월 수익률(%)
  ret_3m         numeric,                -- 3개월 수익률(%)
  ret_1y         numeric,                -- 1년 수익률(%)
  div_yield      numeric,                -- 분배수익률(%, TTM)

  top10          jsonb,                  -- [{code,name,weight}, ...] 구성종목 상위10
  sectors        jsonb,                  -- [{name,weight}, ...] 섹터 비중
  countries      jsonb,                  -- [{name,weight}, ...] 국가 비중

  updated_at     timestamptz not null default now(),
  primary key (ticker)
);

-- 읽기는 anon으로 충분 — AlphaFactory가 이미 갖고 있는 같은 anon 키로
-- 새 시크릿 없이 바로 읽을 수 있다. 쓰기는 이 프로젝트의 service_role로만.
alter table public.etfs enable row level security;

drop policy if exists etfs_read on public.etfs;
create policy etfs_read
  on public.etfs
  for select
  to anon, authenticated
  using (true);

comment on table public.etfs is
  'stock-discovery-v3가 매일 갱신하는 ETF 전용 지표(NAV/괴리율/보수/구성종목 등). 티커당 최신 상태 1행. 2026-09-22 신설.';
