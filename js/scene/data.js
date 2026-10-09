// the most languages the field can tell apart; the shader sizes its per language arrays from it. it lives here,
// in a module with no imports, so the data fetch can start one round trip after main.js asks for it
export const MAX_LANGS = 8;

// decodes the compact data/commits.json shape into plain objects
export async function loadCommits(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`commits.json ${res.status}`);
  return decode(await res.json());
}

export function decode(raw) {
  const listed = (raw.languages ?? []).map((l) => ({ name: String(l.name), slot: l.slot | 0 }));
  // the shader and the picker hold MAX_LANGS languages: past that, the first named ones keep their
  // entries and everything else folds into "other", so no star ever indexes past the end
  const folding = listed.length > MAX_LANGS;
  const own = listed.map((l, i) => i);
  if (folding) own.splice(0, own.length, ...own.filter((i) => listed[i].name !== 'other').slice(0, MAX_LANGS - 1));
  const languages = own.map((i, index) => ({ ...listed[i], index, count: 0 }));
  if (folding || !languages.length) languages.push({ name: 'other', slot: 8, index: languages.length, count: 0 });
  const fallback = languages.length - 1;
  const langOf = (i) => {
    const k = own.indexOf(Number(i));
    return k >= 0 ? k : fallback;
  };

  const repos = (raw.repos ?? []).map((r) => ({
    name: String(r.name),
    lang: listed[r.lang] ? langOf(r.lang) : fallback,
    primary: r.primary ?? null,
  }));

  const commits = [];
  for (const row of raw.commits ?? []) {
    if (!Array.isArray(row) || !repos[row[0]] || typeof row[1] !== 'string') continue;
    const [repo, sha, ts, additions, deletions, files, message] = row;
    const lang = repos[repo].lang;
    languages[lang].count++;
    commits.push({
      repo,
      sha,
      ts: Number(ts) || 0,
      additions: additions | 0,
      deletions: deletions | 0,
      files: files ?? null,
      message: String(message ?? ''),
      lang,
    });
  }
  commits.sort((a, b) => b.ts - a.ts);

  return { generated: raw.generated ?? null, mock: !!raw.mock, user: raw.user ?? '', languages, repos, commits };
}

// built in sample for ?prs=mock, so the streaks can be judged without a data file
const MOCK_PRS = [
  { owner: 'google', repo: 'flax', number: 4312, title: 'Lorem ipsum dolor sit amet for nnx module docstrings', url: 'https://github.com/google/flax/pull/4312', merged: true, createdAt: '2026-09-02T00:00:00Z', mergedAt: '2026-09-10T00:00:00Z', additions: 84, deletions: 12, files: 3, logo: './assets/orgs/google.png' },
  { owner: 'pytorch', repo: 'pytorch', number: 161204, title: 'Sed do eiusmod tempor in optimizer math notation', url: 'https://github.com/pytorch/pytorch/pull/161204', merged: true, createdAt: '2026-06-21T00:00:00Z', mergedAt: '2026-07-02T00:00:00Z', additions: 23, deletions: 19, files: 1, logo: null },
  { owner: 'numpy', repo: 'numpy', number: 27710, title: 'Consectetur adipiscing elit in the random generator docs', url: 'https://github.com/numpy/numpy/pull/27710', merged: false, createdAt: '2026-08-18T00:00:00Z', mergedAt: null, additions: 41, deletions: 7, files: 2, logo: null },
  { owner: 'huggingface', repo: 'transformers', number: 39021, title: 'Ut labore et dolore magna aliqua for tokenizer errors', url: 'https://github.com/huggingface/transformers/pull/39021', merged: false, createdAt: '2026-05-30T00:00:00Z', mergedAt: null, additions: 128, deletions: 44, files: 6, logo: null },
];

const validPr = (p) =>
  p && typeof p.owner === 'string' && typeof p.repo === 'string' && Number.isInteger(p.number) && typeof p.title === 'string' && typeof p.url === 'string' && p.url.startsWith('https://github.com/') && typeof p.createdAt === 'string';

// pull requests for the gold streaks. any failure means no streaks, never an error.
export async function loadPrs(url) {
  if (new URLSearchParams(window.location.search).get('prs') === 'mock') return MOCK_PRS;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const raw = await res.json();
    return (raw.prs ?? []).filter(validPr).map((p) => ({
      ...p,
      merged: Boolean(p.merged && p.mergedAt),
      logo: typeof p.logo === 'string' && p.logo.startsWith('./assets/orgs/') ? p.logo : null,
    }));
  } catch {
    return [];
  }
}
