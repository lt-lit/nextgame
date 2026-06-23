// consoles.js — per-console build configuration. Adding a console = a new entry
// here (plus running `node tools/build.js <id>`); no pipeline code changes.
//
//   wikidata : Wikidata QID of the platform (P400 value) — the spine.
//   libretro : libretro-thumbnails repo for No-Intro/Redump-named art, or null.
//   igdb     : { platformId } to enrich via IGDB (art/ratings/media), or null.
'use strict';

module.exports = {
  n64: {
    id: 'n64',
    label: 'Nintendo 64',
    wikidata: 'Q184839',
    libretro: 'libretro-thumbnails/Nintendo_-_Nintendo_64@master',
    igdb: { platformId: 4 }, // IGDB Nintendo 64 — adds covers/screenshots/trailers/ratings
  },

  xbox: {
    id: 'xbox',
    label: 'Xbox',
    wikidata: 'Q132020', // Microsoft Xbox (original)
    libretro: null,       // disc-based; IGDB is the primary art source here
    igdb: { platformId: 11 },
  },
};
