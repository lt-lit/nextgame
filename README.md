# NextGame (prototype)

A mobile-first, static "what should I play tonight?" picker. Rolls a random game
from a console library, with faceted filters and a rich profile view.
See [`nextgame-design-doc.md`](./nextgame-design-doc.md) for the full design.

This is an **early direction-finding prototype**: one console (Nintendo 64),
real data, no build step, no backend, no credentials.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Pure static — vanilla ES modules, served straight from the repo (no bundler).

## Regenerate the data

```sh
node tools/build.js <console>     # e.g. n64, xbox
```

One parameterized, multi-console generator (offline pipeline, design doc §5). It
is **never served** to the browser — it only emits the static JSON in `data/`
that the app reads. Each console is a config entry in `tools/consoles.js`
(Wikidata QID + optional libretro repo + optional IGDB platform id); adding a
console needs no pipeline code. Sources:

- **Wikidata** (SPARQL) — game list + genre, player modes, developer, publisher, year, and Metacritic score where present. *Free, no key.*
- **libretro-thumbnails** (via jsDelivr CDN) — box / snap / title art, keyed by No-Intro/Redump filename. *Free, no key.*
- **Wikipedia** (REST summary) — the profile blurb. *Free, no key.*
- **IGDB** (api.igdb.com) — cover + screenshot galleries, trailer IDs, and ratings + counts; the primary art/rating source on consoles that enable it. *Free build-time key (see below).*

### IGDB credentials (only for IGDB-enabled consoles)

IGDB uses a free Twitch app's Client ID/Secret, exchanged for a bearer token at
build time. Set them as env vars — **never commit them**:

```sh
TWITCH_CLIENT_ID=… TWITCH_CLIENT_SECRET=… node tools/build.js xbox
```

The free path (Wikidata + libretro + Wikipedia) needs none. API responses cache
under `tools/.cache/` (gitignored); matched IGDB ids freeze in
`tools/igdb-matches.<console>.json` and manual fixes live in `tools/overrides.json`,
so re-runs are idempotent and never clobber hand-fixes.

### Known gaps in this first cut (honest, not bugs)

- **Scores** — only ~3% of N64 titles carry a Metacritic score on Wikidata; the rest are `null`. Unrated games still pass the rating filter by default (design doc §7.3).
- **Time-to-beat buckets** — HowLongToBeat blocks scraping, so `hltbBucket` is a transparent **genre-based placeholder** (flagged `~` in the UI). It's a minor, collapsed filter in the drawer.
- **Cover art** — ~62% match against libretro; misses show a clean title placeholder.

These are being filled next (see design doc §5 / §10): a libretro blobless-clone for
~95% art, Wikipedia "Reception" tables for real per-magazine review scores, and IGDB
enrichment (one free build-time key) for screenshot galleries, trailers, and ratings.
It's all swappable — the app only reads the generated JSON, so the generator can be
repointed at any source without touching the app.

## Deploy (GitHub Pages)

Static, so Pages serves the repo directly. Data paths are relative, so it works
under a project subpath (`/<repo>/`).

## Structure

```
index.html, css/        # static shell
js/                      # data.js, state.js, filters.js, randomizer.js, ui/, main.js
data/                    # GENERATED, committed (manifest + slim index + fat detail)
tools/build.js           # OFFLINE multi-console generator (not served)
tools/consoles.js        # per-console config (Wikidata QID, libretro repo, IGDB id)
tools/lib/               # source modules: wikidata, libretro, wikipedia, igdb
```

> **Xbox (original)** data is built and committed (IGDB-enriched: covers,
> screenshots, trailers, ratings) but **not yet registered in the manifest** —
> wiring it into the UI (console switcher, screenshot carousel, video facade,
> per-source review breakdown) is the next step. The deployed app still serves
> N64 only until then.
