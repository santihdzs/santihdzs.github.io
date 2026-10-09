// now playing endpoint for santihdzs.com. cloudflare worker, no dependencies.
// GET /now-playing -> { state: 'playing' | 'recent' | 'idle', track? }
// it never throws to the client and never puts tokens, ids or upstream payloads in a response or log.

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const PLAYER = 'https://api.spotify.com/v1/me/player';
const CACHE_SECONDS = 20;
const KV_KEY = 'spotify_refresh_token';
const PRODUCTION_ORIGIN = 'https://santihdzs.com';
const IDLE = { state: 'idle' };
// when spotify fails, the last good answer only covers a short blip: past STALE_MS a track it called
// playing reads as last played, and past IDLE_MS it shows nothing
const STALE_MS = 2 * 60_000;
const IDLE_MS = 60 * 60_000;
// a refused token refresh is not retried for this long
const REFRESH_BACKOFF_MS = 5 * 60_000;

// per isolate state. isolates are reused across requests but not guaranteed, so the cache api
// and kv back this up.
let access = { token: null, expires: 0 };
let refreshing = null;
let lastGood = null;
let lastGoodAt = 0;
let blockedUntil = 0;
let refreshBlockedUntil = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('origin'), env);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-max-age': '86400' },
      });
    }
    if (url.pathname !== '/now-playing') return json({ error: 'not found' }, 404, cors);
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);

    let body;
    try {
      body = await nowPlaying(env, ctx, `${url.origin}/now-playing`);
    } catch (err) {
      console.log(`now playing failed: ${err?.name ?? 'error'}`);
      body = fallback();
    }
    return json(body, 200, cors, { 'cache-control': `public, max-age=${CACHE_SECONDS}` });
  },
};

function corsHeaders(origin, env) {
  const headers = { vary: 'Origin' };
  if (origin && isAllowed(origin, env)) headers['access-control-allow-origin'] = origin;
  return headers;
}

// production, localhost and 127.0.0.1 on any port, plus ALLOWED_ORIGINS (comma separated). never a wildcard.
function isAllowed(origin, env) {
  if (origin === PRODUCTION_ORIGIN) return true;
  try {
    const u = new URL(origin);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  } catch {
    return false;
  }
  return String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}

function json(body, status, cors, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors, ...extra },
  });
}

