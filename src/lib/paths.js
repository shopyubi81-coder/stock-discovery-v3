// 출력 경로 — node 가 프로젝트 폴더에 못 쓰는 환경(백신 등) 대응.
// 생성 파일(시세/점수 등)은 쓰기 가능한 OUT_DIR 로 모은다.
//   기본: %TEMP%/stock-discovery-v3   (override: 환경변수 OUT_DIR)
// 데이터 영구 보관은 Supabase 가 담당하므로 OUT_DIR 은 캐시 성격.

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'stock-discovery-v3');

try { mkdirSync(OUT_DIR, { recursive: true }); } catch { /* 이미 있음 */ }

export const outPath = (name) => path.join(OUT_DIR, name);
