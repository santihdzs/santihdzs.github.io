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
    let rel;
    try {
      rel = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
      // a malformed escape names no file
      await notFound(req, res);
      return;
    }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    const inside = path.relative(ROOT, file);
    const outside = inside === '' || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside);
    if (outside || rel.split('/').some((s) => s.startsWith('.') && s !== '.well-known') || rel.startsWith('tools/')) {
      await notFound(req, res);
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      send(req, res, 200, await readFile(file), path.extname(file));
    } catch {
      await notFound(req, res);
    }
  });
  // loopback only: the repo, tools and all, is never served to the network
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function send(req, res, status, body, ext) {
  const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' };
  if (COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    body = gzipSync(body);
    headers['content-encoding'] = 'gzip';
  }
  res.writeHead(status, headers).end(body);
}

// like github pages: unknown paths get 404.html, with a real 404 status, at the url that was asked for
async function notFound(req, res) {
  try {
    send(req, res, 404, await readFile(path.join(ROOT, '404.html')), '.html');
  } catch {
    res.writeHead(404).end('not found');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startServer();
  console.log(`serving ${ROOT}\n  http://127.0.0.1:${PORT}/\n  http://127.0.0.1:${PORT}/sub/`);
}
