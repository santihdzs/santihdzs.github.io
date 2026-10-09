# santihdzs.com

Personal portfolio of santi hernandez. Static html, css and es modules: no bundler, no build step, no runtime npm
dependencies. Every path is relative, so the site works from a domain root or a subpath.

On wide screens the page sits over a webgl starfield where every star is a real commit from the public `santihdzs`
repos, and every gold shooting star is a real pull request to someone else's project. A small satellite in the hero
shows what is playing on spotify. Screens 720px and narrower, and phones held sideways (touch screens in landscape
500px tall or less), get a list of links over a small 2d sky, with a spotify card last; they load no three.js, gsap,
commit or pull request data. A landscape tablet keeps the full page. The one breakpoint is written once in
`js/main.js`, and every narrow `@media` block in `css/` repeats the same query text:
`(max-width: 720px), (max-height: 500px) and (pointer: coarse) and (orientation: landscape)`.

> **Never run `wrangler` at the repo root.** Every wrangler command belongs inside `worker/`. At the root, wrangler
> auto detects a static site and deploys the whole folder, tools and all, as a new worker.

## structure

```
index.html              all page content
css/                    tokens (colors, type, spacing), base, layout, components, scene
js/
  main.js               entry point: decides narrow vs wide and lazy loads the rest
  reveal.js, rows.js    scroll reveals, row hover glow
  jump.js               number keys on the wide page: 0 the top, 1 to 5 the sections numbered in their labels
  legend.js, accent.js  language dots; a pinned language becomes the interface accent
  mode.js               stars only mode, the toggle, the rocket, the pull request peek
  satellite.js          now playing satellite
  nowplaying.js         now playing samples, parser and fetch, shared by the satellite and the spotify card
  narrow.js, sky.js     the narrow view: the spotify card and the 2d sky (the sky is shared with 404.html)
  config.js             the now playing endpoint
  texture.js            nebula constants and the ?texture switch
  palette.js            the 9 star colors
  scene/                three.js starfield: optics (shared by shader and picker), layout, shaders, picking,
                        commit and pull request card, pull request streaks, nebula, adaptive resolution
data/commits.json       generated commit data
data/prs.json           generated pull request data
assets/orgs/            owner avatars for pull request cards, downloaded at build time
assets/                 official spotify logo and icon (white), unaltered
vendor/                 three 0.186.1 (three.module.js + three.core.js), gsap 3.15.0 esm files
fonts/                  archivo and jetbrains mono, variable woff2, latin subset (OFL)
scripts/                build-commits.mjs, build-prs.mjs and their configs, spotify-auth.mjs
worker/                 the now playing cloudflare worker, deployed by hand (see below)
docs/                   spotify token renewal
.github/workflows/      daily data refresh
tools/                  dev only: local server, browser checks, lighthouse, worker and auth tests
cv.pdf                  the cv
```

## running locally

```sh
node tools/serve.mjs            # http://127.0.0.1:8080/ and http://127.0.0.1:8080/sub/
```

Any static server works; this one also serves everything under `/sub/` to prove relative paths hold. It listens on
loopback only. Opening
`index.html` from disk does not work, because es modules and `fetch` need http.

Useful url parameters:

- `?texture=none` turns off the nebula and vignette of stars mode (`?texture=nebula` is the default). Text mode never
  has a texture.
- `?prs=mock` uses a built in sample of pull requests instead of `data/prs.json`.
- `?spotify=mock` and `?spotify=mock-recent` show a sample satellite without calling the worker.
- `?debug` exposes the hooks the browser checks use: `window.__starfield` (state, and `fireStreak()` to launch a pull
  request streak now) and `window.__launch` during a rocket launch.

## editing content

All copy lives in `index.html`. Placeholder text is lorem ipsum; experience dates and research years are placeholders
too. Each section is a `<section class="section">` with a rail label (`01 / about`) and a body: list rows
(`<li><a class="row">`), publications (`<li class="pub">`, your name in `<span class="me">`), experience
(`<li class="tl-item">`). The mobile links are the `<nav class="linktree">` list inside the hero.

Colors and type live in `css/tokens.css`, star colors in `js/palette.js`. Which language gets which color is decided in
`scripts/build-commits.mjs` (`SLOT_PREFS`).

## data refresh

A github actions workflow (`.github/workflows/commits.yml`) runs daily and on demand. It runs both builders and
commits `data/commits.json`, `data/prs.json` and `assets/orgs/` only when something changed. It uses the
`COMMITS_PAT` secret when present, otherwise the default `GITHUB_TOKEN`.

