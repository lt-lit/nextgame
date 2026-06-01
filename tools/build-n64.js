#!/usr/bin/env node
/**
 * build-n64.js — prototype data generator for the N64 console.
 *
 * This is the offline, run-on-demand pipeline (design doc §5). It is NEVER
 * served to the browser — it only emits the static JSON that is.
 *
 * Sources (all free, no credentials — see design doc §2/§5):
 *   - Wikidata SPARQL ........ canonical game list + genre/mode/dev/publisher/year
 *                              + Metacritic score (where present) + enwiki link
 *   - libretro-thumbnails .... cover art / screenshots, keyed by No-Intro name,
 *                              served via the jsDelivr CDN
 *   - Wikipedia REST summary . short profile blurb (best-effort)
 *
 * Honest gaps in this first cut (documented, not hidden):
 *   - rating ...... only where Wikidata carries a Metacritic score; else null
 *                   (this is realistic — most retro titles are unrated).
 *   - hltbBucket .. HowLongToBeat is bot-blocked, so buckets are a transparent
 *                   genre-based PLACEHOLDER just so the time chips demo. Not
 *                   authoritative; flagged via `_hltbPlaceholder` on the entry.
 *
 * Idempotent: API responses are cached under tools/.cache so re-runs are cheap
 * and tolerate partial network failures (a miss just yields a blank field).
 *
 * Output: data/index/n64.json, data/detail/n64.json, data/manifest.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache');
const UA = 'NextGame-prototype/0.1 (personal game picker; spades09@gmail.com)';

const PLATFORM = 'n64';
const PLATFORM_LABEL = 'Nintendo 64';
const WD_PLATFORM = 'Q184839'; // Nintendo 64
const LIBRETRO_REPO = 'libretro-thumbnails/Nintendo_-_Nintendo_64@master';
const CDN = `https://cdn.jsdelivr.net/gh/${LIBRETRO_REPO}`;

// ---------------------------------------------------------------------------
// tiny utilities
// ---------------------------------------------------------------------------

function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

// run `fn` over `items` with bounded concurrency
async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  const total = items.length;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
      done++;
      if (done % 40 === 0 || done === total) process.stdout.write(`\r   ...${done}/${total}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  process.stdout.write('\n');
  return out;
}

// simple JSON-file cache keyed by string
function loadCache(name) {
  const p = path.join(CACHE_DIR, name);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}
function saveCache(name, obj) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// 1. Wikidata — the spine
// ---------------------------------------------------------------------------

const SPARQL = `
SELECT ?game ?gameLabel ?wiki
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
  (GROUP_CONCAT(DISTINCT ?modeLabel;  separator="|") AS ?modes)
  (GROUP_CONCAT(DISTINCT ?devLabel;   separator="|") AS ?devs)
  (GROUP_CONCAT(DISTINCT ?pubLabel;   separator="|") AS ?pubs)
  (GROUP_CONCAT(DISTINCT ?mc;         separator="|") AS ?metacritic)
  (MIN(?date) AS ?firstDate)
WHERE {
  ?game wdt:P31 wd:Q7889 ;          # instance of: video game
        wdt:P400 wd:${WD_PLATFORM} . # platform: Nintendo 64
  ?game rdfs:label ?gameLabel . FILTER(LANG(?gameLabel) = "en")
  OPTIONAL { ?game wdt:P136 ?genre. ?genre rdfs:label ?genreLabel. FILTER(LANG(?genreLabel)="en") }
  OPTIONAL { ?game wdt:P404 ?mode.  ?mode  rdfs:label ?modeLabel.  FILTER(LANG(?modeLabel)="en") }
  OPTIONAL { ?game wdt:P178 ?dev.   ?dev   rdfs:label ?devLabel.   FILTER(LANG(?devLabel)="en") }
  OPTIONAL { ?game wdt:P123 ?pub.   ?pub   rdfs:label ?pubLabel.   FILTER(LANG(?pubLabel)="en") }
  OPTIONAL { ?game wdt:P577 ?date. }
  OPTIONAL { ?game p:P444 ?rs. ?rs ps:P444 ?mc ; pq:P447 wd:Q150248 . }  # review score by Metacritic
  OPTIONAL { ?wiki schema:about ?game ; schema:isPartOf <https://en.wikipedia.org/> . }
}
GROUP BY ?game ?gameLabel ?wiki
`;

function mapMode(label) {
  const l = label.toLowerCase();
  if (l.includes('single')) return 'singleplayer';
  if (l.includes('cooperative') || l.includes('co-op') || l.includes('co op')) return 'co-op';
  if (l.includes('split')) return 'splitscreen';
  if (l.includes('multiplayer') || l.includes('multi-player') || l.includes('multiplayer')) return 'multiplayer';
  return null;
}

function normGenre(label) {
  const g = label.toLowerCase().trim().replace(/\s+video game$/, '').replace(/\s+game$/, '');
  return slug(g);
}

function parseMetacritic(concat) {
  if (!concat) return null;
  for (const part of concat.split('|')) {
    const m = part.match(/(\d{1,3})\s*\/\s*100/);
    if (m) return Math.min(100, parseInt(m[1], 10));
  }
  return null;
}

// transparent placeholder until a real time-to-beat source is wired in
function placeholderBucket(genres) {
  const g = new Set(genres);
  const has = (...xs) => xs.some((x) => g.has(x));
  if (has('role-playing', 'strategy', 'simulation', 'real-time-strategy', 'turn-based-strategy', 'action-role-playing')) return 'very-long';
  if (has('action-adventure', 'adventure', 'platform', 'open-world')) return 'long';
  if (has('first-person-shooter', 'shooter', 'action', 'fighting', 'beat-em-up', 'stealth')) return 'medium';
  if (has('racing', 'sports', 'puzzle', 'party', 'rhythm')) return 'short';
  return 'medium';
}

async function queryWikidata() {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(SPARQL);
  console.log('1/4  Querying Wikidata for the N64 library...');
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/sparql-results+json' } }, 60000);
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}`);
  const json = await res.json();
  const rows = json.results.bindings;
  console.log(`     got ${rows.length} raw rows`);

  const byId = new Map();
  for (const r of rows) {
    const title = r.gameLabel?.value?.trim();
    if (!title || /^Q\d+$/.test(title)) continue; // skip unlabeled items
    const id = `${PLATFORM}:${slug(title)}`;

    const genres = uniq((r.genres?.value || '').split('|').map(normGenre));
    const modes = uniq((r.modes?.value || '').split('|').map(mapMode));
    const devs = uniq((r.devs?.value || '').split('|').map((s) => s.trim()));
    const pubs = uniq((r.pubs?.value || '').split('|').map((s) => s.trim()));
    const year = r.firstDate?.value ? parseInt(r.firstDate.value.slice(0, 4), 10) : null;
    const rating = parseMetacritic(r.metacritic?.value);
    const wiki = r.wiki?.value || null;

    const existing = byId.get(id);
    if (existing) {
      // merge duplicate rows (regional variants etc.) — keep richest data
      existing.genres = uniq([...existing.genres, ...genres]);
      existing.modes = uniq([...existing.modes, ...modes]);
      existing.devs = uniq([...existing.devs, ...devs]);
      existing.pubs = uniq([...existing.pubs, ...pubs]);
      existing.year = existing.year ?? year;
      existing.rating = existing.rating ?? rating;
      existing.wiki = existing.wiki ?? wiki;
    } else {
      byId.set(id, { id, title, genres, modes, devs, pubs, year, rating, wiki });
    }
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// 2. libretro art — reconstruct the No-Intro filename and verify it resolves
// ---------------------------------------------------------------------------

const deburr = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const flipArticle = (seg) => {
  const m = seg.match(/^(The|A|An)\s+(.*)$/i);
  return m ? `${m[2]}, ${m[1]}` : seg;
};

// Generate candidate No-Intro base names (most-likely first).
function artCandidates(title) {
  const t = title.trim().replace(/\s*:\s*/g, ' - ');
  const segs = t.split(' - ');
  // No-Intro flips the article WITHIN the first title segment, before any subtitle:
  // "The Legend of Zelda: Ocarina of Time" -> "Legend of Zelda, The - Ocarina of Time"
  const firstFlip = [flipArticle(segs[0]), ...segs.slice(1)].join(' - ');
  const wholeFlip = flipArticle(t); // fallback for the simpler convention
  const bases = uniq([firstFlip, t, wholeFlip, deburr(firstFlip), deburr(t), deburr(wholeFlip)]);
  const regions = [
    '(USA)', '(USA, Europe)', '(Japan)', '(Europe)', '(World)',
    '(USA) (Rev 1)', '(Japan) (Rev 1)', '(USA, Europe) (Rev 1)',
    '(Europe) (Rev 1)', '(USA) (Rev A)', '(Japan, USA)',
  ];
  const out = [];
  for (const b of bases) for (const r of regions) out.push(`${b} ${r}`);
  return uniq(out).slice(0, 20);
}

