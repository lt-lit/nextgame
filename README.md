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
node tools/build-n64.js
```

The generator is the offline pipeline (design doc §5). It is **never served** to
the browser — it only emits the static JSON in `data/` that the app reads.
Sources, all free / no credentials:

- **Wikidata** (SPARQL) — game list + genre, player modes, developer, publisher, year, and Metacritic score where present.
- **libretro-thumbnails** (via jsDelivr CDN) — cover art / screenshots, keyed by No-Intro filename.
- **Wikipedia** (REST summary) — the profile blurb.

API responses are cached under `tools/.cache/` (gitignored), so re-runs are cheap.

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
tools/build-n64.js       # OFFLINE data generator (not served)
```
