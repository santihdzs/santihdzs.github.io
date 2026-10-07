// dev only browser checks. starts its own server, drives chromium, prints pass/fail.
// usage: node tools/check.mjs [section ...]
// sections: static load mobile interact reduced robust perf contrast align pick overscroll chain cardlayout rocket texture accent satellite
//           cards prs exits blend nebcolor starscontrast live
import { chromium } from 'playwright';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'out');
const PORT = 8091;
const ORIGIN = `http://localhost:${PORT}`;
const only = process.argv.slice(2);
const want = (s) => !only.length || only.includes(s);
const results = [];
const EM_DASH = String.fromCharCode(0x2014);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

// the real gpu on macos, software gl elsewhere
const gpuLaunch = process.platform === 'darwin' ? { channel: 'chromium', args: ['--use-angle=metal'] } : {};

async function open(browser, url, { width = 1440, height = 900, dsf = 1, reduced = false, init } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const logs = [];
  const failed = [];
  const requests = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(url, { waitUntil: 'networkidle' });
  return { context, page, logs, failed, requests };
}

const sceneReady = (page) => page.waitForSelector('.mode-toggle:not([hidden])', { timeout: 15000 });
const state = (page) => page.evaluate(() => window.__starfield.state());

// a point on the canvas where no star can be picked and nothing else sits on top
async function emptySpot(page) {
  return page.evaluate(() => {
    const f = window.__starfield;
    const card = document.querySelector('.card').getBoundingClientRect();
    for (let y = 140; y < innerHeight - 140; y += 23) {
      for (let x = 60; x < innerWidth - 60; x += 23) {
        if (x > card.left - 20 && x < card.right + 20 && y > card.top - 20 && y < card.bottom + 20) continue;
        if (f.pickAt(x, y, -1) >= 0) continue;
        const s = f.state();
        if (s.focus >= 0) {
          const p = f.project(s.focus);
          if (Math.hypot(p.x - x, p.y - y) < p.size / 2 + 30) continue;
        }
        if (document.elementFromPoint(x, y)?.classList.contains('starfield')) return { x, y };
      }
    }
    return null;
  });
}

async function scrollThrough(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= h; y += 300) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await sleep(60);
  }
  await sleep(1200);
}

async function staticChecks() {
  const files = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'out', 'vendor', 'fonts', '.claude'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(html|css|js|mjs|json|md|yml|svg)$/.test(e.name)) files.push(p);
    }
  }
  await walk(ROOT);
  const emDash = [];
  const absolute = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    if (text.includes(EM_DASH)) emDash.push(path.relative(ROOT, f));
    if (/\.(html|css|js)$/.test(f) && !f.includes(`${path.sep}tools${path.sep}`) && !f.includes(`${path.sep}scripts${path.sep}`)) {
      const bad = text.match(/(?:src|href)="\/(?!\/)|url\(['"]?\/(?!\/)|from ['"]\/|import\(['"]\/|fetch\(['"]\//g);
      if (bad) absolute.push(`${path.relative(ROOT, f)}: ${bad.join(', ')}`);
    }
  }
  check('no em dashes in authored files', !emDash.length, emDash.join(', '));
  check('no root absolute paths in site files', !absolute.length, absolute.join('; '));
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  check('exactly one h1', (html.match(/<h1\b/g) ?? []).length === 1);
  check('no canonical, cname or og:image', !/rel="canonical"|og:image/.test(html));
  const vendor = await readdir(path.join(ROOT, 'vendor', 'three'));
  check('three.module.js and three.core.js vendored', vendor.includes('three.module.js') && vendor.includes('three.core.js'));
}

async function loadChecks(gpu) {
  for (const base of ['/', '/sub/']) {
    for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
      const tag = `${w}x${h} ${base}`;
      const { page, context, logs, failed, requests } = await open(gpu, ORIGIN + base, { width: w, height: h, dsf: w > 720 ? 2 : 3 });
      if (w > 720) await sceneReady(page);
      await sleep(1600);
      const shot = base === '/' ? `load-${w}x${h}` : null;
      if (shot) await page.screenshot({ path: `${OUT}/${shot}-top.png` });
      if (w > 720) await scrollThrough(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (shot && w > 720) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(400);
        await page.screenshot({ path: `${OUT}/${shot}-full.png`, fullPage: true });
      }
      // data: and blob: urls are in memory, not network requests. the one runtime exception is now playing:
      // the worker and spotify's image host, on wide screens only
      const NOW_PLAYING_HOSTS = ['now-playing.santihdzs.workers.dev', 'i.scdn.co'];
      const external = requests.filter((u) => {
        if (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:')) return false;
        return !(w > 720 && NOW_PLAYING_HOSTS.includes(new URL(u).host));
      });
      const outside = requests.filter((u) => u.startsWith(ORIGIN) && base === '/sub/' && !u.startsWith(ORIGIN + '/sub/'));
      check(`${tag}: console clean`, !logs.length, logs.join(' | '));
      check(`${tag}: no failed requests`, !failed.length, failed.join(' | '));
      check(`${tag}: no external requests beyond now playing`, !external.length, external.join(' | '));
      if (base === '/sub/') check(`${tag}: every request stays under /sub/`, !outside.length, outside.join(' | '));
      check(`${tag}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
      if (w > 720) {
        const hidden = await page.evaluate(() =>
          [...document.querySelectorAll('[data-reveal], [data-reveal-group] > *')].filter((el) => getComputedStyle(el).opacity !== '1').length
        );
        check(`${tag}: every reveal ends visible`, hidden === 0, `${hidden} still hidden`);
      } else {
        const used = requests.filter((u) => /three|gsap|commits\.json|prs\.json|scene\//.test(u));
        check(`${tag}: mobile loads no three, gsap, scene, commit or pull request data`, !used.length, used.join(', '));
        const canvas = await page.locator('canvas').count();
        check(`${tag}: mobile has no canvas`, canvas === 0);
        const visible = await page.evaluate(() => ({
          linktree: getComputedStyle(document.querySelector('.linktree')).display !== 'none',
          sections: [...document.querySelectorAll('.section, .topbar, .site-footer')].every((el) => getComputedStyle(el).display === 'none'),
          buttons: [...document.querySelectorAll('.linktree a')].map((a) => Math.round(a.getBoundingClientRect().height)),
        }));
        check(`${tag}: only the linktree view shows`, visible.linktree && visible.sections);
        check(`${tag}: link buttons at least 52px tall`, visible.buttons.every((x) => x >= 52), visible.buttons.join(','));
      }
      await context.close();
    }
  }
}

async function interactChecks(gpu) {
  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 2 });
  await sceneReady(page);
  await sleep(1800);
  const data = await page.evaluate(() => fetch('./data/commits.json').then((r) => r.json()));

  // legend hover and pin
  const dots = page.locator('.legend-dot:not(.legend-all)');
  await dots.nth(0).hover();
  await sleep(450);
  let s = await state(page);
  const label = await page.locator('.legend-label').textContent();
  check('legend hover filters the field', s.filter === 0 && (await page.locator('.legend.is-filtering').count()) === 1, `filter=${s.filter} label="${label}"`);
  await page.screenshot({ path: `${OUT}/legend-hover.png` });
  await dots.nth(0).click();
  await page.mouse.move(700, 500);
  await sleep(450);
  s = await state(page);
  check('legend click pins the filter', s.filter === 0 && (await dots.nth(0).getAttribute('aria-pressed')) === 'true');
  await page.keyboard.press('Escape');
  await sleep(350);
  s = await state(page);
  check('escape clears the pinned filter', s.filter === null && (await dots.nth(0).getAttribute('aria-pressed')) === 'false');

  // toggle in and out
  await page.click('.mode-toggle');
  await sleep(1000);
  let m = await page.evaluate(() => ({
    stars: document.documentElement.classList.contains('is-stars'),
    inert: document.querySelector('main').inert,
    opacity: getComputedStyle(document.querySelector('main')).opacity,
    pressed: document.querySelector('.mode-toggle').getAttribute('aria-pressed'),
    label: document.querySelector('.mode-label').textContent,
    hint: document.querySelector('.hint').textContent,
  }));
  s = await state(page);
  check('toggle enters stars only mode', m.stars && m.inert && m.opacity === '0' && m.pressed === 'true' && m.label === 'back to page');
  check('stars mode runs at full intensity with the focal plane near the camera', s.intensity > 0.95 && Math.abs(s.focal - 8) < 0.2, `intensity=${s.intensity.toFixed(2)} focal=${s.focal.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}/stars-mode.png` });

  // wheel time travel
  const readout0 = await page.locator('.readout').textContent();
  const z0 = s.cam.z;
  await page.mouse.move(720, 450);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 400);
    await sleep(80);
  }
  await sleep(1400);
  s = await state(page);
  const readout1 = await page.locator('.readout').textContent();
  check('wheel travels back in time', s.cam.z < z0 - 3 && readout1 !== readout0, `z ${z0.toFixed(1)} -> ${s.cam.z.toFixed(1)}, ${readout0} -> ${readout1}`);
  await page.screenshot({ path: `${OUT}/stars-travel.png` });
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await sleep(900);
  const s2 = await state(page);
  check('arrow keys travel', s2.cam.z > s.cam.z + 0.5, `z ${s.cam.z.toFixed(1)} -> ${s2.cam.z.toFixed(1)}`);
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 5000);
  await sleep(1800);
  s = await state(page);
  const oldest = await page.evaluate(() => window.__starfield.layout.zOldest + 8);
  check('travel clamps at the oldest commit', Math.abs(s.cam.z - oldest) < 0.5, `z=${s.cam.z.toFixed(2)} min=${oldest.toFixed(2)}`);
  await page.keyboard.press('Home');
  await sleep(2500);

  // picking a star
  async function findStar() {
    return page.evaluate(() => {
      const f = window.__starfield;
      const st = f.state();
      let best = null;
      for (let i = 0; i < f.layout.n; i++) {
        const p = f.project(i);
        if (Math.abs(p.dist - st.focal) > 1.5) continue;
        if (p.x < 260 || p.x > innerWidth - 420 || p.y < 140 || p.y > innerHeight - 160) continue;
        if (!best || Math.abs(p.dist - st.focal) < Math.abs(best.dist - st.focal)) best = { i, ...p };
      }
      return best;
    });
  }
  let star = await findStar();
  check('a pickable star is on screen at the home position', !!star);
  if (star) {
    await page.mouse.move(star.x, star.y);
    await sleep(700);
    star = await page.evaluate((i) => ({ i, ...window.__starfield.project(i) }), star.i);
    await page.mouse.move(star.x, star.y);
    await sleep(150);
    const hover = await page.evaluate(() => ({
      ring: document.querySelector('.star-ring').classList.contains('is-visible'),
      cursor: document.querySelector('canvas.starfield').style.cursor,
      hover: window.__starfield.state().hover,
    }));
    check('hovering a star shows the ring and pointer cursor', hover.ring && hover.cursor === 'pointer' && hover.hover >= 0, JSON.stringify(hover));
    await page.screenshot({ path: `${OUT}/pick-hover.png` });
    const before = await state(page);
    await page.mouse.click(star.x, star.y);
    await sleep(1500);
    s = await state(page);
    const card = await page.evaluate(() => ({
      visible: !document.querySelector('.card').hidden,
      focusInside: document.querySelector('.card').contains(document.activeElement),
      msg: document.querySelector('.card-msg').textContent,
      repo: document.querySelector('[data-f="repo"]').textContent,
      hash: document.querySelector('[data-f="hash"]').textContent,
      link: document.querySelector('[data-f="link"]').href,
      target: document.querySelector('[data-f="link"]').target,
      rel: document.querySelector('[data-f="link"]').rel,
      live: document.querySelector('[aria-live]').textContent,
    }));
    const c = data.commits[s.focus];
    const repo = c && data.repos[c[0]].name;
    check('click flies to the star and opens its card', card.visible && s.focus >= 0 && card.msg === c[6] && card.repo === repo, `focus=${s.focus}`);
    check('card shows short hash and github link', card.hash === c[1].slice(0, 7) && card.link === `https://github.com/santihdzs/${encodeURIComponent(repo)}/commit/${c[1]}` && card.target === '_blank' && card.rel.includes('noopener'));
    check('card takes focus and feeds the live region', card.focusInside && card.live.length > 10);
    check('camera ends just in front of the star', Math.abs(s.focal - 2.6) < 0.1 && !s.flying);
    await page.screenshot({ path: `${OUT}/card.png` });

    const steps = await page.evaluate(() => [...document.querySelectorAll('.card-step')].map((b) => !b.disabled));
    const which = steps[1] ? 1 : steps[0] ? 0 : -1;
    if (which >= 0) {
      const from = s.focus;
      await page.locator('.card-step').nth(which).click();
      await sleep(1500);
      s = await state(page);
      const msg = await page.locator('.card-msg').textContent();
      const sameRepo = data.commits[from][0] === data.commits[s.focus][0];
      const later = which === 1 ? data.commits[s.focus][2] >= data.commits[from][2] : data.commits[s.focus][2] <= data.commits[from][2];
      check(`card ${which ? 'next' : 'prev'} steps within the repo`, s.focus !== from && sameRepo && later && msg === data.commits[s.focus][6]);
    } else {
      check('card prev or next available', false, 'single commit repo picked');
    }
    await page.keyboard.press('Escape');
    await sleep(1400);
    s = await state(page);
    const hidden = await page.locator('.card').isHidden();
    check('escape closes the card and flies back out', hidden && s.focus === -1 && Math.abs(s.cam.z - before.cam.z) < 0.05 && Math.abs(s.focal - 8) < 0.1);
  }

  // click on empty space closes the card
  await page.click('.browse');
  await sleep(1400);
  const empty = await emptySpot(page);
  await page.mouse.click(empty.x, empty.y);
  await sleep(1300);
  check('clicking empty space closes the card', await page.locator('.card').isHidden(), JSON.stringify(empty));

  // keyboard browse path
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Tab');
  let tabs = 1;
  while (tabs < 20 && !(await page.evaluate(() => document.activeElement?.classList.contains('browse')))) {
    await page.keyboard.press('Tab');
    tabs++;
  }
  check('tab reaches the browse control', await page.evaluate(() => document.activeElement?.classList.contains('browse')), `${tabs} tabs`);
  await page.keyboard.press('Enter');
  await sleep(1400);
  s = await state(page);
  check('browse opens the newest commit', s.focus === 0 && (await page.locator('.card-msg').textContent()) === data.commits[0][6]);
  await page.keyboard.press('ArrowLeft');
  await sleep(1400);
  s = await state(page);
  check('left arrow steps to the previous commit overall', s.focus === 1 && (await page.locator('.card-msg').textContent()) === data.commits[1][6]);
  await page.keyboard.press('ArrowRight');
  await sleep(1400);
  s = await state(page);
  check('right arrow steps forward again', s.focus === 0);
  const trap = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    trap.push(await page.evaluate(() => document.querySelector('.card').contains(document.activeElement)));
  }
  check('focus stays trapped in the card', trap.every(Boolean));
  await page.keyboard.press('Escape');
  await sleep(1300);
  check('closing returns focus to the browse control', await page.evaluate(() => document.activeElement?.classList.contains('browse')));

  // back to the page
  await page.click('.mode-toggle');
  await sleep(900);
  m = await page.evaluate(() => ({
    stars: document.documentElement.classList.contains('is-stars'),
    inert: document.querySelector('main').inert,
    opacity: getComputedStyle(document.querySelector('main')).opacity,
    y: window.scrollY,
  }));
  s = await state(page);
  check('toggle returns to the page at the top', !m.stars && !m.inert && m.opacity === '1' && m.y === 0 && Math.abs(s.intensity - 0.5) < 0.05);

  // rocket launch
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(1200);
  await page.locator('.rocket').hover();
  await sleep(400);
  await page.screenshot({ path: `${OUT}/rocket-hover.png` });
  await page.click('.rocket');
  await sleep(500);
  const mid = await page.evaluate(() => ({ flyer: !!document.querySelector('.rocket-flyer'), y: window.scrollY }));
  await page.screenshot({ path: `${OUT}/rocket-flight.png` });
  await sleep(2200);
  m = await page.evaluate(() => ({
    stars: document.documentElement.classList.contains('is-stars'),
    y: window.scrollY,
    flyer: !!document.querySelector('.rocket-flyer'),
  }));
  check('rocket flies while the page scrolls up', mid.flyer && mid.y > 0);
  check('rocket ends in stars only mode at the top', m.stars && m.y === 0 && !m.flyer);
  await page.keyboard.press('Escape');
  await sleep(900);
  check('escape leaves stars only mode', !(await page.evaluate(() => document.documentElement.classList.contains('is-stars'))));

  check('interaction run left the console clean', !logs.length, logs.join(' | '));
  await context.close();
}

async function reducedChecks(gpu) {
  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, reduced: true });
  await sceneReady(page);
  await sleep(1200);
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-name')).animationName);
  check('reduced motion: hero intro disabled', anim === 'none');
  const grab = () => page.screenshot({ clip: { x: 900, y: 80, width: 500, height: 400 } });
  const a = await grab();
  await page.mouse.move(100, 100);
  await sleep(1500);
  const b = await grab();
  check('reduced motion: field is static (no drift, twinkle or parallax)', a.equals(b));
  await page.click('.mode-toggle');
  await sleep(60);
  const m = await page.evaluate(() => getComputedStyle(document.querySelector('main')).opacity);
  let s = await state(page);
  check('reduced motion: mode change is instant', m === '0' && s.intensity === 1 && s.focal === 8);
  await page.click('.browse');
  await sleep(120);
  s = await state(page);
  check('reduced motion: zoom to a commit is instant', !(await page.locator('.card').isHidden()) && s.focal === 2.6);
  const cardBox = await page.locator('.card').boundingBox();
  await page.mouse.move(cardBox.x + 20, cardBox.y + cardBox.height - 10);
  await sleep(400);
  const still = await page.evaluate(() => ({
    tilt: document.querySelector('.card-body').style.transform,
    layers: [...document.querySelectorAll('.card-layer')].map((l) => l.style.translate).filter((t) => t && t !== 'none').join(''),
    opacity: getComputedStyle(document.querySelector('.card-in')).opacity,
    pulse: getComputedStyle(document.querySelector('.focus-pulse'), '::before').animationName,
  }));
  check('reduced motion: card has no tilt, no layer parallax, no pulse, no entrance fade', still.tilt === '' && still.layers === '' && still.opacity === '1' && still.pulse === 'none', JSON.stringify(still));
  await page.keyboard.press('Escape');
  await page.click('.mode-toggle');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(300);
  await page.click('.rocket');
  await sleep(80);
  const r = await page.evaluate(() => ({ stars: document.documentElement.classList.contains('is-stars'), flyer: !!document.querySelector('.rocket-flyer') }));
  check('reduced motion: rocket skips the flight', r.stars && !r.flyer);
  await page.click('.mode-toggle');
  const fired = await page.evaluate(() => window.__starfield.fireStreak());
  await sleep(1500);
  const streak = await page.evaluate(() => window.__starfield.streak());
  check('reduced motion: no pull request streaks', !fired && !streak);
  check('reduced motion: console clean', !logs.length, logs.join(' | '));
  await context.close();
}

