// the narrow view: the shared calm sky behind the links, and the spotify card. the card asks the worker
// (and spotify's image host, for the artwork) for anything only once the page has loaded.
import { createSky } from './sky.js';
import { MOCKS, parse, fetchNowPlaying } from './nowplaying.js';
import { NOW_PLAYING_URL } from './config.js';

const POLL_MS = 30000;
// a request that hangs this long is dropped, so the next poll is never blocked behind it
const TIMEOUT_MS = 10000;
const LOGO = './assets/spotify-logo-white.svg';

export function startNarrow({ saveData }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sky';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const sky = createSky(canvas, { quiet: () => [...document.querySelectorAll('.hero-name, .hero-kicker')] });
  if (!sky) canvas.remove();
  const mock = new URLSearchParams(window.location.search).get('spotify');
  const card = saveData ? null : spotifyCard({ endpoint: NOW_PLAYING_URL, mock });
  return () => {
    sky?.dispose();
    canvas.remove();
    card?.dispose();
  };
}

// the card links to the spotify profile. playing or recent, it shows the track with spotify's full logo,
// which links to the track itself, so the metadata always leads back to spotify. anything else, or
// before the first answer, it is a plain "spotify" card of the same height
function spotifyCard({ endpoint, mock }) {
  const root = document.querySelector('.np-card');
  const mockBody = MOCKS[mock];
  if (!root || (!endpoint && !mockBody)) return null;
  const q = (s) => root.querySelector(s);
  const main = q('.np-main');
  const play = q('.np-play');
  const logo = q('.np-play img');
  const plain = q('.np-plain');
  const now = q('.np-now');
  const art = q('.np-art');
  const eyebrow = q('.np-state');
  const title = q('.np-title');
  const artists = q('.np-artists');
  let timer = 0;
  let controller = null;
  let disposed = false;
  // the artwork comes from spotify's image host; it never needs to know which page asked
  art.referrerPolicy = 'no-referrer';

  function render(next) {
    const on = !!next && next.state !== 'idle';
    root.classList.toggle('is-playing', on && next.state === 'playing');
    root.classList.toggle('is-recent', on && next.state === 'recent');
    plain.hidden = on;
    now.hidden = !on;
    play.hidden = !on;
    if (!on) {
      main.removeAttribute('aria-label');
      return;
    }
    const t = next.track;
    const who = t.artists.join(', ');
    const label = next.state === 'playing' ? 'now playing' : 'last played';
    if (art.getAttribute('src') !== t.image) art.src = t.image;
    if (!logo.getAttribute('src')) logo.src = LOGO;
    eyebrow.textContent = label;
    title.textContent = t.name;
    artists.textContent = who;
    // the visible text first, in order, so the name matches what is on screen
    main.setAttribute('aria-label', `${label} ${t.name} ${who}, spotify profile`);
    play.href = t.url;
    play.setAttribute('aria-label', `play on spotify: ${t.name} by ${who}`);
  }

  const visible = () => !disposed && !document.hidden;

  async function poll() {
    clearTimeout(timer);
    if (!visible() || controller) return;
    if (mockBody) {
      render(parse(mockBody, true));
      return;
    }
    const c = (controller = new AbortController());
    const slow = setTimeout(() => c.abort(), TIMEOUT_MS);
    try {
      render(await fetchNowPlaying(endpoint, c.signal));
    } catch (err) {
      if (err?.name !== 'AbortError') render(null);
    } finally {
      clearTimeout(slow);
      controller = null;
      if (visible()) timer = setTimeout(poll, POLL_MS);
    }
  }

  function onVisibility() {
    if (document.hidden) {
      clearTimeout(timer);
      controller?.abort();
    } else poll();
  }

  const begin = () => {
    document.addEventListener('visibilitychange', onVisibility);
    poll();
  };
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });

  return {
    dispose() {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener('load', begin);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
