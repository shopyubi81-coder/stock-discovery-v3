// 의존성 0 정적 서버 — public/ 을 서빙.
//   실행:  npm run serve   →  http://localhost:5273/
//
// 생성 데이터(/data/*.json)는 OUT_DIR(쓰기 가능 폴더)에서 읽는다.
// 없으면 public/data 의 기본본(샘플/배포본)으로 폴백.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { outPath } from './lib/paths.js';

const PORT = process.env.PORT || 5273;
const ROOT = new URL('../public/', import.meta.url);
const PUB_DATA = new URL('../public/data/', import.meta.url);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]);
  if (path === '/') path = '/index.html';

  const send = (buf) => {
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(buf);
  };

  // /data/<file> → OUT_DIR 우선, 없으면 public/data 폴백
  if (path.startsWith('/data/')) {
    const file = path.slice('/data/'.length);
    try { return send(await readFile(outPath(file))); }
    catch {
      try { return send(await readFile(new URL(file, PUB_DATA))); }
      catch { /* 아래 404 */ }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('아직 데이터가 없습니다. npm run build 를 먼저 실행하세요.');
  }

  // 그 외 정적 파일 (public/)
  try {
    send(await readFile(new URL('.' + path, ROOT)));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + path);
  }
}).listen(PORT, () => console.log(`▶ http://localhost:${PORT}/`));