async function robustChecks(gpu) {
  // no webgl
  let r = await open(gpu, ORIGIN + '/', {
    init: () => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return String(type).startsWith('webgl') ? null : orig.call(this, type, ...rest);
      };
    },
  });
  await sleep(1500);
  let v = await r.page.evaluate(() => ({
    canvas: document.querySelectorAll('canvas').length,
    toggle: document.querySelector('.mode-toggle').hidden,
    rocket: document.querySelector('.rocket').hidden,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  check('without webgl the scene is skipped quietly', v.canvas === 0 && v.toggle && v.rocket && !r.logs.length, `${JSON.stringify(v)} ${r.logs.join(' | ')}`);
  await r.page.screenshot({ path: `${OUT}/no-webgl.png` });
  await r.context.close();

  // failed data fetch
  r = await open(gpu, ORIGIN + '/', {});
  await r.context.close();
  const ctx = await gpu.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route('**/data/commits.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
  let page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
  await sleep(1200);
  v = await page.evaluate(() => ({ canvas: document.querySelectorAll('canvas').length, stats: document.querySelector('.stats').textContent.trim(), dot: !!document.querySelector('.stats-dot') }));
  check('failed data fetch: no scene, footer shows only the copyright, no exceptions', v.canvas === 0 && v.stats === '© 2026 Santiago Hernández' && !v.dot && !errs.length, v.stats);
  await ctx.close();

  // tiny and empty datasets
  const tiny = JSON.parse(await readFile(path.join(ROOT, 'data', 'commits.json'), 'utf8'));
  for (const n of [5, 1, 0]) {
    const c2 = await gpu.newContext({ viewport: { width: 1440, height: 900 } });
    await c2.route('**/data/commits.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...tiny, commits: tiny.commits.slice(0, n) }) }));
    page = await c2.newPage();
    const logs = [];
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(e.message));
    await page.goto(ORIGIN + '/?debug', { waitUntil: 'networkidle' });
    await sleep(1200);
    const ready = await page.locator('.mode-toggle:not([hidden])').count();
    if (ready) {
      await page.click('.mode-toggle');
      await sleep(900);
      for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 800);
      await page.click('.browse');
      await sleep(1400);
      await page.keyboard.press('ArrowLeft');
      await sleep(400);
      await page.keyboard.press('Escape');
      await sleep(400);
      await page.keyboard.press('Escape');
      await sleep(400);
    }
    const stats = await page.locator('.stats').textContent();
    check(`dataset of ${n} commits works without errors`, ready && !logs.length, `${stats.trim() || 'stats hidden'} ${logs.join(' | ')}`);
    await c2.close();
  }

  // crossing the breakpoint
  r = await open(gpu, ORIGIN + '/', { width: 1440, height: 900 });
  await sceneReady(r.page);
  await r.page.click('.mode-toggle');
  await sleep(700);
  await r.page.setViewportSize({ width: 600, height: 900 });
  await sleep(500);
  v = await r.page.evaluate(() => ({ canvas: document.querySelectorAll('canvas').length, stars: document.documentElement.classList.contains('is-stars'), inert: document.querySelector('main').inert }));
  check('narrowing disposes the scene and leaves stars mode', v.canvas === 0 && !v.stars && !v.inert);
  await r.page.setViewportSize({ width: 1300, height: 900 });
  await r.page.waitForSelector('canvas.starfield', { timeout: 8000 }).catch(() => {});
  await sleep(800);
  v = await r.page.evaluate(() => ({ canvas: document.querySelectorAll('canvas').length, legend: document.querySelectorAll('.legend button').length }));
  check('widening rebuilds the scene once', v.canvas === 1 && v.legend > 1 && !r.logs.length, `${JSON.stringify(v)} ${r.logs.join(' | ')}`);
  await r.context.close();

  // save data
  r = await open(gpu, ORIGIN + '/', {
    init: () => Object.defineProperty(Navigator.prototype, 'connection', { get: () => ({ saveData: true }) }),
  });
  await sleep(1500);
  const heavy = r.requests.filter((u) => /three|commits\.json/.test(u));
  check('save data skips three.js and the commit data', !heavy.length && !(await r.page.locator('canvas').count()), heavy.join(', '));
  await r.context.close();
}

const frameStats = (page, n = 180) =>
  page.evaluate(
    (count) =>
      new Promise((res) => {
        const times = [];
        let last = performance.now();
        const f = (t) => {
          times.push(t - last);
          last = t;
          if (times.length < count) requestAnimationFrame(f);
          else {
            times.sort((a, b) => a - b);
            res({ avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)] });
          }
        };
        requestAnimationFrame(f);
      }),
    n
  );

