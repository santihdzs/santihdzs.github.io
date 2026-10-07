// dev only: lighthouse for the desktop and mobile views, using playwright's chromium.
// usage: node tools/lighthouse.mjs [desktop|mobile]
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import * as chromeLauncher from 'chrome-launcher';
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const PORT = 8092;
const which = process.argv[2];
const runs = [
  { name: 'desktop', config: desktopConfig },
  { name: 'mobile', config: undefined },
].filter((r) => !which || r.name === which);

await mkdir(OUT, { recursive: true });
const server = await startServer(PORT);
let failed = false;
let chrome = null;
try {
  for (const run of runs) {
    // a fresh browser per run, so one page's leftover work never lands in the next trace
    chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ['--headless=new', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
    });
    const result = await lighthouse(
      `http://localhost:${PORT}/`,
      { port: chrome.port, output: 'html', onlyCategories: ['performance', 'accessibility', 'best-practices'] },
      run.config
    );
    const { categories, audits } = result.lhr;
    await writeFile(path.join(OUT, `lighthouse-${run.name}.html`), result.report);
    const scores = Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
    const metrics = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']
      .map((id) => `${id.replace(/-/g, ' ')} ${audits[id].displayValue}`)
      .join(', ');
    console.log(`${run.name}: ${JSON.stringify(scores)}\n  ${metrics}`);
    const weak = Object.values(audits).filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'manual' && a.scoreDisplayMode !== 'notApplicable');
    for (const a of weak) console.log(`  ${a.score === 0 ? 'x' : '~'} ${a.id}: ${a.title}${a.displayValue ? ` (${a.displayValue})` : ''}`);
    const perfTarget = run.name === 'mobile' ? 95 : 90;
    if (scores.performance < perfTarget || scores.accessibility < 100 || scores['best-practices'] < 100) failed = true;
    chrome.kill();
    chrome = null;
  }
} finally {
  chrome?.kill();
  server.close();
}
process.exit(failed ? 1 : 0);
