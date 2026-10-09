#!/usr/bin/env node
// builds data/commits.json from the github graphql api. node 20+, zero dependencies.
// usage: node scripts/build-commits.mjs [--mock] [--out path]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'scripts', 'commits.config.json');
const API = 'https://api.github.com/graphql';
const MSG_MAX = 120;

const DEFAULT_CONFIG = {
  user: 'santihdzs',
  allow: [],
  deny: [],
  dropMessages: [
    '^merge (pull request|branch|remote-tracking branch|tag)\\b',
    '^merge .+ into .+',
    '^(initial|first) commit\\b',
    '^init\\.?$',
    '^wip\\.?$',
  ],
  maxLanguages: 7,
};

// preferred palette slot per language. slots 0-7 are hues (0 is the accent green), 8 is the neutral "other".
const SLOT_PREFS = {
  python: 0, shell: 0,
  typescript: 1, c: 1,
  kotlin: 2, css: 2,
  'c++': 3, ruby: 3,
  swift: 4, html: 4, rust: 4,
  'jupyter notebook': 5, java: 5,
  go: 6, dart: 6,
  javascript: 7,
};
const HUE_SLOTS = 8;
const OTHER_SLOT = 8;
// the site's shader holds 8 languages: up to 7 named ones plus "other"
const MAX_NAMED_LANGUAGES = 7;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OUT = path.resolve(option('--out') ?? path.join(ROOT, 'data', 'commits.json'));

