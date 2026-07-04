// 업종코드 → 업종명 매핑. 네이버 업종코드 자체는 하루 종가에 딸려오지만 이름은 별도 페이지에만 있다.
// https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no={code} 의 <title> 에서 추출 (EUC-KR).
// 코드-이름 관계는 거의 불변이라 outPath('sector-map.json') 에 영구 캐시 — 이후엔 신규 코드만 fetch.

import { readFile, writeFile } from 'node:fs/promises';
import { outPath } from './paths.js';

let cache = null;

async function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(await readFile(outPath('sector-map.json'), 'utf8')); }
  catch { cache = {}; }
  return cache;
}

async function fetchSectorName(code) {
  try {
    const res = await fetch(`https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=${code}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const text = new TextDecoder('euc-kr').decode(buf);
    const m = text.match(/<title>([^<:：]+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// codes: 이번에 등장한 고유 업종코드 배열 → { code: name } 반환 (캐시 미보유분만 네트워크 조회)
export async function resolveSectorNames(codes) {
  const c = await loadCache();
  const missing = [...new Set(codes.filter((x) => x != null && !(String(x) in c)))];
  if (missing.length) {
    console.log(`  · 업종명 신규 조회 ${missing.length}건`);
    for (const code of missing) {
      c[code] = await fetchSectorName(code);
      await new Promise((r) => setTimeout(r, 60));
    }
    await writeFile(outPath('sector-map.json'), JSON.stringify(c));
  }
  return c;
}
