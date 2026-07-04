// Supabase REST 헬퍼 — 의존성 0 (Node 18+ 내장 fetch 사용)
// service_role 키로 upsert / 조회. 키 없으면 null 반환 → 호출부에서 JSON 폴백.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

export const hasSupabase = Boolean(URL && KEY);

function headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// rows 배열을 테이블에 upsert (primary key 충돌 시 갱신). 대량은 청크 분할.
export async function upsert(table, rows, { chunk = 1000 } = {}) {
  if (!hasSupabase) return { skipped: true };
  if (!rows?.length) return { count: 0 };
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const res = await fetch(`${URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(part),
    });
    if (!res.ok) throw new Error(`upsert ${table} 실패: ${res.status} ${await res.text()}`);
  }
  return { count: rows.length };
}

// 간단 select (?key=eq.value 형태 query 문자열)
export async function select(table, query = '') {
  if (!hasSupabase) return null;
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, { headers: headers() });
  if (!res.ok) throw new Error(`select ${table} 실패: ${res.status}`);
  return res.json();
}

// 페이지네이션 전체 조회 (PostgREST 기본 1000행 상한 우회)
export async function selectAll(table, { select = '*', order = '', extra = '', page = 1000 } = {}) {
  if (!hasSupabase) return null;
  const out = [];
  for (let offset = 0; ; offset += page) {
    const q = `select=${select}${order ? `&order=${order}` : ''}${extra ? `&${extra}` : ''}` +
      `&limit=${page}&offset=${offset}`;
    const res = await fetch(`${URL}/rest/v1/${table}?${q}`, { headers: headers() });
    if (!res.ok) throw new Error(`selectAll ${table} 실패: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

// 행 수 (HEAD + count=exact → Content-Range 헤더 파싱). 테이블 점검용.
export async function count(table) {
  if (!hasSupabase) return null;
  const res = await fetch(`${URL}/rest/v1/${table}?select=*`, {
    method: 'HEAD',
    headers: headers({ Prefer: 'count=exact', Range: '0-0' }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const cr = res.headers.get('content-range') || '';     // 예: "0-0/1234"
  return Number(cr.split('/')[1] || 0);
}

export { URL as SUPABASE_URL };