Run them by hand with node 24 or newer, no install step. Both read a token from `GH_TOKEN`, `GITHUB_TOKEN` or
`gh auth token`, and both leave their files untouched when nothing changed.

```sh
node scripts/build-commits.mjs          # commits from the public repos (graphql)
node scripts/build-prs.mjs              # pull requests to repos you do not own, plus owner avatars
node scripts/build-commits.mjs --mock --out /tmp/commits.json   # fake data for offline work
node scripts/build-prs.mjs --mock --out /tmp/prs.json
```

`scripts/commits.config.json` allows or denies repos and drops commit message patterns. `scripts/prs.config.json`
allows or denies `owner/repo` and skips drafts. Pull requests closed without merging are always dropped. Never commit
mock data (`"mock": true`).

## now playing

The satellite reads `NOW_PLAYING_URL` from `js/config.js`, which points at the worker:
https://now-playing.santihdzs.workers.dev/now-playing. When nothing is playing it shows the last played track: a paused
track while the player session is alive (usually up to about 30 minutes), and after that, or in a private session, the
last finished track. Any failure renders nothing. The worker caches answers for 20
seconds, so visitors never reach spotify directly, and its responses never contain tokens or ids. When spotify cannot
be asked, the worker repeats its last good answer for 2 minutes; after that a track it called playing shows as last
played, and after an hour nothing shows. A refused token refresh is not retried for 5 minutes. Album art loads from
spotify's image host (`i.scdn.co`) without a referrer, the one external host the site contacts besides the worker.

The worker lives in `worker/` and is **deployed by hand**, never by the site or the workflow:

```sh
cd worker
npx wrangler deploy
```

What it needs, all inside `worker/`:

- a spotify app at https://developer.spotify.com/dashboard owned by an account with **premium**, with the redirect uri
  `http://127.0.0.1:8888/callback` and your account under user management
- the kv namespace `NOW_PLAYING`, whose id is in `wrangler.toml` (spotify may rotate refresh tokens, the newest is kept
  there)
- the secrets `SPOTIFY_CLIENT_ID` and `SPOTIFY_REFRESH_TOKEN` (`npx wrangler secret put ...`)
- extra cors origins, if any, in `ALLOWED_ORIGINS` in `wrangler.toml`; production and localhost are built in

The refresh token expires about every 6 months. Getting a new one, storing it, checking it and what to do if it leaks
are all in **[docs/spotify-token-renewal.md](docs/spotify-token-renewal.md)**.

Spotify display rules followed by the satellite: artwork is shown uncropped as a square with 4px corners and nothing
drawn over it, the official spotify icon sits beside it at 21px, the hover label carries the official full logo at
70px, and every piece of metadata links back to the track on spotify.

## checks (dev only)

```sh
cd tools && npm install
node check.mjs              # every browser check except live (takes a while)
node check.mjs prs          # or named sections: static load mobile interact reduced robust perf contrast align
                            # pick overscroll chain browse narrow cardlayout rocket texture accent satellite cards
                            # prs exits blend nebcolor starscontrast breakpoint fixes dim catch readout keys serve
                            # print baseline live
CHECK_LIVE=1 node check.mjs # everything, live included
CHECK_BASELINE=/path/to/copy node check.mjs baseline   # pixels and controls against a copy of the tree from before a change
node lighthouse.mjs         # desktop and mobile
node worker-test.mjs        # the worker against a fake spotify, cache and kv
node auth-test.mjs          # the pkce helper against a fake accounts server
```

The `live` section calls the real worker, so it only runs when named or with `CHECK_LIVE=1`; every other run answers
the worker's url with a local idle reply and never reaches it. The `baseline` section serves the copy named by
`CHECK_BASELINE` next to this tree and compares frames drawn on a fake clock, so it runs only when that is set. Screenshots, rocket launch frames, a printed pdf and
lighthouse reports land in `tools/out/`, which is not committed.

## license

The code is MIT licensed, see [LICENSE.txt](LICENSE.txt).

The personal content is not licensed for reuse: the page text, `cv.pdf` and any photos.

Third party assets keep their own owners and licenses:

- the owner avatars in `assets/orgs/` belong to their organizations
- the spotify icon and logo in `assets/` belong to spotify
- the vendored libraries: three (MIT, `vendor/three/LICENSE`) and gsap (the gsap standard license, see the header of
  each file in `vendor/gsap/`)
- the fonts: archivo and jetbrains mono, under the SIL open font license (`fonts/OFL-*.txt`)
