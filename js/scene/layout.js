import { starRgb } from '../palette.js';

// world layout. the camera looks down -z; newest commits sit a little in front of the
// home focal plane and older ones recede, so z is a tunnel through time.
export const STAR_FOCAL = 8;
const NEAR = STAR_FOCAL - 2.5;
const RX = 12;
const RY = 7.5;
// the tunnel widens a little with age so the far end does not collapse into a ball
const FLARE = 0.25;
const SIZE_MIN = 0.035;
const SIZE_MAX = 0.11;
const CHURN_CAP = Math.log1p(4000);

function hashWords(sha) {
  if (/^[0-9a-f]{32,}$/i.test(sha)) {
    return [0, 8, 16, 24].map((o) => parseInt(sha.slice(o, o + 8), 16) / 0x100000000);
  }
  // non hex ids still need stable positions
  return [0, 1, 2, 3].map((salt) => {
    let h = 0x811c9dc5 ^ salt;
    for (let i = 0; i < sha.length; i++) h = Math.imul(h ^ sha.charCodeAt(i), 0x01000193);
    return (h >>> 0) / 0x100000000;
  });
}

export function buildLayout(data) {
  const { commits, languages } = data;
  const n = commits.length;
  const depth = Math.min(240, Math.max(24, n * 0.16));
  const newest = n ? commits[0].ts : 0;
  const oldest = n ? commits[n - 1].ts : 0;
  const span = Math.max(newest - oldest, 1);
  const jitter = Math.min(1.2, (2.5 * depth) / Math.max(n, 1));

  const positions = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const colors = new Float32Array(n * 3);
  const langs = new Float32Array(n);
  const seeds = new Float32Array(n);
  const baseZ = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const c = commits[i];
    const [h1, h2, h3, h4] = hashWords(c.sha);
    // blend of real age and rank: monotonic in time, without the long empty
    // stretches that bursty commit history would leave in a purely linear mapping
    const age = (newest - c.ts) / span;
    const rank = n > 1 ? i / (n - 1) : 0;
    const t = 0.55 * age + 0.45 * rank;
    baseZ[i] = -(NEAR + depth * t);

    const r = (0.1 + 0.9 * Math.sqrt(h1)) * (1 + FLARE * t);
    const theta = h2 * Math.PI * 2;
    positions[i * 3] = Math.cos(theta) * r * RX;
    positions[i * 3 + 1] = Math.sin(theta) * r * RY;
    positions[i * 3 + 2] = baseZ[i] + (h3 - 0.5) * jitter;

    const churn = Math.log1p(c.additions + c.deletions) / CHURN_CAP;
    sizes[i] = SIZE_MIN + (SIZE_MAX - SIZE_MIN) * Math.min(1, Math.max(0, churn));

    colors.set(starRgb(languages[c.lang].slot), i * 3);
    langs[i] = c.lang;
    seeds[i] = h4;
  }

  // timestamp at a world z, interpolated between neighbouring commits
  function timeAt(z) {
    if (!n) return Date.now() / 1000;
    if (z >= baseZ[0]) return commits[0].ts;
    if (z <= baseZ[n - 1]) return commits[n - 1].ts;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (baseZ[mid] >= z) lo = mid;
      else hi = mid;
    }
    const t = (baseZ[lo] - z) / (baseZ[lo] - baseZ[hi] || 1);
    return commits[lo].ts + (commits[hi].ts - commits[lo].ts) * t;
  }

  return {
    n,
    depth,
    positions,
    sizes,
    colors,
    langs,
    seeds,
    baseZ,
    zNewest: n ? baseZ[0] : -NEAR,
    zOldest: n ? baseZ[n - 1] : -NEAR,
    timeAt,
  };
}
