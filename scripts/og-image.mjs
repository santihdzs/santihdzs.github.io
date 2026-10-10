// one shot: renders the social preview image, assets/og.png, from the real hero over the real starfield.
// not part of ci or the daily workflow; rerun by hand after the hero changes. needs `cd tools && npm install`.
// usage: node scripts/og-image.mjs [out]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tools/serve.mjs';

const { chromium } = createRequire(new URL('../tools/package.json', import.meta.url))('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'assets', 'og.png'));
const PORT = 8093;

// only the kicker and the name over the field, both scaled up so they read at small preview sizes
const STYLE = `
  .topbar, .skip, .orbit, .section, .site-footer { visibility: hidden !important }
  .hero-lede, .hero-links { display: none !important }
  .hero { padding-block: 0 96px !important }
  .hero-inner { max-width: none !important }
  .hero-kicker { font-size: 34px !important; white-space: nowrap }
  .hero-name { margin-top: 28px !important; font-size: 132px !important; white-space: nowrap }
`;

const server = await startServer(PORT);
// the real gpu on macos, like tools/check.mjs; software gl elsewhere
const browser = await chromium.launch(process.platform === 'darwin' ? { channel: 'chromium', args: ['--use-angle=metal'] } : {});
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  // the satellite renders nothing on an idle reply, and the worker is never reached
  await context.route('https://now-playing.santihdzs.workers.dev/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"state":"idle"}' }));
  const page = await context.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.mode-toggle:not([hidden])', { timeout: 15000 });
  await page.addStyleTag({ content: STYLE });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT });
  console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
} finally {
  await browser.close();
  server.close();
}
