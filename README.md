# NextGame (prototype)

A mobile-first, static "what should I play tonight?" picker. Rolls a random game
from a console library, with faceted filters and a rich profile view.
See [`nextgame-design-doc.md`](./nextgame-design-doc.md) for the full design.

Two libraries ship today — **Nintendo 64** and **Xbox (original)** — both
IGDB-enriched (covers, screenshot galleries, trailers, per-source ratings) on top
of a Wikidata spine, with meaty Wikipedia descriptions. Static at runtime: the
data is generated offline and committed; the app reads JSON, no backend.

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
- **IGDB** (api.igdb.com) — covers, screenshot + key-art galleries, trailer IDs, and ratings + counts; the primary art/rating source. *Free build-time key (see below).*
- **libretro-thumbnails** (via jsDelivr CDN) — box / snap / title art, keyed by No-Intro/Redump filename; cover fallback **and** extra N64 screenshots (snap + title screen). *Free, no key.*
- **Wikipedia** — the full lead section (action API, plain-text — meaty, multi-paragraph) for the description, plus the REST summary's lead image as a cover fallback. *Free, no key.*

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

### Coverage (after IGDB enrichment)

| | cover | description | ≥1 screenshot | ≥5 screenshots |
|---|---|---|---|---|
| **N64** (413) | 94% | 100% | 81% | 52% |
| **Xbox** (987) | 98% | 100% | 67% | 35% |

- **Cover art** — IGDB cover → libretro boxart (N64) → Wikipedia lead image. The few misses show a clean title placeholder.
- **Descriptions** — every game has one: the full Wikipedia lead section (meaty, multi-paragraph) where it exists, else the IGDB summary, else a factual line composed from metadata.
- **Screenshots** — the gallery blends IGDB screenshots, IGDB key art, and (N64) the libretro in-game snap + title screen. The **≥5-per-game** target is capped by what IGDB actually holds for retro titles (~1/3–1/2 of games); closing it fully needs a richer screenshot source (e.g. a MobyGames / TheGamesDB key) — the source-tagged art model already accepts `{ src:'url', url }` records, so adding one is a generator-only change.

### Known gaps (honest, not bugs)

- **Scores** — IGDB ratings now cover ~53% (N64) / 72% (Xbox); the rest are `null`. Unrated games still pass the rating filter by default (design doc §7.3).
- **Time-to-beat buckets** — HowLongToBeat blocks scraping, so `hltbBucket` is a transparent **genre-based placeholder** (flagged `~` in the UI). It's a minor, collapsed filter in the drawer.

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

> Both **N64** and **Xbox (original)** are IGDB-enriched (covers, screenshot
> galleries, trailers, per-source ratings). The drawer's **Console** facet switches
> between or combines libraries; a rolled game shows a screenshot carousel,
> click-to-load trailer facades (no third-party JS until tapped), and a per-source
> review breakdown. Cover and screenshot records are **source-tagged**
> (`{ src:'igdb' | 'libretro' | 'url', … }`) and resolved to URLs client-side, so a
> single gallery blends IGDB media, libretro snap/title art, and ready-made URLs;
> anything a game lacks degrades to a clean placeholder.
