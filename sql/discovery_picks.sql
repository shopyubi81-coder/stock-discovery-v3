-- discovery_picks — 이 프로젝트가 오늘 새로 포착한 종목을 AlphaFactory가
-- 읽어가는 표. 크로스 프로젝트 통합 3단계(2026-09-11, "C안": AlphaFactory는
-- 더 이상 직접 발굴하지 않고, 이 프로젝트가 발굴한 것을 측정만 한다).
--
-- 왜 필요한가: AlphaFactory의 rolling_ic.py(중첩보정 Spearman IC, 최소표본
-- 게이트)는 이 프로젝트가 쓰는 단순 D+5 평균보다 측정 방법론이 엄밀하다.
-- 그런데 AlphaFactory 자체 스크리닝은 하루 평균 1건이 안 나올 만큼 느려서
-- (2026-05~09, 4개월간 실전 픽 7건) 그 측정기가 표본 기아 상태였다.
-- 이 프로젝트는 하루 평균 65건(4개 리스트 합산)을 발굴한다 — 발굴은 여기서,
-- 측정은 AlphaFactory에서 하도록 역할을 나눈다.
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 새 쿼리에 붙여넣고 Run.
--   https://supabase.com/dashboard/project/xjmktxwnyesxvvigypqj/sql/new
-- 멱등하다 — 여러 번 실행해도 안전하다.

-- 기본 키를 (ticker, market, discovered_on) 복합키로 둔다 — 대리키(id)가
-- 아니다. 이유: stock-discovery-v3 의 공용 upsert 헬퍼(src/lib/supabase.js)가
-- on_conflict 쿼리파라미터를 넘기지 않고 `resolution=merge-duplicates` 만
-- 쓴다 — 이 경우 PostgREST 는 **테이블의 기본 키**를 자동으로 충돌 기준으로
-- 삼는다. 대리키를 썼다면 매번 새 id 라 절대 충돌하지 않고, 그러면서
-- (ticker,market,discovered_on) unique 제약은 위반돼 매일 실패했을 것이다.
-- stocks/daily_quotes/supply_demand 표도 전부 이 방식(자연키를 기본 키로)을
-- 쓰고 있어 여기서도 그 관례를 따른다.
create table if not exists public.discovery_picks (
  ticker         text        not null,   -- KR: 6자리 코드(005930) / US: 그대로(AAPL)
  market         text        not null,   -- KR / US
  name           text        not null,
  sector         text,

  -- 그날 여러 리스트에 동시에 걸리면 우선순위가 가장 높은 리스트 하나만 남긴다
  -- (supply > steady > trend > volume — discover.js LIST_ORDER와 동일).
  -- AlphaFactory 쪽 픽 원장은 종목당 앵커 하나뿐이라 여러 행을 만들 이유가 없다.
  list_key       text        not null,   -- supply / steady / trend / volume
  grade          text,                   -- A / B / C (judge*() 의 등급, 없으면 null)

  -- 리스트가중치(3/3/2/1) × 등급가중치(A1.5/B1/C0.4) — config.js THEME_FLOW 와
  -- 완전히 같은 공식. 이 프로젝트가 테마 생애주기 분류에 이미 쓰고 있는
  -- 검증된 가중치를 그대로 재사용한다(이 표를 위해 새로 지어낸 숫자가 아니다).
  -- AlphaFactory 의 discovery_metric_pct(YoY 성장률, %)와는 단위가 다르므로
  -- 절대 그 필드에 넣지 않는다 — 별도 필드로 정직하게 구분해서 넘긴다.
  signal_score   numeric     not null,

  discovered_on  date        not null,   -- 오늘 날짜(그날 실행 기준)
  price          numeric     not null,   -- 그날 종가
  currency       text        not null,   -- KRW / USD

  updated_at     timestamptz not null default now(),
  primary key (ticker, market, discovered_on)
);

create index if not exists discovery_picks_recent_idx
  on public.discovery_picks (discovered_on desc);

-- 읽기는 anon 으로 충분하다 — AlphaFactory 는 1단계(수급 통합) 때 이미
-- 이 프로젝트와 같은 anon 키를 .env 에 받아뒀다. 새 시크릿이 필요 없다.
-- 쓰기는 이 프로젝트의 service_role 키로만(RLS 우회).
alter table public.discovery_picks enable row level security;

drop policy if exists discovery_picks_read on public.discovery_picks;
create policy discovery_picks_read
  on public.discovery_picks
  for select
  to anon, authenticated
  using (true);

comment on table public.discovery_picks is
  'stock-discovery-v3가 매일 적재하는 신규 발굴. AlphaFactory의 rolling_ic.py가 읽어 중첩보정 IC를 측정한다. 2026-09-11 신설.';
