#!/usr/bin/env node
/**
 * build.js — offline, multi-console data generator (design doc §5).
 *
 *   node tools/build.js <console> [--stage]
 *
 * This is run on demand and is NEVER served to the browser; it only emits the
 * static JSON the app reads (data/index/<c>.json, data/detail/<c>.json) and,
 * unless --stage is given, registers the console in data/manifest.json.
 *
 * Sources are config-driven per console (see consoles.js):
 *   - Wikidata SPARQL .... canonical list + genre/mode/dev/publisher/year + MC
 *   - libretro-thumbnails  No-Intro/Redump-named box/snap/title art (optional)
 *   - IGDB (Twitch OAuth)  art / ratings / screenshots / trailers (optional, key)
 *   - Wikipedia REST ..... short profile blurb (best-effort)
 *
 * Credentials (IGDB only) come from env (TWITCH_CLIENT_ID/SECRET), never committed.
 * Source responses cache under tools/.cache (gitignored); matched IGDB ids freeze
 * in tools/igdb-matches.<c>.json so re-runs are idempotent.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CONSOLES = require('./consoles');
const { slug, uniq, loadCache, saveCache, mapPool } = require('./lib/util');
const { queryWikidata, placeholderBucket } = require('./lib/wikidata');
const { resolveArt } = require('./lib/libretro');
const { resolveWiki } = require('./lib/wikipedia');
const igdbLib = require('./lib/igdb');

const ROOT = path.resolve(__dirname, '..');

function loadOverrides() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'overrides.json'), 'utf8')); } catch { return {}; }
}

// ---- art + summary composition (source-tagged, with fallbacks) -------------

// Cover, best source first: IGDB cover -> libretro boxart -> Wikipedia lead image.
function buildCover(platform, g, m) {
  const ig = igdbLib.igdbCover(m);
  if (ig) return { src: 'igdb', id: ig };
  if (g.art) return { src: 'libretro', platform, base: g.art, kind: 'Named_Boxarts' };
  if (g.wikiImage) return { src: 'url', url: g.wikiImage };
  return null;
}

// Screenshot gallery: IGDB screenshots, then IGDB artworks (promo/key art), then
// the libretro in-game snap + title screen. De-duped, source-tagged, capped.
function buildShots(platform, g, media) {
  const out = [];
  const seen = new Set();
  const add = (key, rec) => { if (key && !seen.has(key)) { seen.add(key); out.push(rec); } };
  for (const s of media.screenshots || []) add(`igdb:${s}`, { src: 'igdb', id: s });
  for (const a of media.artworks || []) add(`igdb:${a}`, { src: 'igdb', id: a });
  if (g.art) {
    add(`snap:${g.art}`, { src: 'libretro', platform, base: g.art, kind: 'Named_Snaps' });
    add(`title:${g.art}`, { src: 'libretro', platform, base: g.art, kind: 'Named_Titles' });
  }
  return out.slice(0, 12);
}

const prettify = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const aan = (s) => (/^[aeiou]/i.test(String(s)) ? 'an' : 'a');

// A "meaty" description: the longer of the Wikipedia lead and the IGDB summary,
// then IGDB storyline, then a last-resort factual line composed from metadata so
// every game carries *some* description.
function buildSummary(platform, g, m, developer, publisher, year) {
  const wiki = (g.summary || '').trim();
  const igdbSum = (m && m.summary ? m.summary : '').trim();
  const best = wiki.length >= igdbSum.length ? wiki : igdbSum;
  if (best) return best;
  const storyline = (m && m.storyline ? m.storyline : '').trim();
  if (storyline) return storyline;
  return composeSummary(platform, g, developer, publisher, year);
}

function composeSummary(platform, g, developer, publisher, year) {
  const label = (CONSOLES[platform] && CONSOLES[platform].label) || platform;
  const genre = (g.genres || []).map(prettify).join(', ');
  const lead = genre ? `${g.title} is ${aan(genre)} ${genre} game for the ${label}` : `${g.title} is a game for the ${label}`;
  const bits = [year ? `${lead}, released in ${year}.` : `${lead}.`];
  if (developer && publisher && developer !== publisher) bits.push(`It was developed by ${developer} and published by ${publisher}.`);
  else if (developer) bits.push(`It was developed by ${developer}.`);
  else if (publisher) bits.push(`It was published by ${publisher}.`);
  const modes = (g.modes || []).map(prettify).join(' and ');
  if (modes) bits.push(`Supports ${modes} play.`);
  return bits.join(' ');
}

async function main() {
  const args = process.argv.slice(2);
  const stage = args.includes('--stage');
  const id = args.find((a) => !a.startsWith('--'));
  const cfg = CONSOLES[id];
  if (!cfg) {
    console.error(`Usage: node tools/build.js <console> [--stage]\n  known consoles: ${Object.keys(CONSOLES).join(', ')}`);
    process.exit(2);
  }
  console.log(`\nBuilding "${cfg.label}" (${id})${stage ? '  [--stage: not registering in manifest]' : ''}\n`);

  // 1) Wikidata spine -------------------------------------------------------
  console.log('1  Wikidata: querying the library...');
  const games = await queryWikidata(cfg.wikidata, (title) => `${id}:${slug(title)}`);
  console.log(`     ${games.length} games`);
  if (!games.length) throw new Error(`no games for ${id} (check Wikidata QID ${cfg.wikidata})`);

  // 2) libretro art (optional) ---------------------------------------------
  if (cfg.libretro) {
    console.log('2  libretro: resolving cover art (cached)...');
    const artCache = loadCache(`art-${id}.json`);
    await mapPool(games, 12, async (g) => { g.art = await resolveArt(g.title, cfg.libretro, artCache); });
    saveCache(`art-${id}.json`, artCache);
  }

  // 3) IGDB enrichment (optional, keyed) -----------------------------------
  let igdbStats = null;
  if (cfg.igdb) {
    console.log('3  IGDB: enriching (art / ratings / screenshots / trailers)...');
    const auth = await igdbLib.getToken();
    const pool = await igdbLib.bulkPlatformGames(cfg.igdb.platformId, auth);
    console.log(`     ${pool.length} IGDB games on platform ${cfg.igdb.platformId}`);
    const index = igdbLib.buildIndex(pool);
    const { result, stats } = igdbLib.matchSpine(games, pool, index, id, loadOverrides());
    igdbStats = stats;
    console.log(`     matched ${stats.matched}/${stats.total}  (${stats.fresh} new, ${stats.frozen} frozen, ${stats.overridden} override)`);

    const matchedIds = uniq([...result.values()].map((g) => g.id));
    console.log('     fetching screenshots + trailers for matched games...');
    const media = await igdbLib.fetchMedia(matchedIds, auth);

    for (const g of games) {
      const m = result.get(g.id) || null;
      g.igdb = m;
      g.igdbMedia = m ? (media.get(m.id) || igdbLib.EMPTY_MEDIA) : igdbLib.EMPTY_MEDIA;
    }
  }

  // 4) Wikipedia blurbs + lead image ---------------------------------------
  // Gentle concurrency: the REST summary endpoint rate-limits hard. We only ask
  // it for a lead image when the game still has no cover (no IGDB cover, no
  // libretro boxart); the meaty intro comes from the action API, which doesn't.
  console.log('4  Wikipedia: fetching intros + lead images (cached, best-effort)...');
  const wikiCache = loadCache(`wiki-${id}.json`);
  await mapPool(games, 4, async (g) => {
    const needImage = !igdbLib.igdbCover(g.igdb) && !g.art;
    const w = await resolveWiki(g.wiki, wikiCache, needImage);
    g.summary = w.summary;
    g.wikiImage = w.image;
  });
  saveCache(`wiki-${id}.json`, wikiCache);

  // 5) Emit -----------------------------------------------------------------
  // One unified, source-tagged shape for every console. Cover and screenshots
  // are polymorphic { src, ... } records the client resolves to URLs, so a single
  // gallery can blend IGDB media, libretro snap/title art, and Wikipedia images.
  console.log('5  Emitting JSON...');
  const slim = [];
  const detail = {};
  for (const g of games) {
    const bucket = placeholderBucket(g.genres);
    const m = g.igdb || null;
    const media = g.igdbMedia || igdbLib.EMPTY_MEDIA;
    const { rating, ratingCount, reviews } = igdbLib.deriveRatings(m, g.rating);
    const year = g.year ?? (m && m.first_release_date ? new Date(m.first_release_date * 1000).getUTCFullYear() : null);
    // IGDB tags developer-vs-publisher explicitly (Wikidata's order is arbitrary
    // and lumps in port houses), so prefer it where present.
    const developer = igdbLib.companies(m, 'developer')[0] || g.devs[0] || null;
    const publisher = igdbLib.companies(m, 'publisher')[0] || g.pubs[0] || null;

    slim.push({
      id: g.id, title: g.title, platform: id, year,
      genres: g.genres, modes: g.modes, rating, hltbBucket: bucket,
      cover: buildCover(id, g, m), tags: [], _hltbPlaceholder: true,
    });
    detail[g.id] = {
      id: g.id, developer, publisher,
      summary: buildSummary(id, g, m, developer, publisher, year),
      screenshots: buildShots(id, g, media),
      videos: media.videos || [],
      rating, ratingCount, reviews,
      art: { igdbCover: igdbLib.igdbCover(m), libretro: g.art || null, wikipedia: g.wikiImage || null },
      hltb: null,
      links: { wikipedia: g.wiki || null, igdb: igdbLib.igdbUrl(m) },
      igdbId: m ? m.id : null,
      trivia: null,
    };
  }

  fs.mkdirSync(path.join(ROOT, 'data/index'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'data/detail'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data/index', `${id}.json`), JSON.stringify(slim));
  fs.writeFileSync(path.join(ROOT, 'data/detail', `${id}.json`), JSON.stringify(detail));

  if (!stage) registerInManifest(cfg, slim.length);

  report(cfg, slim, detail, igdbStats);
}

// Upsert this console's entry into the shared manifest, preserving others.
function registerInManifest(cfg, count) {
  const p = path.join(ROOT, 'data/manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { manifest = { consoles: [], overlays: [] }; }
  const entry = {
    id: cfg.id, label: cfg.label, count,
    index: `data/index/${cfg.id}.json`, detail: `data/detail/${cfg.id}.json`,
  };
  const i = (manifest.consoles || []).findIndex((c) => c.id === cfg.id);
  if (i >= 0) manifest.consoles[i] = entry; else (manifest.consoles = manifest.consoles || []).push(entry);
  manifest.generatedAt = new Date().toISOString();
  manifest.note = manifest.note || 'Sources: Wikidata (spine) + IGDB (covers/screenshots/artwork/trailers/ratings) + libretro-thumbnails (N64 box/snap/title) + Wikipedia (meaty descriptions + cover fallback).';
  manifest.overlays = manifest.overlays || [];
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
}

function pct(n, d) { return d ? `${Math.round((n / d) * 100)}%` : '0%'; }

function report(cfg, slim, detail, igdbStats) {
  const n = slim.length;
  const withCover = slim.filter((s) => s.cover).length;
  const withRating = slim.filter((s) => s.rating != null).length;
  const withSummary = Object.values(detail).filter((d) => d.summary).length;
  console.log('\n==== build summary ====');
  console.log(`games:         ${n}`);
  console.log(`with cover:    ${withCover}  (${pct(withCover, n)})`);
  console.log(`with rating:   ${withRating}  (${pct(withRating, n)})`);
  console.log(`with summary:  ${withSummary}  (${pct(withSummary, n)})`);
  if (igdbStats) {
    const withShots = Object.values(detail).filter((d) => d.screenshots && d.screenshots.length).length;
    const withVideos = Object.values(detail).filter((d) => d.videos && d.videos.length).length;
    console.log(`IGDB matched:  ${igdbStats.matched}  (${pct(igdbStats.matched, n)})`);
    console.log(`with shots:    ${withShots}  (${pct(withShots, n)})`);
    console.log(`with trailers: ${withVideos}  (${pct(withVideos, n)})`);
  }
  console.log('=======================');
}

main().catch((e) => { console.error('\nBUILD FAILED:', e); process.exit(1); });
