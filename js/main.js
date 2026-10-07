// entry point. narrow screens run nothing beyond this file; wide screens lazily load
// the reveals, the starfield with its commit and pull request data and controls, then the
// now playing satellite.

const wide = matchMedia('(min-width: 721px)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const saveData = navigator.connection?.saveData === true;

let pageReady = false;
let session = null;
let generation = 0;

function showStats(data) {
  const el = document.querySelector('.stats');
  const repos = new Set(data.commits.map((c) => c.repo)).size;
  if (!el || !data.commits.length) return;
  const n = data.commits.length;
  el.textContent = `${n} ${n === 1 ? 'commit' : 'commits'} across ${repos} ${repos === 1 ? 'repo' : 'repos'}, refreshed daily`;
  el.hidden = false;
}

async function startScene(s, id) {
  if (saveData) return;
  const [{ loadCommits, loadPrs }, { createStarfield }, { textureMode }] = await Promise.all([
    import('./scene/data.js'),
    import('./scene/index.js'),
    import('./texture.js'),
  ]);
  const [data, prs] = await Promise.all([loadCommits('./data/commits.json'), loadPrs('./data/prs.json')]);
  if (id !== generation) return;
  showStats(data);

  s.scene = createStarfield({ data, prs, reduced, texture: textureMode() });
  if (!s.scene) return;
  const [{ createLegend }, { createMode }] = await Promise.all([import('./legend.js'), import('./mode.js')]);
  if (id !== generation) return;
  // legend first so its escape handler runs before the mode's
  s.legend = createLegend({ data, scene: s.scene, reduced });
  s.mode = createMode({ scene: s.scene, reduced });
}

async function startSatellite(s, id) {
  const { NOW_PLAYING_URL } = await import('./config.js');
  const mock = new URLSearchParams(window.location.search).get('spotify');
  if (!NOW_PLAYING_URL && !mock?.startsWith('mock')) return;
  const { createSatellite } = await import('./satellite.js');
  if (id !== generation) return;
  s.satellite = createSatellite({ endpoint: NOW_PLAYING_URL, mock, reduced });
}

async function enterWide() {
  const id = ++generation;

  if (!pageReady) {
    pageReady = true;
    import('./reveal.js').then((m) => m.initReveal({ reduced })).catch(() => {});
    import('./rows.js').then((m) => m.initRows()).catch(() => {});
  }
  if (session) return;
  const s = (session = {});

  try {
    await startScene(s, id);
  } catch {
    // no data or no scene: the page stands on its own
  }
  if (saveData || id !== generation) return;
  try {
    await startSatellite(s, id);
  } catch {
    // nothing playing to show
  }
}

function leaveWide() {
  generation++;
  const s = session;
  session = null;
  if (!s) return;
  s.satellite?.dispose();
  s.mode?.dispose();
  s.legend?.dispose();
  s.scene?.dispose();
}

function sync() {
  if (wide.matches) enterWide();
  else leaveWide();
}

wide.addEventListener('change', sync);
sync();
