// entry point. wide screens lazily load the reveals, the starfield with its commit and pull request
// data and controls, then the now playing satellite. narrow screens load only the small narrow view:
// a 2d sky and the spotify card, never three.js, gsap or any commit data.

// the one breakpoint: phones, and phones in landscape (short touch screens). every narrow @media block in
// css repeats this exact query text, so js and css always agree, fractional widths included
const narrowView = matchMedia('(max-width: 720px), (max-height: 500px) and (pointer: coarse) and (orientation: landscape)');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const saveData = navigator.connection?.saveData === true;

let pageReady = false;
let session = null;
let generation = 0;
let narrow = null;

// the copyright is static in the page; the dot and the stat join it once the data loads
function showStats(data) {
  const el = document.querySelector('.stats');
  const repos = new Set(data.commits.map((c) => c.repo)).size;
  if (!el || !data.commits.length) return;
  const n = data.commits.length;
  let stat = el.querySelector('.stats-data');
  if (!stat) {
    stat = document.createElement('span');
    stat.className = 'stats-data';
    el.append(stat);
    // the dot only shows while both parts share a line, so a wrapped stat never starts with it
    const copy = el.firstElementChild;
    new ResizeObserver(() => el.classList.toggle('is-wrapped', stat.offsetTop > copy.offsetTop)).observe(el);
  }
  const dot = document.createElement('span');
  dot.className = 'stats-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.textContent = '·';
  stat.replaceChildren(dot, `${n} ${n === 1 ? 'commit' : 'commits'} across ${repos} ${repos === 1 ? 'repo' : 'repos'}`);
}

async function startScene(s, id) {
  if (saveData) return;
  // the data downloads while three.js and the scene modules load
  const loadData = import('./scene/data.js').then(({ loadCommits, loadPrs }) =>
    Promise.all([loadCommits('./data/commits.json'), loadPrs('./data/prs.json')])
  );
  const [[data, prs], { createStarfield }, { textureMode }] = await Promise.all([
    loadData,
    import('./scene/index.js'),
    import('./texture.js'),
  ]);
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
  // number keys jump between the sections; the scene and the mode, once loaded, say when the page is not theirs
  import('./jump.js')
    .then(({ initJump }) => {
      if (id !== generation) return;
      s.jump = initJump({ reduced, busy: () => !!s.mode?.busy || (!!s.scene && !s.scene.settled) });
    })
    .catch(() => {});

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
  s.jump?.dispose();
  s.satellite?.dispose();
  s.mode?.dispose();
  s.legend?.dispose();
  s.scene?.dispose();
}

async function enterNarrow() {
  if (narrow) return;
  const n = (narrow = {});
  try {
    const { startNarrow } = await import('./narrow.js');
    if (narrow !== n) return;
    n.dispose = startNarrow({ saveData });
  } catch {
    // the links stand on their own
  }
}

function leaveNarrow() {
  const n = narrow;
  narrow = null;
  n?.dispose?.();
}

function sync() {
  if (narrowView.matches) {
    leaveWide();
    enterNarrow();
  } else {
    leaveNarrow();
    enterWide();
  }
}

narrowView.addEventListener('change', sync);
sync();