const log = (...m) => console.error('[commits]', ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function preferredSlot(name) {
  const key = name.toLowerCase();
  return key in SLOT_PREFS ? SLOT_PREFS[key] : fnv1a(key) % HUE_SLOTS;
}

// top n languages by commit count keep their own entry, the rest fold into "other".
// known languages claim their preferred slot first, then collisions and unknown
// languages probe forward, so two visible languages never share a color.
function assignLanguages(repos, commits, maxLanguages) {
  const counts = new Map();
  for (const c of commits) {
    const lang = repos[c.repo].language ?? 'other';
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .filter(([name]) => name !== 'other')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = ranked.slice(0, maxLanguages).map(([name]) => name);
  const needsOther = counts.has('other') || ranked.length > maxLanguages;

  const used = new Set();
  const slots = new Map();
  for (const name of kept) {
    const slot = SLOT_PREFS[name.toLowerCase()];
    if (slot !== undefined && !used.has(slot)) {
      slots.set(name, slot);
      used.add(slot);
    }
  }
  for (const name of kept) {
    if (slots.has(name)) continue;
    let slot = preferredSlot(name);
    while (used.has(slot)) slot = (slot + 1) % HUE_SLOTS;
    slots.set(name, slot);
    used.add(slot);
  }
  const languages = kept.map((name) => ({ name: name.toLowerCase(), slot: slots.get(name) }));
  if (needsOther) languages.push({ name: 'other', slot: OTHER_SLOT });

  const indexOf = (lang) => {
    const i = kept.indexOf(lang);
    return i >= 0 ? i : languages.length - 1;
  };
  return { languages, langIndex: (repo) => indexOf(repo.language ?? 'other') };
}

async function loadConfig() {
  let config;
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    config = { ...DEFAULT_CONFIG, ...raw };
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`could not read ${CONFIG_PATH}: ${err.message}`);
    config = DEFAULT_CONFIG;
  }
  if (!(Number(config.maxLanguages) <= MAX_NAMED_LANGUAGES)) {
    throw new Error(`maxLanguages is at most ${MAX_NAMED_LANGUAGES} (the site shows 8 languages, "other" included), got ${JSON.stringify(config.maxLanguages)}`);
  }
  return config;
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

class GraphQLError extends Error {}

async function gql(token, query, variables, attempt = 0) {
  const MAX_ATTEMPTS = 6;
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: {
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'santihdzs-portfolio-commits',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err;
    const wait = 2 ** attempt * 1000;
    log(`network error (${err.message}), retrying in ${wait / 1000}s`);
    await sleep(wait);
    return gql(token, query, variables, attempt + 1);
  }

  if (res.status === 401) throw new GraphQLError('github rejected the token (401). check GH_TOKEN or gh auth status.');

  const body = await res.json().catch(() => null);
  const errors = body?.errors ?? [];
  const rateLimited =
    res.status === 429 ||
    (res.status === 403 && /rate limit/i.test(JSON.stringify(body))) ||
    errors.some((e) => e.type === 'RATE_LIMITED');

  if (rateLimited || res.status >= 500) {
    if (attempt >= MAX_ATTEMPTS) throw new GraphQLError(`gave up after ${attempt} retries (status ${res.status})`);
    let wait;
    const retryAfter = Number(res.headers.get('retry-after'));
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (retryAfter > 0) wait = retryAfter * 1000;
    else if (remaining === '0' && reset) wait = Math.max(reset * 1000 - Date.now(), 0) + 1000;
    else if (rateLimited) wait = 60_000 * 2 ** Math.min(attempt, 3); // secondary limit: docs say wait at least a minute
    else wait = 2 ** attempt * 1000;
    log(`${rateLimited ? 'rate limited' : `server error ${res.status}`}, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return gql(token, query, variables, attempt + 1);
  }

  if (!res.ok || errors.length) {
    const msg = errors.map((e) => e.message).join('; ') || `http ${res.status}`;
    throw new GraphQLError(msg);
  }
  return body.data;
}

const Q_USER = `query($login: String!) { user(login: $login) { id login } }`;

const Q_REPOS = `query($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, orderBy: {field: NAME, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { name isEmpty primaryLanguage { name } defaultBranchRef { name } }
    }
  }
}`;

const Q_HISTORY = `query($owner: String!, $name: String!, $author: ID!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: $first, after: $after, author: {id: $author}) {
            pageInfo { hasNextPage endCursor }
            nodes { oid committedDate messageHeadline additions deletions changedFilesIfAvailable }
          }
        }
      }
    }
  }
}`;

async function fetchRepos(token, login) {
  const repos = [];
  let after = null;
  do {
    const data = await gql(token, Q_REPOS, { login, after });
    const page = data.user.repositories;
    repos.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return repos;
}

async function fetchHistory(token, owner, name, authorId) {
  const nodes = [];
  let after = null;
  let first = 100;
  for (;;) {
    let data;
    try {
      data = await gql(token, Q_HISTORY, { owner, name, author: authorId, first, after });
    } catch (err) {
      // large diffs can time out the stats resolver, smaller pages usually get through
      if (first > 25 && err instanceof GraphQLError && /gave up|timeout|server/i.test(err.message)) {
        first = Math.floor(first / 2);
        log(`${name}: retrying with page size ${first}`);
        continue;
      }
      throw err;
    }
    const history = data.repository?.defaultBranchRef?.target?.history;
    if (!history) break;
    nodes.push(...history.nodes);
    if (!history.pageInfo.hasNextPage) break;
    after = history.pageInfo.endCursor;
  }
  return nodes;
}

function buildMatcher(config) {
  const patterns = config.dropMessages.map((p) => new RegExp(p, 'i'));
  const allow = new Set(config.allow.map((s) => s.toLowerCase()));
  const deny = new Set(config.deny.map((s) => s.toLowerCase()));
  return {
    keepRepo: (name) => {
      const key = name.toLowerCase();
      if (allow.size && !allow.has(key)) return false;
      return !deny.has(key);
    },
    keepMessage: (msg) => !patterns.some((re) => re.test(msg)),
  };
}

async function readExisting() {
  try {
    const data = JSON.parse(await readFile(OUT, 'utf8'));
    return data.mock ? null : data;
  } catch {
    return null;
  }
}

// previous commits for one repo, used when that repo fails this run
function previousCommits(existing, repoName) {
  if (!existing) return [];
  const idx = existing.repos.findIndex((r) => r.name === repoName);
  if (idx < 0) return [];
  return existing.commits
    .filter((c) => c[0] === idx)
    .map(([, sha, ts, additions, deletions, files, message]) => ({ sha, ts, additions, deletions, files, message }));
}

async function buildReal(config) {
  const token = resolveToken();
  if (!token) {
    console.error(
      'no github token found. set GH_TOKEN or GITHUB_TOKEN, or run `gh auth login`.\n' +
        'for offline development use: node scripts/build-commits.mjs --mock'
    );
    process.exit(1);
  }

  const login = config.user;
  const { user } = await gql(token, Q_USER, { login });
  if (!user) throw new Error(`github user ${login} not found`);
  log(`user ${user.login} (${user.id})`);

  const matcher = buildMatcher(config);
  const allRepos = await fetchRepos(token, login);
  const candidates = allRepos.filter((r) => matcher.keepRepo(r.name));
  log(`${allRepos.length} public non-fork repos, ${candidates.length} after allow/deny`);

  const existing = await readExisting();
  const perRepo = [];
  const failed = [];
  for (const repo of candidates) {
    if (repo.isEmpty || !repo.defaultBranchRef) {
      log(`${repo.name}: skipped (empty or no default branch)`);
      continue;
    }
    try {
      const nodes = await fetchHistory(token, login, repo.name, user.id);
      const commits = nodes.map((n) => ({
        sha: n.oid,
        ts: Math.floor(Date.parse(n.committedDate) / 1000),
        additions: n.additions,
        deletions: n.deletions,
        files: n.changedFilesIfAvailable ?? null,
        message: n.messageHeadline,
      }));
      perRepo.push({ name: repo.name, language: repo.primaryLanguage?.name ?? null, commits });
      log(`${repo.name}: ${commits.length} commits`);
    } catch (err) {
      failed.push(repo.name);
      const kept = previousCommits(existing, repo.name);
      log(`${repo.name}: failed (${err.message})${kept.length ? `, keeping ${kept.length} commits from the last run` : ''}`);
      if (kept.length) perRepo.push({ name: repo.name, language: repo.primaryLanguage?.name ?? null, commits: kept });
    }
  }

  if (failed.length && failed.length === candidates.filter((r) => !r.isEmpty && r.defaultBranchRef).length) {
    throw new Error('every repository failed, refusing to overwrite the data file');
  }
  return { user: login, mock: false, perRepo, matcher };
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildMock(config) {
  const rand = mulberry32(20261006);
  const hex = () => Array.from({ length: 40 }, () => Math.floor(rand() * 16).toString(16)).join('');
  const langs = ['Python', 'TypeScript', 'Swift', 'Jupyter Notebook', 'C++', 'Kotlin'];
  const names = ['lorem-api', 'ipsum-ui', 'dolor-ml', 'sit-ios', 'amet-engine', 'consectetur', 'adipiscing', 'elit-notes'];
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore'.split(' ');
  const end = Date.UTC(2026, 8, 30) / 1000;
  const span = 3 * 365 * 86400;
  const perRepo = names.map((name, i) => ({ name, language: i < langs.length ? langs[i] : i === 6 ? langs[0] : null, commits: [] }));
  for (let i = 0; i < 800; i++) {
    const repo = perRepo[Math.floor(rand() ** 1.3 * perRepo.length)];
    const len = 3 + Math.floor(rand() * 6);
    const message = Array.from({ length: len }, () => words[Math.floor(rand() * words.length)]).join(' ');
    repo.commits.push({
      sha: hex(),
      ts: Math.floor(end - rand() ** 0.8 * span),
      additions: Math.floor(Math.exp(rand() * 7)),
      deletions: Math.floor(Math.exp(rand() * 5.5)),
      files: 1 + Math.floor(rand() * 12),
      message,
    });
  }
  return { user: config.user, mock: true, generated: new Date(end * 1000).toISOString(), perRepo, matcher: buildMatcher(config) };
}

function assemble({ user, mock, perRepo, matcher }, config) {
  const seen = new Set();
  const repos = [];
  const commits = [];
  for (const repo of perRepo) {
    const kept = repo.commits.filter((c) => {
      if (seen.has(c.sha)) return false;
      if (c.additions === 0 && c.deletions === 0) return false;
      if (!matcher.keepMessage(c.message)) return false;
      seen.add(c.sha);
      return true;
    });
    if (!kept.length) continue;
    const index = repos.length;
    repos.push({ name: repo.name, language: repo.language });
    for (const c of kept) commits.push({ ...c, repo: index });
  }

  const { languages, langIndex } = assignLanguages(repos, commits, config.maxLanguages);
  commits.sort((a, b) => b.ts - a.ts || (a.sha < b.sha ? -1 : 1));

  return {
    generated: null,
    user,
    mock,
    languages,
    repos: repos.map((r) => ({ name: r.name, lang: langIndex(r), primary: r.language ? r.language.toLowerCase() : null })),
    commits: commits.map((c) => [
      c.repo,
      c.sha,
      c.ts,
      c.additions,
      c.deletions,
      c.files,
      truncate(c.message, MSG_MAX),
    ]),
  };
}

// by code point, so an emoji or other astral character is never cut in half
function truncate(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 3).join('').trimEnd()}...` : text;
}

// one commit per line keeps daily diffs small and readable
function serialize(data) {
  const head = { ...data };
  delete head.languages;
  delete head.repos;
  delete head.commits;
  const lines = ['{'];
  for (const [k, v] of Object.entries(head)) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const list = (key, items, last = false) => {
    lines.push(`  ${JSON.stringify(key)}: [`);
    items.forEach((item, i) => lines.push(`    ${JSON.stringify(item)}${i < items.length - 1 ? ',' : ''}`));
    lines.push(`  ]${last ? '' : ','}`);
  };
  list('languages', data.languages);
  list('repos', data.repos);
  list('commits', data.commits, true);
  lines.push('}');
  return lines.join('\n') + '\n';
}

async function main() {
  const config = await loadConfig();
  const raw = flag('--mock') ? buildMock(config) : await buildReal(config);
  const data = assemble(raw, config);

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
  const text = serialize(data);
  await writeFile(OUT, text);
  const repoCount = new Set(data.commits.map((c) => c[0])).size;
  log(`wrote ${data.commits.length} commits across ${repoCount} repos (${(text.length / 1024).toFixed(1)} KB)${data.mock ? ' [mock]' : ''} to ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(`[commits] ${err.message}`);
  process.exit(1);
});
