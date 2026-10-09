#!/usr/bin/env node
// builds data/prs.json: pull requests authored by the user in repositories they do not own.
// node 20+, zero dependencies. owner avatars are downloaded to assets/orgs so the site stays local.
// usage: node scripts/build-prs.mjs [--mock] [--out path]

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'scripts', 'prs.config.json');
const LOGO_DIR = path.join(ROOT, 'assets', 'orgs');
const API = 'https://api.github.com';
const TITLE_MAX = 140;
const AVATAR_SIZE = 96;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
// a github login, the only shape an owner may take before it becomes a file name
const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/i;

const DEFAULT_CONFIG = { user: 'santihdzs', allow: [], deny: [], excludeDrafts: true };

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = path.resolve(option('--out') ?? path.join(ROOT, 'data', 'prs.json'));
const log = (...m) => console.error('[prs]', ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(CONFIG_PATH, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`could not read ${CONFIG_PATH}: ${err.message}`);
    return DEFAULT_CONFIG;
  }
}

function resolveToken() {
  const env = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (env) return env.trim();
  try {
    const out = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (out.trim()) return out.trim();
  } catch {
    // gh missing or logged out, fall through
  }
  return null;
}

// rest call with backoff for primary and secondary rate limits and transient errors
async function request(token, url, { raw = false, attempt = 0 } = {}) {
  const MAX_ATTEMPTS = 6;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: raw ? '*/*' : 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'santihdzs-portfolio-prs',
      },
    });
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    await sleep(2 ** attempt * 1000);
    return request(token, url, { raw, attempt: attempt + 1 });
  }
  if (res.status === 401) throw new Error('github rejected the token (401). check GH_TOKEN or gh auth status.');
  const limited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after')));
  if (limited || res.status >= 500) {
    if (attempt >= MAX_ATTEMPTS) throw new Error(`gave up on ${new URL(url).pathname} after ${attempt} retries (status ${res.status})`);
    const retryAfter = Number(res.headers.get('retry-after'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    let wait;
    if (retryAfter > 0) wait = retryAfter * 1000;
    else if (res.headers.get('x-ratelimit-remaining') === '0' && reset) wait = Math.max(reset * 1000 - Date.now(), 0) + 1000;
    else if (limited) wait = 60_000 * 2 ** Math.min(attempt, 3);
    else wait = 2 ** attempt * 1000;
    log(`${limited ? 'rate limited' : `server error ${res.status}`}, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return request(token, url, { raw, attempt: attempt + 1 });
  }
  if (!res.ok) throw new Error(`${new URL(url).pathname} responded ${res.status}`);
  return raw ? res : res.json();
}

// the search api returns at most 1000 results, 100 per page
async function searchPrs(token, user) {
  const q = `author:${user} is:pr -user:${user}`;
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const url = `${API}/search/issues?${new URLSearchParams({ q, per_page: '100', page: String(page), sort: 'created', order: 'desc' })}`;
    const data = await request(token, url);
    items.push(...data.items);
    if (data.incomplete_results) log('github reported incomplete search results, some prs may be missing this run');
    if (data.items.length < 100 || items.length >= data.total_count) break;
  }
  return items;
}

const keyOf = (owner, repo) => `${owner}/${repo}`.toLowerCase();

async function readExisting() {
  try {
    const data = JSON.parse(await readFile(OUT, 'utf8'));
    return data.mock ? null : data;
  } catch {
    return null;
  }
}

async function downloadLogo(token, owner) {
  if (!LOGIN.test(owner)) throw new Error('not a github login');
  const info = await request(token, `${API}/users/${encodeURIComponent(owner)}`);
  if (!info?.avatar_url) throw new Error('no avatar url');
  const url = new URL(info.avatar_url);
  url.searchParams.set('s', String(AVATAR_SIZE));
  const res = await request(token, url.toString(), { raw: true });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const ext = EXT[type];
  if (!ext) throw new Error(`unexpected avatar type ${type || 'unknown'}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await mkdir(LOGO_DIR, { recursive: true });
  const file = path.join(LOGO_DIR, `${owner.toLowerCase()}.${ext}`);
  // only rewrite when the bytes changed, so daily runs keep diffs empty
  const old = await readFile(file).catch(() => null);
  if (!old || !old.equals(bytes)) await writeFile(file, bytes);
  return `./assets/orgs/${owner.toLowerCase()}.${ext}`;
}

// the avatar a previous run committed for this owner, if any
async function existingLogo(owner) {
  if (!LOGIN.test(owner)) return null;
  const files = await readdir(LOGO_DIR).catch(() => []);
  const name = Object.values(EXT)
    .map((ext) => `${owner.toLowerCase()}.${ext}`)
    .find((f) => files.includes(f));
  return name ? `./assets/orgs/${name}` : null;
}

async function pruneLogos(keep) {
  const files = await readdir(LOGO_DIR).catch(() => []);
  for (const f of files) {
    if (!keep.has(f)) await unlink(path.join(LOGO_DIR, f));
  }
}

async function buildReal(config) {
  const token = resolveToken();
  if (!token) {
    console.error('no github token found. set GH_TOKEN or GITHUB_TOKEN, or run `gh auth login`.\nfor offline development use: node scripts/build-prs.mjs --mock');
    process.exit(1);
  }
  const user = config.user;
  const allow = new Set(config.allow.map((s) => s.toLowerCase()));
  const deny = new Set(config.deny.map((s) => s.toLowerCase()));
  const existing = await readExisting();
  const previous = new Map((existing?.prs ?? []).map((p) => [`${keyOf(p.owner, p.repo)}#${p.number}`, p]));

  const items = await searchPrs(token, user);
  log(`${items.length} prs authored outside ${user}'s repos`);

  const prs = [];
  for (const item of items) {
    const [owner, repo] = item.repository_url.split('/').slice(-2);
    const key = keyOf(owner, repo);
    if (owner.toLowerCase() === user.toLowerCase()) continue;
    if (allow.size && !allow.has(key)) continue;
    if (deny.has(key)) continue;
    const merged = Boolean(item.pull_request?.merged_at);
    // closed without merging is dropped, merged and open are kept
    if (!merged && item.state !== 'open') continue;
    if (config.excludeDrafts && item.draft) continue;
    try {
      const d = await request(token, `${API}/repos/${owner}/${repo}/pulls/${item.number}`);
      if (config.excludeDrafts && d.draft) continue;
      prs.push({
        owner: d.base?.repo?.owner?.login ?? owner,
        repo: d.base?.repo?.name ?? repo,
        number: d.number,
        title: d.title,
        url: d.html_url,
        merged: Boolean(d.merged_at),
        createdAt: d.created_at,
        mergedAt: d.merged_at ?? null,
        additions: d.additions,
        deletions: d.deletions,
        files: d.changed_files,
      });
      log(`${key}#${item.number}: ${d.merged_at ? 'merged' : 'open'}`);
    } catch (err) {
      const old = previous.get(`${key}#${item.number}`);
      log(`${key}#${item.number}: detail failed (${err.message})${old ? ', keeping the last run' : ', skipped'}`);
      if (old) prs.push(old);
    }
  }

  // one avatar per owner. a failed download keeps the avatar already committed, so a transient failure
  // never deletes it; with none, the card shows its monogram
  const logos = new Map();
  for (const owner of [...new Set(prs.map((p) => p.owner))]) {
    try {
      logos.set(owner, await downloadLogo(token, owner));
    } catch (err) {
      const kept = await existingLogo(owner);
      log(`${owner}: avatar failed (${err.message}), ${kept ? 'keeping the committed one' : 'the card will show a monogram'}`);
      logos.set(owner, kept);
    }
  }
  await pruneLogos(new Set([...logos.values()].filter(Boolean).map((p) => path.basename(p))));
  return { user, mock: false, prs: prs.map((p) => ({ ...p, logo: logos.get(p.owner) ?? null })) };
}

function buildMock(config) {
  const day = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const pr = (owner, repo, number, title, createdAt, mergedAt, additions, deletions, files) => ({
    owner,
    repo,
    number,
    title,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    merged: Boolean(mergedAt),
    createdAt: day(createdAt),
    mergedAt: mergedAt ? day(mergedAt) : null,
    additions,
    deletions,
    files,
    logo: null,
  });
  return {
    user: config.user,
    mock: true,
    generated: '2026-10-01T00:00:00Z',
    prs: [
      pr('google', 'flax', 4312, 'Lorem ipsum dolor sit amet for nnx module docstrings', '2026-09-02', '2026-09-10', 84, 12, 3),
      pr('numpy', 'numpy', 27710, 'Consectetur adipiscing elit in the random generator docs', '2026-08-18', null, 41, 7, 2),
      pr('pytorch', 'pytorch', 161204, 'Sed do eiusmod tempor in optimizer math notation', '2026-06-21', '2026-07-02', 23, 19, 1),
      pr('huggingface', 'transformers', 39021, 'Ut labore et dolore magna aliqua for tokenizer errors', '2026-05-30', null, 128, 44, 6),
    ],
  };
}

// by code point, so an emoji or other astral character is never cut in half
function truncate(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 3).join('').trimEnd()}...` : text;
}

function serialize(data) {
  const lines = ['{'];
  for (const k of ['generated', 'user', 'mock']) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(data[k])},`);
  lines.push('  "prs": [');
  data.prs.forEach((p, i) => lines.push(`    ${JSON.stringify(p)}${i < data.prs.length - 1 ? ',' : ''}`));
  lines.push('  ]', '}');
  return lines.join('\n') + '\n';
}

async function main() {
  const config = await loadConfig();
  const raw = args.includes('--mock') ? buildMock(config) : await buildReal(config);
  const prs = raw.prs
    .map((p) => ({ ...p, title: truncate(p.title, TITLE_MAX) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || `${a.owner}/${a.repo}#${a.number}`.localeCompare(`${b.owner}/${b.repo}#${b.number}`));
  const data = { generated: null, user: raw.user, mock: raw.mock, prs };

  let previous = null;
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    // first run
  }
  const comparable = (d) => JSON.stringify({ ...d, generated: null });
  if (previous && comparable(previous) === comparable(data)) {
    log(`no changes, ${path.relative(ROOT, OUT)} left untouched`);
    return;
  }
  data.generated = raw.generated ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, serialize(data));
  log(`wrote ${prs.length} prs (${prs.filter((p) => p.merged).length} merged)${data.mock ? ' [mock]' : ''} to ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(`[prs] ${err.message}`);
  process.exit(1);
});
