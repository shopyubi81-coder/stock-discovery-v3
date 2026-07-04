// 일회성 시드 — V2 가 Supabase supply_demand 에 쌓아둔 수급 이력을
// V3 의 supply.json 에 병합한다. (네이버가 5일치만 주는 한계 보완)
//   실행:  node --env-file-if-exists=.env scripts/seed_supply.js

import { readFile, writeFile } from 'node:fs/promises';
import { selectAll, hasSupabase } from '../src/lib/supabase.js';
import { outPath } from '../src/lib/paths.js';

async function main() {
  if (!hasSupabase) { console.error('SUPABASE 키 없음 — .env 확인'); process.exit(1); }

  const raw = JSON.parse(await readFile(outPath('supply.json'), 'utf8'));
  // 기존 파일 중복 제거 (안전장치)
  const seen = new Set();
  const supply = raw.filter((r) => {
    const k = r.ticker + '|' + r.date;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  if (supply.length !== raw.length) console.log(`기존 중복 ${raw.length - supply.length}행 제거`);

  // ⚠ 오프셋 페이지네이션은 정렬키가 고유해야 중복·누락이 없다 (ticker+date = PK)
  const rows = await selectAll('supply_demand', {
    select: 'ticker,date,foreign_net,inst_net,retail_net',
    order: 'ticker.asc,date.asc',
    extra: 'date=gte.2026-06-01',
  });
  console.log(`Supabase supply_demand: ${rows.length}행 조회`);

  let added = 0;
  for (const r of rows) {
    const k = r.ticker + '|' + r.date;
    if (seen.has(k)) continue;
    seen.add(k);
    supply.push(r);
    added++;
  }
  supply.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date));
  await writeFile(outPath('supply.json'), JSON.stringify(supply, null, 2));

  const dates = [...new Set(supply.map((r) => r.date))].sort();
  console.log(`병합 완료: +${added}행 → 총 ${supply.length}행 (${dates[0]} ~ ${dates.at(-1)})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
