// dev only static server. serves the repo at / and at /sub/ to prove relative paths hold.
// usage: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const PREFIXES = ['/sub/', '/'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);

export function startServer(port = PORT) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const prefix = PREFIXES.find((p) => url.pathname.startsWith(p));
    // a subpath without its trailing slash would break relative urls, redirect like pages does
    if (url.pathname === '/sub') {
      res.writeHead(301, { location: '/sub/' }).end();
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(prefix.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || rel.split('/').some((s) => s.startsWith('.') && s !== '.well-known') || rel.startsWith('tools/')) {
      res.writeHead(404).end('not found');
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      let body = await readFile(file);
      const ext = path.extname(file);
      const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' };
      if (COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
        body = gzipSync(body);
        headers['content-encoding'] = 'gzip';
      }
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startServer();
  console.log(`serving ${ROOT}\n  http://localhost:${PORT}/\n  http://localhost:${PORT}/sub/`);
}
