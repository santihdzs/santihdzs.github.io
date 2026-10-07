// dev only: exercises worker/src/index.js against a fake spotify, a fake cache and a fake kv.
// usage: node tools/worker-test.mjs
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  process.stdout.write(`${ok ? 'pass' : 'FAIL'}  ${name}${detail && !ok ? `  [${detail}]` : ''}\n`);
};

const SECRET_REFRESH = 'refresh-secret-AAA';
const ROTATED = 'refresh-rotated-BBB';
const ACCESS = 'access-token-CCC';
let scenario = {};
let calls = [];
const logs = [];
console.log = (...a) => logs.push(a.join(' '));

const track = (name) => ({
  type: 'track', name, duration_ms: 200000, external_urls: { spotify: `https://open.spotify.com/track/${name}` },
  artists: [{ name: 'A1', id: 'artist-id-1' }, { name: 'A2' }], album: { name: 'Alb', images: [{ url: 'https://i/640', width: 640 }, { url: 'https://i/300', width: 300 }, { url: 'https://i/64', width: 64 }] },
  id: 'track-id-secret',
});
const episode = { type: 'episode', name: 'Ep', duration_ms: 1000, external_urls: { spotify: 'https://open.spotify.com/episode/x' }, images: [{ url: 'https://i/ep64', width: 64 }], show: { name: 'The Show' } };

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  calls.push(url);
  if (scenario.network) throw new TypeError('fetch failed');
  if (url.includes('/api/token')) {
    const body = new URLSearchParams(opts.body);
    scenario.refreshUsed = body.get('refresh_token');
    if (body.get('client_secret')) throw new Error('client secret must not be sent');
    if (scenario.tokenFail) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    return new Response(JSON.stringify({ access_token: ACCESS, expires_in: 3600, ...(scenario.rotate ? { refresh_token: ROTATED } : {}) }), { status: 200 });
  }
  const auth = opts.headers?.authorization;
  if (scenario.expireOnce && !scenario.expired) {
    scenario.expired = true;
    return new Response('', { status: 401 });
  }
  if (auth !== `Bearer ${ACCESS}`) return new Response('', { status: 401 });
  if (url.includes('/currently-playing')) {
    if (scenario.limit) return new Response('', { status: 429, headers: { 'retry-after': '7' } });
    if (scenario.current === 204) return new Response(null, { status: 204 });
    if (scenario.current === 'empty200') return new Response('', { status: 200 });
    return new Response(JSON.stringify(scenario.current), { status: 200 });
  }
  if (url.includes('/recently-played')) {
    if (scenario.recent === 'none') return new Response(JSON.stringify({ items: [] }), { status: 200 });
    if (scenario.recent === 500) return new Response('boom', { status: 500 });
    return new Response(JSON.stringify({ items: [{ track: track('Recent'), played_at: '2026-10-06T10:00:00Z' }] }), { status: 200 });
  }
  return new Response('', { status: 404 });
};

const store = new Map();
globalThis.caches = { default: { match: async (req) => store.get(req.url)?.clone() ?? null, put: async (req, res) => void store.set(req.url, res) } };
const kv = new Map();
const env = { SPOTIFY_CLIENT_ID: 'client-id-DDD', SPOTIFY_REFRESH_TOKEN: SECRET_REFRESH, ALLOWED_ORIGINS: 'https://preview.example.com', NOW_PLAYING: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) } };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };

async function fresh() {
  // a new module instance per scenario so isolate memory starts empty
  const mod = await import(`../worker/src/index.js?${Math.random()}`);
  store.clear();
  return mod.default;
}

async function get(worker, origin = 'https://santihdzs.com', path = '/now-playing', method = 'GET') {
  const res = await worker.fetch(new Request(`https://np.example.workers.dev${path}`, { method, headers: origin ? { origin } : {} }), env, ctx);
  await Promise.all(waits.splice(0));
  const text = await res.text();
  return { res, text, body: text ? JSON.parse(text) : null };
}

const leaks = (text) => [SECRET_REFRESH, ROTATED, ACCESS, 'client-id-DDD', 'track-id-secret', 'artist-id-1'].filter((s) => text.includes(s));

let w = await fresh();
scenario = { current: { is_playing: true, progress_ms: 1234, item: track('Now') } };
let r = await get(w);
check('playing: state, fields and smallest 64px class image', r.body.state === 'playing' && r.body.track.name === 'Now' && r.body.track.artists.join() === 'A1,A2' && r.body.track.image === 'https://i/64' && r.body.track.progressMs === 1234 && r.body.track.url.startsWith('https://open.spotify.com/'), r.text);
check('no secrets, ids or raw payload in the response', !leaks(r.text).length && !('id' in r.body.track) && !r.text.includes('external_urls'), leaks(r.text).join());
check('cors returns the matching production origin, never a wildcard', r.res.headers.get('access-control-allow-origin') === 'https://santihdzs.com' && r.res.headers.get('vary') === 'Origin');
const before = calls.length;
r = await get(w);
check('second request within 20s is served from cache, no upstream call', calls.length === before && r.body.state === 'playing');