async function perfChecks(gpu) {
  const fmt = (m) => `avg ${m.avg.toFixed(1)}ms p95 ${m.p95.toFixed(1)}ms`;
  const runs = {};
  for (const tex of ['nebula', 'none']) {
    const r = await open(gpu, `${ORIGIN}/?debug&texture=${tex}`, { width: 1440, height: 900, dsf: 2 });
    await sceneReady(r.page);
    await sleep(1500);
    const content = await frameStats(r.page);
    await r.page.click('.mode-toggle');
    await sleep(900);
    const stars = await frameStats(r.page);
    runs[tex] = { content, stars, dpr: await r.page.evaluate(() => document.querySelector('canvas.starfield').dataset.dpr) };
    await r.context.close();
  }
  const b = runs.nebula;
  check('gpu frame time stays at the display rate with the nebula on', b.content.avg < 20 && b.stars.avg < 20, `content ${fmt(b.content)}, stars ${fmt(b.stars)}, dpr ${b.dpr}`);

  // vsync hides gpu cost on a fast machine, so compare the textures on software gl where every pixel costs time
  const softCompare = await chromium.launch();
  const compare = {};
  for (const tex of ['none', 'nebula']) {
    const r = await open(softCompare, `${ORIGIN}/?debug&texture=${tex}`, { width: 1440, height: 900, dsf: 1 });
    await sceneReady(r.page);
    await r.page.click('.mode-toggle');
    await sleep(1500);
    compare[tex] = await frameStats(r.page, 120);
    await r.context.close();
  }
  await softCompare.close();
  const extra = compare.nebula.avg - compare.none.avg;
  check('the nebula adds little frame time even on software gl', extra < Math.max(3, compare.none.avg * 0.2), `none ${fmt(compare.none)}, nebula ${fmt(compare.nebula)}, +${extra.toFixed(1)}ms`);

  // software gl at 2x with a throttled cpu, the case adaptive resolution exists for
  const soft = await chromium.launch();
  const s = await open(soft, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 2 });
  await sceneReady(s.page);
  const cdp = await s.context.newCDPSession(s.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const seen = [];
  for (let i = 0; i < 40; i++) {
    seen.push(await s.page.evaluate(() => Number(document.querySelector('canvas.starfield').dataset.dpr)));
    await sleep(500);
  }
  const monotonic = seen.every((d, i) => i === 0 || d <= seen[i - 1]);
  check('adaptive resolution steps down on a slow device and never back up', seen[0] === 2 && seen.at(-1) < 2 && monotonic, `dpr over 20s: ${[...new Set(seen)].join(' -> ')}`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await sleep(2500);
  const after = await s.page.evaluate(() => Number(document.querySelector('canvas.starfield').dataset.dpr));
  check('dpr stays down after the device speeds up again', after <= seen.at(-1), `${after}`);
  // hidden tab stops rendering
  const frames = await s.page.evaluate(
    () =>
      new Promise((res) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        const canvas = document.querySelector('canvas.starfield');
        const gl = canvas.getContext('webgl2');
        let draws = 0;
        const orig = gl.drawArrays.bind(gl);
        gl.drawArrays = (...a) => (draws++, orig(...a));
        setTimeout(() => res(draws), 1500);
      })
  );
  check('rendering pauses while the tab is hidden', frames === 0, `${frames} draws in 1.5s`);
  await s.context.close();
  await soft.close();
}

// background luminance behind text, measured from real pixels with the text hidden
async function contrastChecks(gpu) {
  const r = await open(gpu, ORIGIN + '/', { width: 1440, height: 900, dsf: 1 });
  await sceneReady(r.page);
  await scrollThrough(r.page);
  const lum = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  let worst = { ratio: 99 };
  for (const y of [0, 900, 1800, 2700, 3600, 4500]) {
    await r.page.evaluate((v) => window.scrollTo(0, v), y);
    await sleep(500);
    const boxes = await r.page.evaluate(() => {
      const els = [...document.querySelectorAll('main p, main h1, main h2, main h3, main a, main dt, main dd, .row-desc, .row-tags span, .row-year, footer .stats')].filter((el) => !el.closest('.orbit'));
      return els
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g).map(Number);
          return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, color: m.slice(0, 3), text: el.textContent.trim().slice(0, 30) };
        })
        .filter((b) => b.w > 0 && b.h > 0 && b.y > 72 && b.y + b.h < innerHeight);
    });
    // glyphs go transparent but their bg colored text shadow stays, it is part of the rendered background
    await r.page.addStyleTag({ content: '*{color:transparent!important;transition:none!important} svg{visibility:hidden!important}' });
    await sleep(120);
    const png = await r.page.screenshot();
    await r.page.evaluate(() => document.querySelector('style:last-of-type').remove());
    const probe = await gpu.newPage();
    const stats = await probe.evaluate(
      async ({ src, boxes }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return boxes.map((b) => {
          const d = g.getImageData(Math.max(0, b.x), Math.max(0, b.y), Math.max(1, b.w), Math.max(1, b.h)).data;
          const vals = [];
          for (let i = 0; i < d.length; i += 4) vals.push([d[i], d[i + 1], d[i + 2]]);
          vals.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
          return { ...b, bg: vals[Math.floor(vals.length * 0.95)] };
        });
      },
      { src: `data:image/png;base64,${png.toString('base64')}`, boxes }
    );
    await probe.close();
    for (const b of stats) {
      const L = (rgb) => 0.2126 * lum(rgb[0]) + 0.7152 * lum(rgb[1]) + 0.0722 * lum(rgb[2]);
      const ratio = (L(b.color) + 0.05) / (L(b.bg) + 0.05);
      if (ratio < worst.ratio) worst = { ratio, ...b, scroll: y };
    }
  }
  check('text keeps aa contrast over the live starfield (95th pct background)', worst.ratio >= 4.5, `worst ${worst.ratio.toFixed(2)}:1 "${worst.text}" bg rgb(${worst.bg}) at scroll ${worst.scroll}`);
  await r.context.close();
}