async function nowPlaying(env, ctx, cacheUrl) {
  const now = Date.now();
  if (lastGood && now - lastGoodAt < CACHE_SECONDS * 1000) return lastGood;

  // the cache api only takes effect on a custom domain; on workers.dev the memory cache above carries it
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(cacheUrl);
  const hit = cache ? await cache.match(key).catch(() => null) : null;
  if (hit) {
    const cached = await hit.json().catch(() => null);
    if (cached?.state) return remember(cached);
  }

  if (now < blockedUntil) return fallback();
  const fresh = await fromSpotify(env).catch((err) => {
    console.log(`spotify unreachable: ${err?.name ?? 'error'}`);
    return null;
  });
  if (!fresh) return fallback();

  remember(fresh);
  if (cache) {
    const stored = new Response(JSON.stringify(fresh), {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_SECONDS}` },
    });
    ctx.waitUntil(cache.put(key, stored).catch(() => {}));
  }
  return fresh;
}

function remember(body) {
  lastGood = body;
  lastGoodAt = Date.now();
  return body;
}

// what to answer when spotify cannot be asked: the last good answer, aged
function fallback() {
  const age = Date.now() - lastGoodAt;
  if (!lastGood || age > IDLE_MS) return IDLE;
  if (age > STALE_MS && lastGood.state === 'playing') {
    const { progressMs, ...track } = lastGood.track;
    return { state: 'recent', track: { ...track, playedAt: null } };
  }
  return lastGood;
}

// currently playing first, then a paused track, then the last finished track, then idle.
// null means "keep what we had".
async function fromSpotify(env) {
  const current = await spotify(env, '/currently-playing?additional_types=episode');
  if (current.status === 429 || current.status === 'auth') return null;
  const now = current.status === 200 && current.data?.item ? shape(current.data.item) : null;
  if (now && current.data.is_playing) return { state: 'playing', track: { ...now, progressMs: current.data.progress_ms ?? 0 } };
  // paused or stopped on a track while the player session is alive. spotify gives no played_at here
  if (now) return { state: 'recent', track: { ...now, playedAt: null } };

  // recently played only lists finished tracks
  const recent = await spotify(env, '/recently-played?limit=1');
  if (recent.status === 429 || recent.status === 'auth') return null;
  const item = recent.data?.items?.[0];
  if (recent.status === 200 && item?.track) {
    const track = shape(item.track);
    if (track) return { state: 'recent', track: { ...track, playedAt: item.played_at } };
  }
  if (recent.status === 200 || recent.status === 204) return IDLE;
  return null;
}

// one player endpoint call with a single refresh and retry on 401
async function spotify(env, path, retried = false) {
  const token = await accessToken(env, retried);
  if (!token) return { status: 'auth' };
  const res = await fetch(`${PLAYER}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401 && !retried) {
    access = { token: null, expires: 0 };
    return spotify(env, path, true);
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after'));
    blockedUntil = Date.now() + (Number.isFinite(wait) && wait > 0 ? wait : 30) * 1000;
    console.log('spotify rate limited');
    return { status: 429 };
  }
  if (res.status === 204) return { status: 204 };
  if (!res.ok) {
    console.log(`spotify responded ${res.status}`);
    return { status: res.status };
  }
  // an empty 200 body means nothing is playing
  const text = await res.text();
  if (!text) return { status: 204 };
  try {
    return { status: 200, data: JSON.parse(text) };
  } catch {
    return { status: 502 };
  }
}

async function accessToken(env, force) {
  if (!force && access.token && Date.now() < access.expires - 60_000) return access.token;
  if (Date.now() < refreshBlockedUntil) return null;
  // one refresh at a time per isolate, so a rotated refresh token is never used twice
  refreshing ??= refresh(env).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refresh(env) {
  if (!env.SPOTIFY_CLIENT_ID) {
    console.log('missing spotify credentials');
    return null;
  }
  // the kv copy is the latest rotated token. after a re-authorization the secret is newer,
  // so a stale kv token falls back to the secret instead of failing forever.
  const stored = env.NOW_PLAYING ? await env.NOW_PLAYING.get(KV_KEY).catch(() => null) : null;
  const candidates = [...new Set([stored, env.SPOTIFY_REFRESH_TOKEN].filter(Boolean))];
  if (!candidates.length) {
    console.log('missing spotify credentials');
    return null;
  }
  for (const refreshToken of candidates) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.SPOTIFY_CLIENT_ID }),
    });
    if (!res.ok) {
      // invalid_grant means expired (refresh tokens last 6 months) or revoked
      console.log(`token refresh failed: ${res.status}`);
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!data?.access_token) continue;
    access = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    // spotify may return a new refresh token; when it does it replaces the old one
    const latest = data.refresh_token || refreshToken;
    if (env.NOW_PLAYING && latest !== stored) {
      await env.NOW_PLAYING.put(KV_KEY, latest).catch(() => console.log('could not store the refresh token'));
    }
    return access.token;
  }
  access = { token: null, expires: 0 };
  refreshBlockedUntil = Date.now() + REFRESH_BACKOFF_MS;
  return null;
}

// only the fields the site shows. episodes use the show name as the artist.
function shape(item) {
  if (!item?.name) return null;
  const episode = item.type === 'episode';
  const artists = episode ? [item.show?.name].filter(Boolean) : (item.artists ?? []).map((a) => a?.name).filter(Boolean);
  const images = (episode ? item.images ?? item.show?.images : item.album?.images) ?? [];
  const url = item.external_urls?.spotify;
  if (!artists.length || !url) return null;
  return {
    name: item.name,
    artists,
    album: episode ? item.show?.name ?? '' : item.album?.name ?? '',
    image: pickImage(images),
    url,
    durationMs: item.duration_ms ?? 0,
  };
}

// images come widest first; take the smallest one that is still at least 64px
function pickImage(images) {
  const valid = images.filter((i) => i?.url);
  if (!valid.length) return null;
  const big = valid.filter((i) => (i.width ?? 0) >= 64);
  return (big.length ? big[big.length - 1] : valid[valid.length - 1]).url;
}
