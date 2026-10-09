// now playing data, shared by the desktop satellite and the narrow view's spotify card: the sample
// payloads, the one parser and the fetch. any failure counts as nothing to show.

// stand in artwork for the mock, generated so the mock makes no network request
const MOCK_ART = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3a67"/><stop offset=".55" stop-color="#3f7f86"/><stop offset="1" stop-color="#d9a066"/></linearGradient></defs><rect width="64" height="64" fill="url(#a)"/><circle cx="44" cy="22" r="9" fill="#f3e3c3" opacity=".85"/></svg>'
)}`;

export const MOCKS = {
  mock: {
    state: 'playing',
    track: { name: 'Lorem Ipsum Dolor', artists: ['Sit Amet', 'Consectetur'], album: 'Adipiscing Elit', image: MOCK_ART, url: 'https://open.spotify.com/', durationMs: 214000, progressMs: 61000 },
  },
  'mock-recent': {
    state: 'recent',
    track: { name: 'Sed Do Eiusmod Tempor', artists: ['Incididunt'], album: 'Ut Labore', image: MOCK_ART, url: 'https://open.spotify.com/', durationMs: 187000, playedAt: '2026-10-06T18:42:00Z' },
  },
};

// only well formed payloads render; anything else counts as a failure
export function parse(body, mock) {
  if (!body || !['playing', 'recent', 'idle'].includes(body.state)) return null;
  if (body.state === 'idle') return { state: 'idle' };
  const t = body.track;
  const okImage = typeof t?.image === 'string' && (t.image.startsWith('https://') || (mock && t.image.startsWith('data:image/svg+xml')));
  const okUrl = typeof t?.url === 'string' && t.url.startsWith('https://open.spotify.com/');
  const artists = Array.isArray(t?.artists) ? t.artists.filter((a) => typeof a === 'string' && a) : [];
  if (typeof t?.name !== 'string' || !t.name || !artists.length || !okImage || !okUrl) return null;
  return { state: body.state, track: { name: t.name, artists, image: t.image, url: t.url } };
}

// one request to the worker; resolves to a parsed payload or null, rejects only when aborted or offline
export async function fetchNowPlaying(endpoint, signal) {
  const res = await fetch(endpoint, { signal, credentials: 'omit', cache: 'no-store' });
  return res.ok ? parse(await res.json(), false) : null;
}