// rendered star pixels and the hover ring must land where the picker projects them, with real scrollbars
async function alignChecks() {
  const browser = await chromium.launch({ ...gpuLaunch, ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    for (const [w, h, forced] of [[1440, 900, false], [2560, 1440, false], [1440, 900, true], [2560, 1440, true]]) {
      for (const dsf of [1, 1.25, 1.5, 2]) {
        const tag = `${w}x${h} @${dsf}x${forced ? ' canvas inside the gutter' : ''}`;
        const { page, context, logs } = await open(browser, `${ORIGIN}/?debug`, { width: w, height: h, dsf, reduced: true });
        await sceneReady(page);
        // the shipped canvas is 100vw; forcing it back to 100% keeps this check sensitive to any
        // code that sizes the scene from window.innerWidth instead of the canvas
        if (forced) {
          await page.addStyleTag({ content: '.starfield { width: 100% !important; }' });
          await sleep(300);
        }
        const gutter = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
        await page.click('.mode-toggle');
        await sleep(600);
        // isolated, sharp, reasonably large stars, spread across the width
        const stars = await page.evaluate(() => {
          const f = window.__starfield;
          const st = f.state();
          const all = [];
          for (let i = 0; i < f.layout.n; i++) all.push({ i, ...f.project(i) });
          const vw = document.documentElement.clientWidth;
          const picks = all.filter((p) => {
            if (Math.abs(p.dist - st.focal) > 2.6 || p.x < 60 || p.x > vw - 60 || p.y < 110 || p.y > innerHeight - 140) return false;
            // only other bright stars can pull the centroid, the far haze sits under the threshold
            return all.every((q) => q.i === p.i || q.dist < 0.8 || Math.abs(q.dist - st.focal) > 4 || Math.hypot(q.x - p.x, q.y - p.y) > 36);
          });
          picks.sort((a, b) => b.x - a.x);
          return picks.slice(0, 3);
        });
        if (!stars.length) {
          check(`${tag}: alignment star available`, false);
          await context.close();
          continue;
        }
        let worstPix = 0;
        let worstRing = 0;
        const offsets = [];
        for (const star of stars) {
          const r = 22;
          const clip = { x: Math.round(star.x - r), y: Math.round(star.y - r), width: 2 * r, height: 2 * r };
          const png = await page.screenshot({ clip });
          const probe = await browser.newPage();
          const c = await probe.evaluate(
            async ({ src }) => {
              const img = new Image();
              img.src = src;
              await img.decode();
              const cv = document.createElement('canvas');
              cv.width = img.width;
              cv.height = img.height;
              const g = cv.getContext('2d');
              g.drawImage(img, 0, 0);
              const d = g.getImageData(0, 0, img.width, img.height).data;
              let max = 0;
              const lum = [];
              for (let k = 0; k < d.length; k += 4) {
                const l = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
                lum.push(l);
                max = Math.max(max, l);
              }
              let sx = 0, sy = 0, sw = 0;
              lum.forEach((l, k) => {
                if (l < max * 0.6) return;
                const wgt = l - max * 0.6;
                sx += (k % img.width + 0.5) * wgt;
                sy += (Math.floor(k / img.width) + 0.5) * wgt;
                sw += wgt;
              });
              return { x: sx / sw, y: sy / sw, w: img.width, max };
            },
            { src: `data:image/png;base64,${png.toString('base64')}` }
          );
          await probe.close();
          const scale = c.w / clip.width;
          const cx = clip.x + c.x / scale;
          const cy = clip.y + c.y / scale;
          worstPix = Math.max(worstPix, Math.hypot(cx - star.x, cy - star.y));
          offsets.push(`${(cx - star.x).toFixed(2)},${(cy - star.y).toFixed(2)}@${Math.round(star.x)}`);
          await page.mouse.move(star.x, star.y);
          await sleep(120);
          const ring = await page.evaluate(() => {
            const el = document.querySelector('.star-ring');
            const b = el.getBoundingClientRect();
            return { on: el.classList.contains('is-visible'), x: b.x + b.width / 2, y: b.y + b.height / 2 };
          });
          const fresh = await page.evaluate((i) => window.__starfield.project(i), star.i);
          worstRing = Math.max(worstRing, ring.on ? Math.hypot(ring.x - fresh.x, ring.y - fresh.y) : 99);
        }
        check(`${tag}: rendered stars sit on their projected position (gutter ${gutter}px)`, worstPix <= 1.5, `worst ${worstPix.toFixed(2)}px over ${stars.length} stars, dx,dy@x ${offsets.join(' ')}`);
        check(`${tag}: hover ring is centered on the projected star`, worstRing <= 0.75, `worst ${worstRing.toFixed(2)}px`);
        if (logs.length) check(`${tag}: console clean`, false, logs.join(' | '));
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

// pick range: hover only where a click works, and every visibly sharp star can be reached
async function pickChecks(gpu) {
  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 2, reduced: true });
  await sceneReady(page);
  await page.click('.mode-toggle');
  await sleep(600);
  const counts = await page.evaluate(() => {
    const f = window.__starfield;
    const st = f.state();
    let older = 0;
    let now = 0;
    for (let i = 0; i < f.layout.n; i++) {
      const p = f.project(i);
      if (p.x < 0 || p.x > innerWidth || p.y < 0 || p.y > innerHeight || p.dist < 0.8) continue;
      if (Math.abs(p.dist - st.focal) <= 2.6) older++;
      if (p.coc < 26) now++;
    }
    return { older, now };
  });
  check('pickable range grew well past the old 2.6 unit band', counts.now >= counts.older * 2.5, `${counts.older} stars before, ${counts.now} now, on screen at home`);

  // sweep a grid with the real mouse: ring, cursor and hover agree with what a click would pick
  let mismatches = 0;
  let points = 0;
  let hits = 0;
  for (let y = 100; y < 800; y += 34) {
    for (let x = 40; x < 1400; x += 34) {
      await page.mouse.move(x, y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const r = await page.evaluate(([px, py]) => {
        const f = window.__starfield;
        const onCanvas = document.elementFromPoint(px, py)?.classList.contains('starfield');
        const ring = document.querySelector('.star-ring').classList.contains('is-visible');
        const cursor = document.querySelector('canvas.starfield').style.cursor === 'pointer';
        return { onCanvas, ring, cursor, hover: f.state().hover, pick: f.pickAt(px, py, -1) };
      }, [x, y]);
      if (!r.onCanvas) continue;
      points++;
      if (r.pick >= 0) hits++;
      const agree = r.ring === r.pick >= 0 && r.cursor === r.pick >= 0 && r.hover === r.pick;
      if (!agree) mismatches++;
    }
  }
  check('grid sweep: ring and pointer appear exactly where a click picks a star', mismatches === 0, `${points} points, ${hits} over stars, ${mismatches} mismatches`);

  const unreachable = await page.evaluate(() => {
    const f = window.__starfield;
    const bad = [];
    for (let i = 0; i < f.layout.n; i++) {
      const p = f.project(i);
      if (p.coc >= 26 || p.dist < 0.8 || p.x < 20 || p.x > innerWidth - 20 || p.y < 90 || p.y > innerHeight - 100) continue;
      let ok = f.pickAt(p.x, p.y, -1) === i;
      for (let a = 0; a < 16 && !ok; a++) {
        for (const r of [3, 6, 9]) ok ||= f.pickAt(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, -1) === i;
      }
      if (!ok) bad.push(i);
    }
    return bad;
  });
  check('no visibly sharp star (blur under 26px) is unclickable', !unreachable.length, unreachable.join(','));

  // a sharp star a little off the cursor beats a blurry one right under it
  const contest = await page.evaluate(() => {
    const f = window.__starfield;
    const all = [];
    for (let i = 0; i < f.layout.n; i++) all.push({ i, ...f.project(i) });
    for (const b of all.filter((p) => p.coc > 16 && p.coc < 26)) {
      for (const s of all.filter((p) => p.coc < 4)) {
        const d = Math.hypot(s.x - b.x, s.y - b.y);
        if (d > 3 && d < 9) return { blurry: b.i, sharp: s.i, picked: f.pickAt(b.x, b.y, -1) };
      }
    }
    return null;
  });
  if (contest) check('sharpness breaks near ties: the sharp neighbour wins over a blurry star under the cursor', contest.picked === contest.sharp, JSON.stringify(contest));
  else check('sharpness tie break (no blurry and sharp pair close enough at home, skipped)', true);
  check('pick checks left the console clean', !logs.length, logs.join(' | '));
  await context.close();
}

async function wheelAt(page, dy, count, gap) {
  for (let i = 0; i < count; i++) {
    await page.mouse.wheel(0, dy);
    if (gap) await sleep(gap);
  }
}

// overscroll exit at the newest end, with its guards
async function overscrollChecks(gpu) {
  for (const reduced of [false, true]) {
    const tag = reduced ? 'reduced motion: ' : '';
    const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 1, reduced });
    await sceneReady(page);
    const stars = () => page.evaluate(() => document.documentElement.classList.contains('is-stars'));
    await page.click('.mode-toggle');
    await sleep(900);
    await page.mouse.move(700, 450);

    if (!reduced) {
      await sleep(400);
      await wheelAt(page, -120, 8, 70);
      await sleep(600);
      check('no exit before traveling back a few units', await stars());

      // travel back, then ride a long inertial stream into the edge without a pause
      await wheelAt(page, 150, 8, 30);
      await sleep(900);
      let s = await state(page);
      check('traveling back arms the exit', s.exit.armed, `z=${s.cam.z.toFixed(2)}`);
      await wheelAt(page, -60, 90, 16);
      check('inertial scrolling that arrives at the edge does not exit', await stars());
      s = await state(page);
      const hint = await page.locator('.hint').textContent();
      check('arriving at the edge invites a second scroll', hint === 'scroll again to return to the page' && !(await page.locator('.hint.is-faded').count()), hint);

      // a fresh gesture after a rest, released below the threshold, eases back
      await sleep(600);
      await page.mouse.wheel(0, -120);
      await sleep(120);
      s = await state(page);
      const pulled = s.band;
      const focalPulled = s.focal;
      await sleep(900);
      s = await state(page);
      check('a short pull shows the rubber band, then eases back without exiting', pulled > 0.1 && pulled <= 1 && focalPulled > 8 && s.band < 0.02 && (await stars()), `band ${pulled.toFixed(2)}, focal ${focalPulled.toFixed(2)}`);
      check('the rubber band never goes past a quarter of the way', focalPulled <= 8 + 0.25 * 7 + 0.01);
    } else {
      await wheelAt(page, 150, 8, 30);
      await sleep(400);
      await wheelAt(page, -150, 10, 30);
      await sleep(600);
    }

    // a fresh, committed gesture returns to the page
    await sleep(600);
    await wheelAt(page, -100, 4, 60);
    await sleep(reduced ? 60 : 900);
    const back = await page.evaluate(() => ({
      stars: document.documentElement.classList.contains('is-stars'),
      opacity: getComputedStyle(document.querySelector('main')).opacity,
      y: window.scrollY,
    }));
    check(`${tag}a fresh gesture past the edge returns to the page`, !back.stars && back.y === 0 && (reduced ? back.opacity === '1' : true), JSON.stringify(back));
    if (reduced) {
      check('reduced motion: the overscroll exit is instant', back.opacity === '1');
    } else {
      await sleep(400);
      await wheelAt(page, 120, 6, 60);
      await sleep(500);
      const after = await page.evaluate(() => ({ stars: document.documentElement.classList.contains('is-stars'), y: window.scrollY }));
      check('after exiting, scrolling down scrolls the page and never re-enters', !after.stars && after.y > 100, JSON.stringify(after));

      // the oldest end only clamps
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click('.mode-toggle');
      await sleep(900);
      await page.keyboard.press('End');
      await sleep(2500);
      await wheelAt(page, 400, 12, 60);
      await sleep(600);
      const s = await state(page);
      const min = await page.evaluate(() => window.__starfield.layout.zOldest + 8);
      check('the oldest end clamps, no exit there', (await stars()) && Math.abs(s.cam.z - min) < 0.3);
    }
    check(`${tag}overscroll checks left the console clean`, !logs.length, logs.join(' | '));
    await context.close();
  }

  // touch: a vertical drag past the edge does the same
  const ctx = await gpu.newContext({ viewport: { width: 1200, height: 900 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/?debug`, { waitUntil: 'networkidle' });
  await sceneReady(page);
  await page.click('.mode-toggle');
  await sleep(900);
  const cdp = await ctx.newCDPSession(page);
  const drag = async (x, y0, y1, steps) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let k = 1; k <= steps; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * k) / steps }] });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await drag(600, 700, 150, 20);
  await sleep(900);
  let s = await state(page);
  const traveled = s.cam.z < -3;
  await drag(600, 150, 750, 20);
  await sleep(900);
  const stillStars = await page.evaluate(() => document.documentElement.classList.contains('is-stars'));
  // a fresh drag only counts once the camera has come to rest at the edge
  await page.waitForFunction(() => window.__starfield.state().exit.edgeSince > 0, null, { timeout: 6000 }).catch(() => {});
  await sleep(450);
  await drag(600, 200, 650, 15);
  await sleep(900);
  const exited = await page.evaluate(() => !document.documentElement.classList.contains('is-stars'));
  check('touch: dragging travels, arriving at the edge stays, a fresh drag past it returns to the page', traveled && stillStars && exited, `traveled ${traveled}, stayed ${stillStars}, exited ${exited}`);
  await ctx.close();
}

// with a card open, clicking another star travels there; closing still returns home
async function chainChecks(gpu) {
  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 2 });
  await sceneReady(page);
  await page.click('.mode-toggle');
  await sleep(900);
  await page.mouse.move(720, 450);
  const home = (await state(page)).cam;
  await page.click('.browse');
  await sleep(1500);
  const otherStar = (exclude) =>
    page.evaluate((ex) => {
      const f = window.__starfield;
      const st = f.state();
      const card = document.querySelector('.card').getBoundingClientRect();
      for (let i = 0; i < f.layout.n; i++) {
        if (i === st.focus || ex.includes(i)) continue;
        const p = f.project(i);
        if (p.coc >= 26 || p.dist < 0.8 || p.x < 80 || p.x > innerWidth - 80 || p.y < 120 || p.y > innerHeight - 130) continue;
        if (p.x > card.left - 30 && p.x < card.right + 30 && p.y > card.top - 30 && p.y < card.bottom + 30) continue;
        if (f.pickAt(p.x, p.y, st.focus) === i && document.elementFromPoint(p.x, p.y)?.classList.contains('starfield')) return { i, x: p.x, y: p.y };
      }
      return null;
    }, exclude);

  let s = await state(page);
  const first = s.focus;
  const target = await otherStar([]);
  check('another pickable star is reachable while a card is open', !!target);
  if (target) {
    await page.mouse.move(target.x, target.y);
    await sleep(150);
    const h = await page.evaluate(() => ({ ring: document.querySelector('.star-ring').classList.contains('is-visible'), hover: window.__starfield.state().hover, focus: window.__starfield.state().focus }));
    check('hover works for other stars while a card is open', h.ring && h.hover === target.i && h.hover !== h.focus);
    await page.mouse.click(target.x, target.y);
    // a click mid flight is dropped, not queued
    const third = await otherStar([target.i]);
    await sleep(200);
    if (third) await page.mouse.click(third.x, third.y);
    await sleep(1500);
    s = await state(page);
    const msg = await page.locator('.card-msg').textContent();
    const data = await page.evaluate(() => fetch('./data/commits.json').then((r) => r.json()));
    check('clicking another star flies there and the card swaps to it', s.focus === target.i && msg === data.commits[target.i][6] && !(await page.locator('.card').isHidden()));
    check('a click during the flight was ignored', s.focus === target.i);
    check('the original position is kept across chained flights', Math.abs(s.saved.z - home.z) < 0.01 && Math.abs(s.saved.x - home.x) < 0.01, JSON.stringify(s.saved));

    // clicking the focused star itself does nothing
    const fp = await page.evaluate(() => window.__starfield.project(window.__starfield.state().focus));
    await page.mouse.click(fp.x, fp.y);
    await sleep(500);
    s = await state(page);
    check('clicking the focused star does nothing', s.focus === target.i && !s.flying && !(await page.locator('.card').isHidden()));

    // the card itself never passes a click to the canvas, and the cursor stays default there
    const cardBox = await page.locator('.card-date').boundingBox();
    await page.mouse.move(cardBox.x + 4, cardBox.y + 4);
    await sleep(150);
    const overCard = await page.evaluate(() => ({ hover: window.__starfield.state().hover, cursor: document.querySelector('canvas.starfield').style.cursor }));
    await page.mouse.click(cardBox.x + 4, cardBox.y + 4);
    await sleep(400);
    s = await state(page);
    check('over the card: no hover, default cursor, clicks stay in the card', overCard.hover === -1 && overCard.cursor === '' && s.focus === target.i && !(await page.locator('.card').isHidden()));

    await page.keyboard.press('Escape');
    await sleep(1500);
    s = await state(page);
    check('closing after chained flights returns to where the user was', s.focus === -1 && Math.abs(s.cam.z - home.z) < 0.05 && Math.abs(s.cam.x - home.x) < 0.05, JSON.stringify(s.cam));
  }
  check('chain checks left the console clean', !logs.length, logs.join(' | '));
  await context.close();
  return first;
}

// the card sits beside its star, inside the viewport, at several sizes, flipping when needed
async function cardLayoutChecks(gpu) {
  for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080], [800, 900]]) {
    const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: w, height: h, dsf: 1 });
    await sceneReady(page);
    await page.click('.mode-toggle');
    await sleep(900);
    await page.mouse.move(w / 2, h / 2);
    await page.click('.browse');
    await sleep(1700);
    const g = await page.evaluate(() => {
      const f = window.__starfield;
      const p = f.project(f.state().focus);
      const c = document.querySelector('.card').getBoundingClientRect();
      const tether = document.querySelector('.card-tether').classList.contains('is-visible');
      const vw = document.documentElement.clientWidth;
      const nearest = { x: Math.max(c.left, Math.min(p.x, c.right)), y: Math.max(c.top, Math.min(p.y, c.bottom)) };
      return { inside: c.left >= 0 && c.top >= 0 && c.right <= vw && c.bottom <= innerHeight, gap: Math.hypot(nearest.x - p.x, nearest.y - p.y) - p.size / 2, tether, side: c.left > p.x ? 'right' : 'left' };
    });
    check(`${w}x${h}: card inside the viewport, clear of its star, tethered`, g.inside && g.gap > 8 && g.tether, JSON.stringify(g));
    await page.screenshot({ path: `${OUT}/card-${w}x${h}.png` });

    if (w === 1440) {
      // fly to a star near the right edge: mid flight the card must flip to the star's left.
      // step through older commits until one has a pickable neighbour out there.
      const findRight = () =>
        page.evaluate(() => {
          const f = window.__starfield;
          const st = f.state();
          let best = null;
          for (let i = 0; i < f.layout.n; i++) {
            if (i === st.focus) continue;
            const p = f.project(i);
            if (p.coc >= 26 || p.dist < 0.8 || p.y < 150 || p.y > innerHeight - 160 || p.x > innerWidth - 40) continue;
            if (f.pickAt(p.x, p.y, st.focus) !== i || !document.elementFromPoint(p.x, p.y)?.classList.contains('starfield')) continue;
            if (!best || p.x > best.x) best = { i, x: p.x, y: p.y };
          }
          return best;
        });
      let right = await findRight();
      for (let k = 0; k < 15 && !(right && right.x > w - 360); k++) {
        await page.keyboard.press('ArrowLeft');
        await sleep(1400);
        right = await findRight();
      }
      if (right && right.x > w - 360) {
        await page.mouse.click(right.x, right.y);
        const samples = [];
        for (let k = 0; k < 6; k++) {
          await sleep(60);
          samples.push(
            await page.evaluate((i) => {
              const p = window.__starfield.project(i);
              const c = document.querySelector('.card').getBoundingClientRect();
              return { flipped: c.right <= p.x, inside: c.left >= 0 && c.right <= document.documentElement.clientWidth, x: Math.round(p.x) };
            }, right.i)
          );
        }
        check('mid flight to a star near the right edge the card flips to its left and stays on screen', samples.some((q) => q.flipped) && samples.every((q) => q.inside), JSON.stringify(samples));
        await sleep(1400);
      } else {
        check('found a star near the right edge to test the flip', false);
      }
    }
    check(`${w}x${h}: console clean`, !logs.length, logs.join(' | '));
    await context.close();
  }
}

// launch frames: trail and flame never draw inside the rocket outline
async function rocketChecks(gpu) {
  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 2 });
  await sceneReady(page);
  // plain background so any exhaust pixel inside the outline would stand out
  await page.addStyleTag({ content: '.starfield, .vignette { visibility: hidden !important; }' });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(900);
  // ROCKET_OLD_BUG=1 puts back the original defect (fill-box flame, no mask) to prove this check catches it
  if (process.env.ROCKET_OLD_BUG) await page.addStyleTag({ content: '.rocket-flame { transform-box: fill-box !important; transform-origin: 50% 0; } .rocket-flyer g[mask] { mask: none !important; }' });
  await page.click('.rocket');
  // gsap returns the timeline from pause and seek; never hand that object back to playwright
  await page.evaluate(() => {
    window.__launch?.pause();
  });
  // the outline is see-through: hide the page behind it too, only the flat background may show
  await page.addStyleTag({ content: 'main, .site-footer, .topbar, .stars-ui { visibility: hidden !important; }' });
  const has = await page.evaluate(() => !!window.__launch);
  check('launch timeline exposed for frame capture', has);
  // differential test: each frame is captured with and without the exhaust group. a pixel that
  // changes and lies inside the rocket silhouette (fill or its outline) is exhaust drawn where it
  // must not be. the browser itself answers which pixels are inside, via isPointInFill/Stroke.
  const fs = await import('node:fs/promises');
  let leaks = 0;
  let frames = 0;
  let changed = 0;
  const leakNotes = [];
  for (let t = 0; t <= 1.5001; t += 0.1) {
    await page.evaluate((v) => {
      window.__launch.seek(v);
    }, t);
    await sleep(40);
    const box = await page.evaluate(() => {
      const r = document.querySelector('.rocket-flyer svg').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    if (box.y + 44 < 0) continue;
    frames++;
    const clip = { x: Math.floor(Math.max(0, box.x - 4)), y: Math.floor(Math.max(0, box.y - 4)), width: Math.ceil(box.w + 8), height: Math.ceil(Math.min(box.h, 120) + 8) };
    const scale = 2;
    const inside = await page.evaluate(
      ({ clip, scale }) => {
        const svg = document.querySelector('.rocket-flyer svg');
        const path = svg.querySelector('mask path');
        const r = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        const w = clip.width * scale;
        const h = clip.height * scale;
        const out = new Uint8Array(w * h);
        const pt = svg.createSVGPoint();
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            pt.x = vb.x + ((clip.x + (px + 0.5) / scale - r.x) * vb.width) / r.width;
            pt.y = vb.y + ((clip.y + (py + 0.5) / scale - r.y) * vb.height) / r.height;
            out[py * w + px] = path.isPointInFill(pt) || path.isPointInStroke(pt) ? 1 : 0;
          }
        }
        return Array.from(out);
      },
      { clip, scale }
    );
    const withExhaust = await page.screenshot({ clip });
    await page.addStyleTag({ content: '.rocket-flyer g[mask] { visibility: hidden !important; }' });
    await sleep(30);
    const without = await page.screenshot({ clip });
    await page.evaluate(() => document.querySelector('style:last-of-type').remove());
    await fs.writeFile(`${OUT}/rocket-frame-${String(Math.round(t * 1000)).padStart(4, '0')}.png`, withExhaust);
    const probe = await gpu.newPage();
    const res = await probe.evaluate(
      async ({ a, b, inside }) => {
        const read = async (src) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, img.width, img.height).data;
        };
        const da = await read(a);
        const db = await read(b);
        let leak = 0;
        let diff = 0;
        for (let k = 0; k < inside.length; k++) {
          const d = Math.abs(da[k * 4] - db[k * 4]) + Math.abs(da[k * 4 + 1] - db[k * 4 + 1]) + Math.abs(da[k * 4 + 2] - db[k * 4 + 2]);
          if (d > 6) {
            diff++;
            if (inside[k]) leak++;
          }
        }
        return { leak, diff };
      },
      { a: `data:image/png;base64,${withExhaust.toString('base64')}`, b: `data:image/png;base64,${without.toString('base64')}`, inside }
    );
    await probe.close();
    leaks += res.leak;
    changed += res.diff;
    if (res.leak) leakNotes.push(`t${t.toFixed(1)}:${res.leak}`);
  }
  check('rocket launch frames: no trail or flame pixel inside the outline', leaks === 0 && frames >= 8 && changed > 0, `${frames} frames, ${changed} exhaust pixels drawn, ${leaks} inside the silhouette ${leakNotes.join(' ')}`);
  await page.evaluate(() => {
    window.__launch?.play();
  });
  await sleep(1500);
  check('rocket checks left the console clean', !logs.length, logs.join(' | '));
  await context.close();
}

// texture: none in text mode, nebula and vignette in stars mode, ?texture=none turns it off
async function textureChecks(gpu) {
  for (const mode of ['nebula', 'none']) {
    const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug${mode === 'none' ? '&texture=none' : ''}`, { width: 1440, height: 900, dsf: 2 });
    await sceneReady(page);
    await sleep(900);
    const read = () =>
      page.evaluate(() => ({
        grain: !!document.querySelector('.grain'),
        vignette: document.querySelector('.vignette') ? Number(getComputedStyle(document.querySelector('.vignette')).opacity) : null,
        nebula: window.__starfield.state().nebula,
        has: window.__starfield.state().hasNebula,
      }));
    const text = await read();
    check(`texture ${mode}: no grain anywhere`, !text.grain);
    check(`texture ${mode}: text mode has no nebula and no vignette`, text.nebula === 0 && (text.vignette === null || text.vignette === 0), JSON.stringify(text));
    await page.click('.mode-toggle');
    await sleep(1300);
    const stars = await read();
    if (mode === 'nebula') check('stars mode shows the nebula and the vignette', stars.has && stars.nebula > 0.99 && stars.vignette > 0.99, JSON.stringify(stars));
    else check('texture=none: no nebula and no vignette element in stars mode either', !stars.has && stars.vignette === null, JSON.stringify(stars));
    await page.screenshot({ path: `${OUT}/texture-${mode}.png` });
    check(`texture ${mode}: console clean`, !logs.length, logs.join(' | '));
    await context.close();
  }
}

// pinning a language moves the interface accent everywhere, hover previews never do
async function accentChecks(gpu) {
  for (const reduced of [false, true]) {
    const tag = reduced ? 'reduced motion: ' : '';
    const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, reduced });
    await sceneReady(page);
    const read = () =>
      page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          accent: cs.getPropertyValue('--accent').trim(),
          rgb: cs.getPropertyValue('--accent-rgb').trim(),
          icon: document.querySelector('link[rel="icon"]').getAttribute('href'),
          rocket: getComputedStyle(document.querySelector('.rocket')).color,
          star: getComputedStyle(document.querySelector('.mode-toggle .i-star')).color,
        };
      });
    const base = await read();
    const dots = page.locator('.legend-dot:not(.legend-all)');
    const color = await dots.nth(1).evaluate((b) => b.style.getPropertyValue('--c'));
    await dots.nth(1).hover();
    await sleep(450);
    const hovered = await read();
    check(`${tag}hover previews leave the accent alone`, hovered.accent === base.accent && base.accent === '#4ade80');
    await dots.nth(1).click();
    await sleep(reduced ? 40 : 120);
    const mid = await read();
    await sleep(reduced ? 40 : 450);
    const pinned = await read();
    const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    check(`${tag}pinning sets --accent and --accent-rgb to the language color`, pinned.accent === color && pinned.rgb === color.slice(1).match(/../g).map((x) => parseInt(x, 16)).join(' '), JSON.stringify(pinned));
    // the toggle's star takes the accent in its pressed state
    await page.click('.mode-toggle');
    await sleep(reduced ? 60 : 700);
    const pressedStar = await page.evaluate(() => getComputedStyle(document.querySelector('.mode-toggle .i-star')).color);
    await page.click('.mode-toggle');
    await sleep(reduced ? 60 : 700);
    check(`${tag}the rocket and the pressed toggle follow the accent`, hex(pinned.rocket) === color && hex(pressedStar) === color, `${pinned.rocket} ${pressedStar}`);
    check(`${tag}the favicon is rebuilt in the pinned color`, pinned.icon.startsWith('data:image/svg+xml') && decodeURIComponent(pinned.icon).includes(color));
    if (reduced) check('reduced motion: the accent switches instantly', mid.accent === color);
    else check('the accent animates (a mid point differs from both ends)', mid.accent !== base.accent && mid.accent !== color, `${base.accent} -> ${mid.accent} -> ${color}`);
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineColor);
    check(`${tag}focus outlines use the accent`, hex(ring) === color, ring);
    await page.keyboard.press('Escape');
    await sleep(reduced ? 40 : 500);
    const back = await read();
    check(`${tag}unpinning returns to the default green and the default favicon`, back.accent === '#4ade80' && back.icon === './favicon.svg', JSON.stringify(back));
    // the gray "other" bucket gets no special case
    const last = dots.last();
    const otherColor = await last.evaluate((b) => b.style.getPropertyValue('--c'));
    await last.click();
    await sleep(reduced ? 40 : 500);
    check(`${tag}the "other" bucket pins its own color like any language`, (await read()).accent === otherColor, otherColor);
    await last.click();
    check(`${tag}accent checks left the console clean`, !logs.length, logs.join(' | '));
    await context.close();
  }
}