w = await fresh();
scenario = { current: 204 };
r = await get(w);
check('204 from currently-playing falls back to recently played', r.body.state === 'recent' && r.body.track.playedAt === '2026-10-06T10:00:00Z' && !('progressMs' in r.body.track), r.text);

w = await fresh();
scenario = { current: 'empty200' };
r = await get(w);
check('empty 200 body is treated like nothing playing', r.body.state === 'recent');

w = await fresh();
scenario = { current: { is_playing: false, item: track('Paused') } };
r = await get(w);
check('paused track is not reported as playing', r.body.state === 'recent');

w = await fresh();
scenario = { current: { is_playing: true, currently_playing_type: 'ad', item: null } };
r = await get(w);
check('an ad (null item) falls back to recent', r.body.state === 'recent');

w = await fresh();
scenario = { current: { is_playing: true, progress_ms: 5, item: episode } };
r = await get(w);
check('episodes use the show name as the artist', r.body.state === 'playing' && r.body.track.artists[0] === 'The Show' && r.body.track.album === 'The Show', r.text);

w = await fresh();
scenario = { current: 204, recent: 'none' };
r = await get(w);
check('nothing playing and no history is idle', r.body.state === 'idle' && !r.body.track);

w = await fresh();
calls = [];
scenario = { current: { is_playing: true, item: track('Now') }, expireOnce: true };
r = await get(w);
const tokenCalls = calls.filter((u) => u.includes('/api/token')).length;
check('401 refreshes once and retries', r.body.state === 'playing' && tokenCalls === 2, `${tokenCalls} token calls`);

w = await fresh();
kv.clear();
scenario = { current: { is_playing: true, item: track('Now') }, rotate: true };
r = await get(w);
check('a rotated refresh token is persisted to kv', kv.get('spotify_refresh_token') === ROTATED);
w = await fresh();
scenario = { current: { is_playing: true, item: track('Now') } };
r = await get(w);
check('the next refresh uses the rotated token from kv', scenario.refreshUsed === ROTATED);
kv.clear();

// a stale rotated token in kv must not block a freshly set secret
w = await fresh();
kv.set('spotify_refresh_token', 'stale-kv-token');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes('/api/token') && new URLSearchParams(opts.body).get('refresh_token') === 'stale-kv-token') {
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  }
  return realFetch(url, opts);
};
scenario = { current: { is_playing: true, item: track('Now') } };
r = await get(w);
globalThis.fetch = realFetch;
check('a stale kv token falls back to the secret and kv is reseeded', r.body.state === 'playing' && kv.get('spotify_refresh_token') === SECRET_REFRESH, r.text);
kv.clear();

w = await fresh();
scenario = { current: { is_playing: true, item: track('Good') } };
await get(w);
scenario = { current: { is_playing: true, item: track('Later') }, limit: true };
// expire the memory and cache layers but keep the last good value
store.clear();
const realNow = Date.now;
Date.now = () => realNow() + 25000;
r = await get(w);
check('429 serves the last good value', r.body.track?.name === 'Good', r.text);
calls = [];
store.clear();
Date.now = () => realNow() + 28000;
r = await get(w);
check('retry-after is honored: no upstream call while blocked', !calls.some((u) => u.includes('api.spotify.com')) && r.body.track?.name === 'Good');
Date.now = realNow;

w = await fresh();
scenario = { network: true };
r = await get(w);
check('network error with no history is idle, never an error', r.res.status === 200 && r.body.state === 'idle');

w = await fresh();
scenario = { tokenFail: true };
r = await get(w);
check('expired refresh token degrades to idle', r.res.status === 200 && r.body.state === 'idle');

w = await fresh();
scenario = { current: 204, recent: 500 };
r = await get(w);
check('recently played 500 with no history is idle', r.body.state === 'idle');

w = await fresh();
scenario = { current: { is_playing: true, item: track('Now') } };
for (const [origin, want] of [['http://localhost:8080', true], ['http://127.0.0.1:5173', true], ['https://preview.example.com', true], ['https://evil.example.com', false], ['https://santihdzs.com.evil.com', false], [null, false]]) {
  r = await get(w, origin);
  const got = r.res.headers.get('access-control-allow-origin');
  check(`cors ${origin ?? 'no origin'} ${want ? 'allowed' : 'refused'}`, want ? got === origin : got === null, String(got));
}
r = await get(w, 'https://santihdzs.com', '/now-playing', 'OPTIONS');
check('preflight answers 204 with methods', r.res.status === 204 && r.res.headers.get('access-control-allow-methods')?.includes('GET'));
r = await get(w, 'https://santihdzs.com', '/elsewhere');
check('unknown path is 404 json', r.res.status === 404);

check('logs never contain tokens or ids', !logs.some((l) => leaks(l).length), logs.join(' | '));
const failed = results.filter((x) => !x).length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