async function resolveArt(title, cache) {
  if (title in cache) return cache[title];
  for (const name of artCandidates(title)) {
    const url = `${CDN}/Named_Boxarts/${encodeURIComponent(name)}.png`;
    try {
      const res = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-0' } }, 8000);
      if (res.ok || res.status === 206) { cache[title] = name; return name; }
    } catch { /* timeout/network — try next candidate */ }
  }
  // don't cache misses — lets re-runs retry them as the matcher improves
  return null;
}

// ---------------------------------------------------------------------------
// 3. Wikipedia summary — best-effort profile blurb
// ---------------------------------------------------------------------------

async function resolveSummary(wikiUrl, cache) {
  if (!wikiUrl) return null;
  const title = decodeURIComponent(wikiUrl.split('/wiki/')[1] || '');
  if (!title) return null;
  if (title in cache) return cache[title];
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000);
      if (res.ok) {
        const j = await res.json();
        const extract = (j.extract || '').trim() || null;
        if (extract) { cache[title] = extract; return extract; }
        return null; // page exists but no extract; don't cache, allow later retry
      }
      if (res.status === 404) { cache[title] = null; return null; } // genuinely absent
    } catch { /* transient — retry */ }
  }
  return null; // don't cache transient misses
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

(async function main() {
  const games = await queryWikidata();

  console.log('2/4  Resolving cover art from libretro (cached)...');
  const artCache = loadCache('art.json');
  await mapPool(games, 12, async (g) => { g.art = await resolveArt(g.title, artCache); });
  saveCache('art.json', artCache);

  console.log('3/4  Fetching Wikipedia summaries (cached, best-effort)...');
  const wikiCache = loadCache('wiki.json');
  await mapPool(games, 8, async (g) => { g.summary = await resolveSummary(g.wiki, wikiCache); });
  saveCache('wiki.json', wikiCache);

  console.log('4/4  Emitting JSON...');
  const slim = [];
  const detail = {};
  for (const g of games) {
    const bucket = placeholderBucket(g.genres);
    slim.push({
      id: g.id,
      title: g.title,
      platform: PLATFORM,
      year: g.year,
      genres: g.genres,
      modes: g.modes,
      rating: g.rating,
      hltbBucket: bucket,
      cover: g.art,            // libretro No-Intro base name; client resolves URL
      tags: [],
      _hltbPlaceholder: true,  // buckets are heuristic, not real HLTB data
    });
    detail[g.id] = {
      id: g.id,
      developer: g.devs[0] || null,
      publisher: g.pubs[0] || null,
      summary: g.summary || null,
      art: g.art,              // boxart/snap/title-screen all derive from this name
      videos: [],
      ratingCount: null,
      hltb: null,
      links: {
        wikipedia: g.wiki || null,
      },
      trivia: null,
    };
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    note: 'Prototype data. Sources: Wikidata + libretro-thumbnails + Wikipedia. No credentials used.',
    consoles: [{
      id: PLATFORM,
      label: PLATFORM_LABEL,
      count: slim.length,
      index: `data/index/${PLATFORM}.json`,
      detail: `data/detail/${PLATFORM}.json`,
    }],
    overlays: [],
  };

  fs.writeFileSync(path.join(ROOT, 'data/index', `${PLATFORM}.json`), JSON.stringify(slim));
  fs.writeFileSync(path.join(ROOT, 'data/detail', `${PLATFORM}.json`), JSON.stringify(detail));
  fs.writeFileSync(path.join(ROOT, 'data/manifest.json'), JSON.stringify(manifest, null, 2));

  // ---- summary report ----
  const withArt = slim.filter((s) => s.cover).length;
  const withGenre = slim.filter((s) => s.genres.length).length;
  const withMode = slim.filter((s) => s.modes.length).length;
  const withRating = slim.filter((s) => s.rating != null).length;
  const withSummary = Object.values(detail).filter((d) => d.summary).length;
  console.log('\n==== build summary ====');
  console.log(`games:        ${slim.length}`);
  console.log(`with cover:   ${withArt}  (${Math.round(withArt / slim.length * 100)}%)`);
  console.log(`with genre:   ${withGenre}  (${Math.round(withGenre / slim.length * 100)}%)`);
  console.log(`with mode:    ${withMode}  (${Math.round(withMode / slim.length * 100)}%)`);
  console.log(`with rating:  ${withRating}  (${Math.round(withRating / slim.length * 100)}%)  [Metacritic via Wikidata]`);
  console.log(`with summary: ${withSummary}  (${Math.round(withSummary / slim.length * 100)}%)`);
  console.log('=======================');
})().catch((e) => { console.error('\nBUILD FAILED:', e); process.exit(1); });