// now playing satellite: mock states, failure states, reduced motion, narrow screens
async function satelliteChecks(gpu) {
  for (const [q, eyebrow, cls] of [['mock', 'now playing', 'is-playing'], ['mock-recent', 'last played', 'is-recent']]) {
    const { page, context, logs, requests } = await open(gpu, `${ORIGIN}/?spotify=${q}`, { width: 1440, height: 900, dsf: 2 });
    await page.waitForSelector('.orbit:not([hidden])', { timeout: 8000 }).catch(() => {});
    await sleep(600);
    const v = await page.evaluate(() => {
      const a = document.querySelector('.satellite');
      return a && {
        href: a.href,
        target: a.target,
        rel: a.rel,
        label: a.getAttribute('aria-label'),
        cls: document.querySelector('.orbit').className,
        eyebrow: document.querySelector('.sat-eyebrow').textContent,
        radius: getComputedStyle(document.querySelector('.sat-art')).borderRadius,
        icon: document.querySelector('.sat-icon').getBoundingClientRect().height,
        logo: document.querySelector('.sat-logo').getBoundingClientRect().width,
      };
    });
    check(`satellite ${q}: renders as a link to spotify with an accessible name`, v && v.href.startsWith('https://open.spotify.com/') && v.target === '_blank' && v.rel.includes('noopener') && v.label.startsWith(`${eyebrow}:`) && v.label.endsWith('opens on spotify') && v.cls.includes(cls), JSON.stringify(v));
    check(`satellite ${q}: artwork is a 4px rounded square with the spotify icon beside it`, v && v.radius === '4px' && v.icon >= 21, JSON.stringify(v));
    const pos = () => page.evaluate(() => document.querySelector('.satellite').style.transform);
    const p1 = await pos();
    await sleep(700);
    const p2 = await pos();
    check(`satellite ${q}: orbits`, p1 !== p2);
    const box = await page.locator('.sat-art').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(600);
    const h1 = await pos();
    await sleep(600);
    const h2 = await pos();
    const chip = await page.evaluate(() => ({ open: document.querySelector('.orbit').classList.contains('is-open'), visible: getComputedStyle(document.querySelector('.sat-label')).visibility, eyebrow: document.querySelector('.sat-eyebrow').textContent }));
    check(`satellite ${q}: hover pauses the orbit and opens the label with the full spotify logo`, h1 === h2 && chip.open && chip.visible === 'visible' && chip.eyebrow === eyebrow && v.logo >= 70);
    if (q === 'mock') await page.screenshot({ path: `${OUT}/satellite-hover.png` });
    await page.mouse.move(40, 40);
    await page.click('.mode-toggle');
    await sleep(900);
    const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('main')).visibility === 'hidden' && document.querySelector('main').contains(document.querySelector('.orbit')));
    check(`satellite ${q}: hidden with the page in stars mode`, hidden);
    const external = requests.filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:'));
    check(`satellite ${q}: no external requests and a clean console`, !external.length && !logs.length, `${external.join(', ')} ${logs.join(' | ')}`);
    await context.close();
  }

  // reduced motion: the satellite holds still
  {
    const { page, context } = await open(gpu, `${ORIGIN}/?spotify=mock`, { width: 1440, height: 900, reduced: true });
    await page.waitForSelector('.orbit:not([hidden])', { timeout: 8000 }).catch(() => {});
    const a = await page.evaluate(() => document.querySelector('.satellite')?.style.transform);
    await sleep(1200);
    const b = await page.evaluate(() => document.querySelector('.satellite')?.style.transform);
    check('reduced motion: the satellite sits still on its orbit', !!a && a === b);
    await context.close();
  }

  // a live endpoint, faked: valid payload renders, every failure renders nothing and throws nothing
  const ENDPOINT = `${ORIGIN}/fake-now-playing`;
  const cases = {
    'valid playing payload': { status: 200, body: JSON.stringify({ state: 'playing', track: { name: 'Real Song', artists: ['Real Artist'], album: 'X', image: `${ORIGIN}/favicon.svg`.replace('http:', 'https:'), url: 'https://open.spotify.com/track/1', durationMs: 1, progressMs: 0 } }), expect: true },
    'idle payload': { status: 200, body: JSON.stringify({ state: 'idle' }), expect: false },
    'http 500': { status: 500, body: 'oops', expect: false },
    'network error': { abort: true, expect: false },
    'invalid json': { status: 200, body: '{nope', expect: false },
    'wrong shape': { status: 200, body: JSON.stringify({ state: 'playing', track: { name: 'x' } }), expect: false },
  };
  for (const [name, c] of Object.entries(cases)) {
    const ctx = await gpu.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const NOW_PLAYING_URL = '${ENDPOINT}';` }));
    let calls = 0;
    await ctx.route('**/fake-now-playing', (route) => {
      calls++;
      if (c.abort) return route.abort('connectionrefused');
      return route.fulfill({ status: c.status, contentType: 'application/json', body: c.body });
    });
    // the artwork url in the valid case is https on localhost, serve it from the route too
    await ctx.route('https://localhost:8091/favicon.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }));
    const page = await ctx.newPage();
    const errors = [];
    const network = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      if (/Failed to load resource|ERR_CONNECTION_REFUSED|ERR_FAILED/.test(m.text())) network.push(m.text());
      else errors.push(m.text());
    });
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
    await sleep(1500);
    const shown = await page.evaluate(() => !!document.querySelector('.orbit:not([hidden])'));
    check(`satellite endpoint, ${name}: ${c.expect ? 'renders' : 'renders nothing'}, no script errors`, shown === c.expect && !errors.length && calls === 1, `shown ${shown}, calls ${calls}, errors ${errors.join(' | ')}${network.length ? `, browser network log: ${network.length}` : ''}`);
    if (name === 'valid playing payload') {
      await page.click('.mode-toggle').catch(() => {});
      await sleep(700);
      const during = calls;
      await page.click('.mode-toggle').catch(() => {});
      await sleep(700);
      check('satellite refetches when returning from stars mode, one request at a time', calls === during + 1, `${during} -> ${calls}`);
    }
    await ctx.close();
  }

  // narrow screens never load or poll it
  {
    const ctx = await gpu.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `export const NOW_PLAYING_URL = '${ENDPOINT}';` }));
    const page = await ctx.newPage();
    const urls = [];
    page.on('request', (r) => urls.push(r.url()));
    await page.goto(`${ORIGIN}/?spotify=mock`, { waitUntil: 'networkidle' });
    await sleep(800);
    check('mobile: no satellite, no config, no polling', !urls.some((u) => /satellite|config\.js|fake-now/.test(u)) && !(await page.locator('.orbit').count()));
    await ctx.close();
  }
}

// records a value every animation frame while an action runs, for continuity checks
function record(page, ms) {
  return page.evaluate(
    (dur) =>
      new Promise((res) => {
        const out = [];
        const t0 = performance.now();
        const f = () => {
          const s = window.__starfield.state();
          out.push({ t: performance.now() - t0, nebula: s.nebula, cam: s.camera, focal: s.focal, intensity: s.intensity });
          if (performance.now() - t0 < dur) requestAnimationFrame(f);
          else res(out);
        };
        requestAnimationFrame(f);
      }),
    ms
  );
}

// largest per second rate of change between consecutive frames
function maxRate(frames, pick) {
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    const dt = Math.max(frames[i].t - frames[i - 1].t, 8) / 1000;
    worst = Math.max(worst, pick(frames[i], frames[i - 1]) / dt);
  }
  return worst;
}

const camStep = (a, b) => Math.hypot(a.cam.x - b.cam.x, a.cam.y - b.cam.y, a.cam.z - b.cam.z);

// item 1: inner layers move with the card, never on their own
async function cardLayerChecks(gpu) {
  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 1 });
  await sceneReady(page);
  await page.click('.mode-toggle');
  await sleep(900);
  await page.click('.browse');
  await sleep(1600);
  const offsets = async () =>
    page.evaluate(() => {
      const body = document.querySelector('.card-body');
      return {
        depth: document.querySelectorAll('.card [data-depth]').length,
        translate: [...document.querySelectorAll('.card-layer')].map((l) => l.style.translate || getComputedStyle(l).translate).filter((t) => t && t !== 'none').length,
        tilt: body.style.transform,
      };
    });
  const box = await page.locator('.card').boundingBox();
  await page.mouse.move(box.x - 200, box.y - 150);
  await sleep(600);
  const a = await offsets();
  await page.mouse.move(box.x + box.width + 200, box.y + box.height + 150);
  await sleep(600);
  const b = await offsets();
  check('card layers carry no depth attributes or translate of their own', a.depth === 0 && a.translate === 0 && b.translate === 0, JSON.stringify({ a, b }));
  check('the card as a whole still tilts toward the pointer', a.tilt.includes('rotate') && a.tilt !== b.tilt);
  check('card layer checks left the console clean', !logs.length, logs.join(' | '));
  await context.close();
}

const IGNORED = 'a, button, input, select, textarea, label, summary, [role="button"], [role="dialog"], p, h1, h2, h3, h4, li, dt, dd, blockquote, figcaption, pre, code';

// wait until the page look has stopped easing, so a captured context is its resting state
async function settled(page) {
  for (let k = 0; k < 40; k++) {
    const a = await state(page);
    await sleep(300);
    const b = await state(page);
    if (Math.abs(a.focal - b.focal) < 0.0005 && Math.abs(a.intensity - b.intensity) < 0.0005) return;
  }
}

// fire a streak and wait until its head sits somewhere clickable
async function catchableStreak(page, tries = 6) {
  for (let k = 0; k < tries; k++) {
    let fired = false;
    for (let w = 0; w < 24 && !fired; w++) {
      fired = await page.evaluate(() => window.__starfield.fireStreak());
      if (!fired) await sleep(250);
    }
    if (!fired) return null;
    for (let w = 0; w < 30; w++) {
      await sleep(100);
      const s = await page.evaluate((ignored) => {
        const d = window.__starfield.streak();
        if (!d) return null;
        const under = document.elementFromPoint(d.screen.x, d.screen.y);
        const ok = d.p > 0.08 && d.p < 0.6 && d.screen.y > 110 && d.screen.x > 60 && d.screen.x < innerWidth - 60 && under && !under.closest(ignored);
        return ok ? d : null;
      }, IGNORED);
      if (s) return s;
    }
    await page.waitForFunction(() => !window.__starfield.streak(), null, { timeout: 8000 }).catch(() => {});
  }
  return null;
}

async function streakSpeed(page) {
  const pts = [];
  for (let k = 0; k < 5; k++) {
    pts.push(await page.evaluate(() => ({ ...window.__starfield.streak()?.screen, t: performance.now() })));
    await sleep(110);
  }
  const v = pts.slice(1).map((q, k) => Math.hypot(q.x - pts[k].x, q.y - pts[k].y) / ((q.t - pts[k].t) / 1000)).sort((a, b) => a - b);
  return v[2];
}

const near = (a, b, eps) => Math.abs(a - b) <= eps;

// item 2: pull request data, gold streaks in the scene, the pr card, and exact returns
async function prChecks(gpu) {
  const file = JSON.parse(await readFile(path.join(ROOT, 'data', 'prs.json'), 'utf8'));
  const urls = new Set(file.prs.map((p) => p.url));
  check('prs.json is real data: merged and open kept, closed without merging dropped', !file.mock && file.prs.length > 0 && file.prs.every((p) => (p.merged ? !!p.mergedAt : p.mergedAt === null)) && !urls.has('https://github.com/pytorch/pytorch/pull/184773'), `${file.prs.length} prs`);
  const logos = await Promise.all(file.prs.filter((p) => p.logo).map((p) => readFile(path.join(ROOT, p.logo)).then(() => true).catch(() => false)));
  check('every referenced org logo is a local file', logos.every(Boolean), `${logos.length} logos`);

  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 2 });
  await sceneReady(page);
  await sleep(1000);
  check('streaks are scene objects, there is no dom streak', !(await page.locator('.shoot').count()));

  // every pull request comes up once before any repeats
  const seen = [];
  for (let k = 0; k < file.prs.length; k++) {
    await page.waitForFunction(() => !window.__starfield.streak(), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => window.__starfield.fireStreak());
    seen.push((await page.evaluate(() => window.__starfield.streak()))?.url);
  }
  check('the shuffle bag shows every pull request before repeating', new Set(seen).size === file.prs.length && seen.every((u) => urls.has(u)), seen.join(' '));
  await page.waitForFunction(() => !window.__starfield.streak(), null, { timeout: 8000 }).catch(() => {});

  // hover slows it to about a quarter
  let s = await catchableStreak(page);
  check('a catchable gold streak appears', !!s);
  if (!s) {
    await context.close();
    return;
  }
  const free = await streakSpeed(page);
  s = await page.evaluate(() => window.__starfield.streak());
  await page.mouse.move(s.screen.x, s.screen.y);
  await sleep(450);
  const hot = await page.evaluate(() => document.documentElement.classList.contains('is-catching'));
  const caught = await streakSpeed(page);
  check('hovering a streak catches it at about quarter speed', hot && caught < free * 0.4 && caught > free * 0.1, `free ${free.toFixed(0)}px/s, caught ${caught.toFixed(0)}px/s`);

  // text mode context at scrollY 1200, closed with escape
  await page.mouse.move(5, 890);
  await page.waitForFunction(() => !window.__starfield.streak(), null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 1200));
  await settled(page);
  const before = await state(page);
  s = await catchableStreak(page);
  await page.mouse.click(s.screen.x, s.screen.y);
  await sleep(260);
  const paused = await page.evaluate(() => window.__starfield.streak());
  await sleep(400);
  const held = await page.evaluate(() => window.__starfield.streak());
  check('clicking a streak eases it to a stop and it holds still in world space', paused.timeScale < 0.01 && paused.focused && near(paused.head.x, held.head.x, 1e-6) && near(paused.head.y, held.head.y, 1e-6), `timeScale ${paused.timeScale}`);
  await page.screenshot({ path: `${OUT}/pr-paused.png` });
  await sleep(1300);
  let st = await state(page);
  const pr = file.prs.find((p) => p.url === held.url);
  check('the camera flies to the paused head and ends close enough for a gold sphere', near(st.cam.x, held.head.x, 0.02) && near(st.cam.y, held.head.y, 0.02) && near(st.cam.z, held.head.z + 2.6, 0.02) && near(st.focal, 2.6, 0.01), JSON.stringify(st.cam));
  const cardInfo = await page.evaluate(() => {
    const c = document.querySelector('.card');
    const vis = (sel) => { const el = c.querySelector(sel); return !!el && !el.closest('[hidden]') && !el.hidden; };
    const after = getComputedStyle(c.querySelector('.card-body'), '::after');
    return {
      open: !c.hidden,
      pr: c.classList.contains('is-pr'),
      shimmer: c.classList.contains('is-shimmering') && after.animationName === 'gold-sweep',
      border: after.backgroundImage.includes('linear-gradient'),
      repo: c.querySelector('[data-f="repo"]').textContent,
      title: c.querySelector('.card-msg').textContent,
      chip: vis('.merged-chip'),
      date: c.querySelector('[data-f="date"]').textContent,
      link: c.querySelector('[data-f="link"]').href,
      target: c.querySelector('[data-f="link"]').target,
      rel: c.querySelector('[data-f="link"]').rel,
      linkText: c.querySelector('[data-f="link"]').textContent.trim(),
      hash: vis('.hash-chip'),
      steps: vis('.card-step'),
      lang: vis('.lang-chip'),
      logo: c.classList.contains('has-logo'),
      labelled: document.getElementById(c.getAttribute('aria-labelledby'))?.textContent,
      live: document.querySelector('[aria-live]').textContent,
      peek: document.documentElement.classList.contains('is-peek'),
      label: document.querySelector('.mode-label').textContent,
      y: window.scrollY,
    };
  });
  check('the pr card opens with the gold edge and one shimmer sweep', cardInfo.open && cardInfo.pr && cardInfo.shimmer && cardInfo.border, JSON.stringify({ pr: cardInfo.pr, shimmer: cardInfo.shimmer }));
  check('pr card content: owner/repo, title with number, link out', cardInfo.repo === `${pr.owner}/${pr.repo}` && cardInfo.title === `${pr.title} #${pr.number}` && cardInfo.link === pr.url && cardInfo.target === '_blank' && cardInfo.rel.includes('noopener') && cardInfo.linkText === 'view pull request on github', JSON.stringify(cardInfo));
  check(`merged chip ${pr.merged ? 'shown with the merged date' : 'absent, opened date instead'}`, pr.merged ? cardInfo.chip && !cardInfo.date.startsWith('opened') : !cardInfo.chip && cardInfo.date.startsWith('opened'), cardInfo.date);
  check('pr card hides the hash chip, counters, prev, next and the language dot', !cardInfo.hash && !cardInfo.steps && !cardInfo.lang);
  check('pr card shows the org logo when one exists', pr.logo ? cardInfo.logo : !cardInfo.logo);
  check('pr card is labelled by its title and announced', cardInfo.labelled === cardInfo.title && cardInfo.live.includes(`${pr.owner}/${pr.repo}`) && cardInfo.live.includes(pr.title) && (pr.merged ? cardInfo.live.includes('merged') : cardInfo.live.includes('open since')));
  check('from the page it is a peek: page hidden, scroll kept, toggle reads back to page', cardInfo.peek && cardInfo.y === 1200 && cardInfo.label === 'back to page');
  await page.mouse.move(1000, 300);
  await sleep(500);
  await page.screenshot({ path: `${OUT}/pr-card-${pr.merged ? 'merged' : 'open'}.png` });
  await page.keyboard.press('Escape');
  await sleep(1700);
  st = await state(page);
  const back = await page.evaluate(() => ({
    y: window.scrollY,
    peek: document.documentElement.classList.contains('is-peek'),
    opacity: getComputedStyle(document.querySelector('main')).opacity,
    inert: document.querySelector('main').inert,
    label: document.querySelector('.mode-label').textContent,
  }));
  check('escape returns to the text context: same scroll, page back, nothing inert', back.y === 1200 && !back.peek && back.opacity === '1' && !back.inert && back.label === 'stars only', JSON.stringify(back));
  check('text context look restored: camera, focal, intensity, nebula', near(st.cam.x, before.cam.x, 0.01) && near(st.cam.y, before.cam.y, 0.01) && near(st.cam.z, before.cam.z, 0.01) && near(st.focal, before.focal, 0.005) && near(st.intensity, before.intensity, 0.005) && st.nebula === 0 && st.mode === 'content', JSON.stringify({ before: [before.focal, before.intensity, before.nebula], after: [st.focal, st.intensity, st.nebula] }));
  const resumed = await page.evaluate(() => window.__starfield.streak());
  const onLine = (h) => {
    const ax = held.head.x - paused.head.x;
    const ay = held.head.y - paused.head.y;
    return h && near(h.head.z, paused.head.z, 1e-6);
  };
  const line = await page.evaluate(() => {
    const d = window.__starfield.streak();
    return d;
  });
  check('the streak resumes its own trajectory from where it paused', !!resumed && resumed.url === held.url && resumed.p > held.p && resumed.timeScale > 0.9 && !resumed.focused && onLine(line), resumed ? `p ${held.p.toFixed(3)} -> ${resumed.p.toFixed(3)}, timeScale ${resumed.timeScale.toFixed(2)}` : 'streak gone');

  // stars mode, mid travel, closed by clicking empty space
  await page.waitForFunction(() => !window.__starfield.streak(), null, { timeout: 8000 }).catch(() => {});
  await page.click('.mode-toggle');
  await sleep(900);
  await page.mouse.move(720, 450);
  await wheelAt(page, 160, 5, 40);
  await sleep(1800);
  const mid = await state(page);
  s = await catchableStreak(page);
  await page.mouse.click(s.screen.x, s.screen.y);
  await sleep(1700);
  const midLabel = await page.locator('.mode-label').textContent();
  const empty = await emptySpot(page);
  await page.mouse.click(empty.x, empty.y);
  await sleep(1700);
  st = await state(page);
  check('stars mode mid travel: the toggle reads back to stars while the card is open', midLabel === 'back to stars', midLabel);
  check('stars mode mid travel: closing returns camera, travel and look exactly', near(st.cam.z, mid.cam.z, 0.01) && near(st.cam.x, mid.cam.x, 0.01) && st.travelTarget === mid.travelTarget && near(st.focal, mid.focal, 0.01) && near(st.intensity, 1, 0.01) && near(st.nebula, 1, 0.01) && st.mode === 'stars', JSON.stringify({ was: mid.cam, now: st.cam }));

  // stars mode at home, closed with the toggle
  await page.keyboard.press('Home');
  await sleep(2200);
  const home = await state(page);
  await page.waitForFunction(() => !window.__starfield.streak(), null, { timeout: 8000 }).catch(() => {});
  s = await catchableStreak(page);
  await page.mouse.click(s.screen.x, s.screen.y);
  await sleep(1700);
  await page.click('.mode-toggle');
  await sleep(1700);
  st = await state(page);
  const label = await page.locator('.mode-label').textContent();
  check('stars mode at home: the toggle closes the card back to the same spot', near(st.cam.z, home.cam.z, 0.01) && near(st.cam.x, home.cam.x, 0.01) && st.mode === 'stars' && label === 'back to page' && near(st.nebula, 1, 0.01), JSON.stringify({ was: home.cam, now: st.cam, label }));

  // text mode again, closed with the toggle and with the close button
  await page.click('.mode-toggle');
  await sleep(1200);
  for (const how of ['toggle', 'close button']) {
    await page.evaluate(() => window.scrollTo(0, 600));
    await settled(page);
    const ref = await state(page);
    await page.waitForFunction(() => !window.__starfield.streak(), null, { timeout: 8000 }).catch(() => {});
    s = await catchableStreak(page);
    await page.mouse.click(s.screen.x, s.screen.y);
    await sleep(1700);
    if (how === 'toggle') await page.click('.mode-toggle');
    else await page.click('.card-close');
    await sleep(1700);
    st = await state(page);
    const y = await page.evaluate(() => window.scrollY);
    check(`text mode, ${how}: back at the same scroll with the same look`, y === 600 && near(st.cam.z, ref.cam.z, 0.01) && near(st.intensity, ref.intensity, 0.01) && near(st.focal, ref.focal, 0.01) && st.nebula === 0, `y ${y}, focal ${ref.focal.toFixed(3)} -> ${st.focal.toFixed(3)}`);
  }
  check('pr checks left the console clean', !logs.length, logs.join(' | '));
  await context.close();

  // missing file, mock file, built in mock
  for (const [name, setup, expect] of [
    ['missing prs.json means no streaks', (ctx) => ctx.route('**/data/prs.json', (r) => r.fulfill({ status: 404, body: '' })), 'none'],
    ['a mock prs.json file drives the streaks', async (ctx) => ctx.route('**/data/prs.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ generated: '2026-10-01T00:00:00Z', user: 'santihdzs', mock: true, prs: [{ owner: 'google', repo: 'flax', number: 1, title: 'mock', url: 'https://github.com/google/flax/pull/1', merged: true, createdAt: '2026-09-01T00:00:00Z', mergedAt: '2026-09-02T00:00:00Z', additions: 1, deletions: 1, files: 1, logo: null }] }) })), 'https://github.com/google/flax/pull/1'],
  ]) {
    const ctx = await gpu.newContext({ viewport: { width: 1440, height: 900 } });
    await setup(ctx);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${ORIGIN}/?debug`, { waitUntil: 'networkidle' });
    await sceneReady(p);
    const fired = await p.evaluate(() => window.__starfield.fireStreak());
    const url = (await p.evaluate(() => window.__starfield.streak()))?.url ?? 'none';
    check(name, url === expect && fired === (expect !== 'none') && !errors.length, url);
    await ctx.close();
  }
  {
    const r = await open(gpu, `${ORIGIN}/?debug&prs=mock`, { width: 1440, height: 900 });
    await sceneReady(r.page);
    await r.page.evaluate(() => window.__starfield.fireStreak());
    const url = (await r.page.evaluate(() => window.__starfield.streak()))?.url ?? '';
    check('?prs=mock uses the built in sample without any file', /google\/flax\/pull\/4312|pytorch\/pytorch\/pull\/161204|numpy\/numpy\/pull\/27710|huggingface\/transformers\/pull\/39021/.test(url) && !r.requests.some((u) => u.includes('prs.json')), url);
    await r.context.close();
  }
  {
    const r = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, reduced: true });
    await sceneReady(r.page);
    const fired = await r.page.evaluate(() => window.__starfield.fireStreak());
    check('reduced motion: no streaks', !fired);
    await r.context.close();
  }
}

// item 3: leaving with a card open is one continuous camera motion
async function exitSmoothChecks(gpu) {
  for (const how of ['toggle', 'escape']) {
    const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 1 });
    await sceneReady(page);
    await page.click('.mode-toggle');
    await sleep(900);
    await page.mouse.move(720, 450);
    await wheelAt(page, 160, 6, 40);
    await sleep(1800);
    await page.click('.browse');
    await sleep(1500);
    for (let k = 0; k < 3; k++) {
      await page.keyboard.press('ArrowLeft');
      await sleep(1300);
    }
    const start = await state(page);
    const rec = record(page, 1700);
    await sleep(60);
    if (how === 'toggle') await page.click('.mode-toggle');
    else await page.keyboard.press('Escape');
    const frames = await rec;
    const first = frames[0].cam;
    const lastCam = frames[frames.length - 1].cam;
    const span = Math.hypot(first.x - lastCam.x, first.y - lastCam.y, first.z - lastCam.z);
    let step = 0;
    for (let i = 1; i < frames.length; i++) step = Math.max(step, camStep(frames[i], frames[i - 1]));
    const end = await state(page);
    const target = how === 'toggle' ? { x: 0, y: 0, z: 0 } : start.saved;
    const arrived = near(end.cam.x, target.x, 0.02) && near(end.cam.y, target.y, 0.02) && near(end.cam.z, target.z, 0.02);
    // a snap would cover most of the path in one frame; an eased 1.1s move covers a few percent
    check(`${how} with a card open: no camera jump, one continuous move to ${how === 'toggle' ? 'home' : 'where it was'}`, step / span < 0.12 && arrived, `path ${span.toFixed(2)}, largest frame step ${step.toFixed(3)} (${((step / span) * 100).toFixed(1)}% of the path), ${frames.length} frames`);
    if (how === 'toggle') {
      let nebStep = 0;
      for (let i = 1; i < frames.length; i++) nebStep = Math.max(nebStep, Math.abs(frames[i].nebula - frames[i - 1].nebula));
      check('toggle exit: focal, intensity and nebula ease together to the page look', nebStep < 0.12 && near(end.nebula, 0, 0.001) && near(end.intensity, 0.5, 0.01), `largest nebula step ${nebStep.toFixed(3)}`);
    }
    check(`${how} exit: console clean`, !logs.length, logs.join(' | '));
    await context.close();
  }
}

// item 4: the nebula blend never pops, whichever way stars mode is entered or left
async function blendChecks(gpu) {
  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 1 });
  await sceneReady(page);
  await sleep(800);
  const results = [];
  async function path(name, action, expectEnd, ms = 1500) {
    const rec = record(page, ms);
    await sleep(40);
    await action();
    const frames = await rec;
    // change per 16.7ms of frame time, so one long frame reads as what it is and a pop still stands out
    let step = 0;
    let longest = 0;
    for (let i = 1; i < frames.length; i++) {
      const dt = frames[i].t - frames[i - 1].t;
      longest = Math.max(longest, dt);
      step = Math.max(step, (Math.abs(frames[i].nebula - frames[i - 1].nebula) * 16.7) / Math.max(dt, 16.7));
    }
    const endValue = frames[frames.length - 1].nebula;
    results.push(`${name}: largest frame step ${step.toFixed(3)}, end ${endValue.toFixed(2)}`);
    // a pop moves the whole 0 to 1 range in one frame; an eased 0.8s fade moves a few percent
    check(`nebula blend is continuous: ${name}`, step < 0.12 && near(endValue, expectEnd, 0.02), `largest step per 16.7ms ${step.toFixed(3)} of the 0 to 1 range, longest frame ${longest.toFixed(0)}ms, end ${endValue.toFixed(3)}`);
  }
  await path('toggle in', () => page.click('.mode-toggle'), 1);
  await path('escape out', () => page.keyboard.press('Escape'), 0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(900);
  await path('rocket in', () => page.click('.rocket'), 1, 2600);
  await page.mouse.move(720, 450);
  await path('card open and close keeps it', async () => {
    await page.click('.browse');
    await sleep(1400);
    await page.keyboard.press('Escape');
  }, 1, 2900);
  await path('toggle out', () => page.click('.mode-toggle'), 0);
  // overscroll: travel back, return, then a committed fresh gesture with its rubber band
  await page.click('.mode-toggle');
  await sleep(1000);
  await page.mouse.move(720, 450);
  await wheelAt(page, 160, 6, 30);
  await sleep(800);
  await wheelAt(page, -160, 8, 30);
  await sleep(1500);
  await path('overscroll exit with rubber band', async () => {
    await page.mouse.wheel(0, -90);
    await sleep(120);
    await page.mouse.wheel(0, -90);
    await sleep(120);
    await wheelAt(page, -100, 2, 60);
  }, 0, 1800);
  // pull request peek in and out
  await sleep(500);
  const s = await catchableStreak(page);
  if (s) {
    await path('pr peek in', () => page.mouse.click(s.screen.x, s.screen.y), 1, 1800);
    await path('pr peek out', () => page.keyboard.press('Escape'), 0, 1800);
  } else check('nebula blend: pr peek path (no catchable streak)', false);
  check('blend checks left the console clean', !logs.length, logs.join(' | '));
  await context.close();
}

// nebula colors follow the accent as it animates, through the same 350ms tween
async function nebulaColorChecks(gpu) {
  const { page, context, logs } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900 });
  await sceneReady(page);
  await page.click('.mode-toggle');
  await sleep(1000);
  const colors = () => page.evaluate(() => window.__starfield.nebulaColors().a.map((v) => +v.toFixed(4)).join(','));
  const base = await colors();
  const dot = page.locator('.legend-dot:not(.legend-all)').first();
  await dot.click();
  await sleep(110);
  const mid = await colors();
  await sleep(500);
  const pinned = await colors();
  await dot.click();
  await sleep(500);
  const back = await colors();
  check('nebula color animates with the pinned accent and returns on unpin', mid !== base && mid !== pinned && pinned !== base && back === base, `${base} -> ${mid} -> ${pinned} -> ${back}`);
  check('nebula color checks left the console clean', !logs.length, logs.join(' | '));
  await context.close();
}

// text over the nebula in stars mode, measured from real pixels with the text hidden
async function starsContrastChecks(gpu) {
  const { page, context } = await open(gpu, `${ORIGIN}/?debug`, { width: 1440, height: 900, dsf: 1 });
  await sceneReady(page);
  await page.click('.mode-toggle');
  await sleep(1300);
  const lum = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = (rgb) => 0.2126 * lum(rgb[0]) + 0.7152 * lum(rgb[1]) + 0.0722 * lum(rgb[2]);
  const measure = async (name, selector) => {
    const boxes = await page.evaluate((sel) => {
      return [...document.querySelectorAll(sel)]
        .filter((el) => el.textContent.trim() && el.getClientRects().length)
        .map((el) => {
          const r = el.getBoundingClientRect();
          let alpha = 1;
          for (let n = el; n && n.nodeType === 1; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
          const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g).map(Number);
          return { x: r.x, y: r.y, w: r.width, h: r.height, color: m.slice(0, 3), a: (m[3] ?? 1) * alpha, text: el.textContent.trim().slice(0, 24) };
        })
        .filter((b) => b.w > 0 && b.h > 0);
    }, selector);
    await page.addStyleTag({ content: '*{color:transparent!important;transition:none!important} svg, .lang-dot, .org, .diff-bar{visibility:hidden!important}' });
    await sleep(120);
    const png = await page.screenshot();
    await page.evaluate(() => document.querySelector('style:last-of-type').remove());
    const probe = await gpu.newPage();
    const bgs = await probe.evaluate(
      async ({ src, boxes }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return boxes.map((b) => {
          const d = g.getImageData(Math.max(0, b.x), Math.max(0, b.y), Math.max(1, b.w), Math.max(1, b.h)).data;
          const v = [];
          for (let i = 0; i < d.length; i += 4) v.push([d[i], d[i + 1], d[i + 2]]);
          v.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
          return v[Math.floor(v.length * 0.95)];
        });
      },
      { src: `data:image/png;base64,${png.toString('base64')}`, boxes }
    );
    await probe.close();
    let worst = { ratio: 99 };
    boxes.forEach((b, i) => {
      const bg = bgs[i];
      const fg = b.color.map((c, k) => c * b.a + bg[k] * (1 - b.a));
      const ratio = (Math.max(L(fg), L(bg)) + 0.05) / (Math.min(L(fg), L(bg)) + 0.05);
      if (ratio < worst.ratio) worst = { ratio, text: b.text, bg };
    });
    check(`stars mode contrast, ${name}`, worst.ratio >= 4.5, `worst ${worst.ratio.toFixed(2)}:1 "${worst.text}" over rgb(${worst.bg})`);
  };
  await measure('hint, readout, browse and toggle', '.hint, .readout, .browse, .mode-label');
  await page.locator('.legend-dot:not(.legend-all)').nth(1).hover();
  await sleep(500);
  await measure('legend label', '.legend-label b, .legend-label');
  await page.mouse.move(700, 880);
  await page.click('.browse');
  await sleep(1600);
  await measure('commit card text', '.card .card-repo, .card .lang-chip, .card .card-date, .card-msg, .card .add, .card .del, .card .card-files, .card .hash-chip, .card [data-f="count"], .card [data-f="pos"], .card .card-step:not(:disabled), .card .tlink');
  await page.keyboard.press('Escape');
  await sleep(1400);
  const s = await catchableStreak(page);
  if (s) {
    await page.mouse.click(s.screen.x, s.screen.y);
    await sleep(1700);
    await measure('pr card text', '.card .card-repo, .card .merged-chip, .card .card-date, .card-msg, .card .pr-num, .card .add, .card .del, .card .card-files, .card .tlink');
  }
  await context.close();
}

// the real worker, read only: renders the live track, contacts only the worker and spotify's image host
async function liveChecks(gpu) {
  const ENDPOINT = 'https://now-playing.santihdzs.workers.dev/now-playing';
  for (const origin of [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]) {
    const context = await gpu.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const logs = [];
    const external = [];
    let endpointDone = 0;
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(m.text()));
    page.on('pageerror', (e) => logs.push(e.message));
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!u.protocol.startsWith('http') || u.origin === origin) return;
      external.push({ host: u.host, t: Date.now() });
    });
    page.on('response', (r) => {
      // the first answer is the satellite's own; the check's read below comes later
      if (r.url().startsWith(ENDPOINT) && !endpointDone) endpointDone = Date.now();
    });
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    const body = await page.evaluate((u) => fetch(u, { cache: 'no-store' }).then((r) => r.json()), ENDPOINT).catch(() => null);
    const live = body?.state ?? 'unreachable';
    if (live === 'playing' || live === 'recent') {
      await page.waitForSelector('.orbit:not([hidden])', { timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelector('.sat-art')?.complete && document.querySelector('.sat-art').naturalWidth > 0, null, { timeout: 15000 }).catch(() => {});
      const box = await page.locator('.sat-art').boundingBox();
      if (box) await page.mouse.move(box.x + 16, box.y + 16);
      await sleep(600);
      const v = await page.evaluate(() => ({
        shown: !!document.querySelector('.orbit:not([hidden])'),
        art: document.querySelector('.sat-art')?.src ?? '',
        artLoaded: (document.querySelector('.sat-art')?.naturalWidth ?? 0) > 0,
        label: getComputedStyle(document.querySelector('.sat-label')).visibility,
        track: document.querySelector('.sat-track')?.textContent ?? '',
        logo: document.querySelector('.sat-logo')?.complete && document.querySelector('.sat-logo').naturalWidth > 0,
        icon: document.querySelector('.sat-icon')?.complete && document.querySelector('.sat-icon').naturalWidth > 0,
        href: document.querySelector('.satellite')?.href ?? '',
      }));
      check(`live ${origin}: the real ${live} track renders with its artwork`, v.shown && v.artLoaded && v.art.startsWith('https://i.scdn.co/') && v.track.length > 0, `${v.track.slice(0, 40)}`);
      check(`live ${origin}: hover label, spotify icon and logo, link back to spotify`, v.label === 'visible' && v.logo && v.icon && v.href.startsWith('https://open.spotify.com/'));
      // the open label's text against its own chip, from real pixels with the text hidden
      const parts = await page.evaluate(() =>
        [...document.querySelectorAll('.sat-eyebrow, .sat-track, .sat-artists')].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height, color: getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number), text: el.textContent.slice(0, 20) };
        })
      );
      await page.addStyleTag({ content: '.sat-label *{color:transparent!important;transition:none!important}' });
      await sleep(120);
      const png = await page.screenshot();
      await page.evaluate(() => document.querySelector('style:last-of-type').remove());
      const probe = await gpu.newPage();
      const bgs = await probe.evaluate(
        async ({ src, parts }) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          return parts.map((b) => {
            const d = g.getImageData(b.x, b.y, Math.max(1, b.w), Math.max(1, b.h)).data;
            const v = [];
            for (let i = 0; i < d.length; i += 4) v.push([d[i], d[i + 1], d[i + 2]]);
            v.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
            return v[Math.floor(v.length * 0.95)];
          });
        },
        { src: `data:image/png;base64,${png.toString('base64')}`, parts }
      );
      await probe.close();
      const lin = (c) => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      const Y = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
      const ratios = parts.map((p, i) => (Math.max(Y(p.color), Y(bgs[i])) + 0.05) / (Math.min(Y(p.color), Y(bgs[i])) + 0.05));
      check(`live ${origin}: the open label text keeps aa contrast`, ratios.every((r) => r >= 4.5), ratios.map((r) => r.toFixed(2)).join(', '));
      await page.screenshot({ path: `${OUT}/live-satellite-${new URL(origin).hostname}.png` });
    } else {
      check(`live ${origin}: endpoint reports ${live}, satellite stays hidden`, !(await page.locator('.orbit:not([hidden])').count()));
    }
    const hosts = [...new Set(external.map((e) => e.host))];
    const imageAfter = external.filter((e) => e.host === 'i.scdn.co').every((e) => endpointDone && e.t >= endpointDone - 5);
    check(`live ${origin}: only the worker and i.scdn.co are contacted, the image only after the endpoint answered`, hosts.every((h) => h === 'now-playing.santihdzs.workers.dev' || h === 'i.scdn.co') && imageAfter, hosts.join(', '));
    check(`live ${origin}: console clean, no cors errors`, !logs.length, logs.join(' | '));
    await context.close();
  }

  // unreachable and idle: nothing renders, nothing throws
  for (const [name, handler] of [
    ['offline', (route) => route.abort('internetdisconnected')],
    ['idle', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"state":"idle"}' })],
  ]) {
    const context = await gpu.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route(`${ENDPOINT}*`, handler);
    const page = await context.newPage();
    const errors = [];
    const network = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      (/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) ? network : errors).push(m.text());
    });
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
    await sleep(1500);
    const shown = await page.locator('.orbit:not([hidden])').count();
    check(`live endpoint ${name}: satellite renders nothing, no script errors`, !shown && !errors.length, `${errors.join(' | ')}${network.length ? ` (browser network log: ${network.length})` : ''}`);
    await context.close();
  }
  // a whole offline page after the satellite showed: the next fetch fails quietly
  {
    const context = await gpu.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
    await sleep(1500);
    await context.setOffline(true);
    await page.click('.mode-toggle').catch(() => {});
    await sleep(700);
    await page.click('.mode-toggle').catch(() => {});
    await sleep(1500);
    check('live: going offline mid session raises no script errors', !errors.length, errors.join(' | '));
    await context.close();
  }
}

await mkdir(OUT, { recursive: true });
const server = await startServer(PORT);
const gpu = await chromium.launch(gpuLaunch);
try {
  if (want('static')) await staticChecks();
  if (want('load') || want('mobile')) await loadChecks(gpu);
  if (want('interact')) await interactChecks(gpu);
  if (want('reduced')) await reducedChecks(gpu);
  if (want('robust')) await robustChecks(gpu);
  if (want('perf')) await perfChecks(gpu);
  if (want('contrast')) await contrastChecks(gpu);
  if (want('align')) await alignChecks();
  if (want('pick')) await pickChecks(gpu);
  if (want('overscroll')) await overscrollChecks(gpu);
  if (want('chain')) await chainChecks(gpu);
  if (want('cardlayout')) await cardLayoutChecks(gpu);
  if (want('rocket')) await rocketChecks(gpu);
  if (want('texture')) await textureChecks(gpu);
  if (want('accent')) await accentChecks(gpu);
  if (want('satellite')) await satelliteChecks(gpu);
  if (want('cards')) await cardLayerChecks(gpu);
  if (want('prs')) await prChecks(gpu);
  if (want('exits')) await exitSmoothChecks(gpu);
  if (want('blend')) await blendChecks(gpu);
  if (want('nebcolor')) await nebulaColorChecks(gpu);
  if (want('starscontrast')) await starsContrastChecks(gpu);
  if (want('live')) await liveChecks(gpu);
} finally {
  await gpu.close();
  server.close();
}
const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} passed`);
process.exit(failedCount ? 1 : 0);
