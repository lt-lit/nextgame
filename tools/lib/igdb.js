// lib/igdb.js — IGDB enrichment (design doc §5/§6). Build-time only; credentials
// come from env (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET), never committed.
//
// Strategy: bulk-pull every game on the target platform once (cheap, ~500/page),
// build a normalized-name index, then match the Wikidata spine against it locally
// (far fewer requests than per-title lookups, and rate-limit friendly). Matched
// IGDB ids are frozen in a committed match-cache so re-runs are idempotent.
'use strict';

const { normName, loadCache, saveCache, CACHE_DIR } = require('./util');
const fs = require('fs');
const path = require('path');

const OAUTH = 'https://id.twitch.tv/oauth2/token';
const API = 'https://api.igdb.com/v4';

// --- auth -------------------------------------------------------------------

async function getToken() {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('IGDB stage needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the environment');
  }
  // reuse a cached bearer until it nears expiry (tokens last ~60 days)
  const cache = loadCache('igdb-token.json');
  if (cache.access_token && cache.expires_at && cache.client === id && Date.now() < cache.expires_at - 60000) {
    return { id, token: cache.access_token };
  }
  const res = await fetch(`${OAUTH}?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error(`IGDB OAuth ${res.status}: ${JSON.stringify(j)}`);
  saveCache('igdb-token.json', { client: id, access_token: j.access_token, expires_at: Date.now() + (j.expires_in || 0) * 1000 });
  return { id, token: j.access_token };
}

// --- low-level query (Apicalypse) ------------------------------------------

async function igdb(endpoint, body, auth) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': auth.id, Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
      body,
    });
    if (res.ok) return res.json();
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); continue; } // rate limited
    throw new Error(`IGDB ${endpoint} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`IGDB ${endpoint}: gave up after rate-limit retries`);
}

// --- bulk platform pull (cached to disk) -----------------------------------

const BULK_FIELDS = [
  'id', 'name', 'slug', 'game_type', 'first_release_date',
  'total_rating', 'total_rating_count', 'aggregated_rating', 'aggregated_rating_count',
  'rating', 'rating_count', 'cover.image_id', 'alternative_names.name',
  'summary', 'storyline', 'genres.name',
  'involved_companies.company.name', 'involved_companies.developer', 'involved_companies.publisher',
].join(',');

async function bulkPlatformGames(platformId, auth) {
  const cacheName = `igdb-platform-${platformId}.json`;
  const cached = loadCache(cacheName);
  if (Array.isArray(cached.games) && cached.games.length) {
    console.log(`     (using ${cached.games.length} cached IGDB games for platform ${platformId})`);
    return cached.games;
  }
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const page = await igdb('games',
      `fields ${BULK_FIELDS}; where platforms = (${platformId}); sort id asc; limit 500; offset ${offset};`, auth);
    all.push(...page);
    process.stdout.write(`\r     pulled ${all.length} IGDB games...`);
    if (page.length < 500) break;
  }
  process.stdout.write('\n');
  saveCache(cacheName, { platformId, pulledAt: Date.now(), games: all });
  return all;
}

// --- name index + matching --------------------------------------------------

// Prefer a real base game, then the most-rated, then the earliest release.
// (IGDB renamed `category` -> `game_type` in 2024; game_type 0 == "main_game".)
function better(a, b) {
  const main = (g) => (g.game_type === 0 ? 1 : 0);
  if (main(a) !== main(b)) return main(b) - main(a);
  if ((b.total_rating_count || 0) !== (a.total_rating_count || 0)) return (b.total_rating_count || 0) - (a.total_rating_count || 0);
  return (a.first_release_date || Infinity) - (b.first_release_date || Infinity);
}

function buildIndex(games) {
  const idx = new Map(); // normName -> [games]
  const add = (key, g) => { if (!key) return; const a = idx.get(key) || []; a.push(g); idx.set(key, a); };
  for (const g of games) {
    add(normName(g.name), g);
    for (const an of g.alternative_names || []) add(normName(an.name), g);
  }
  for (const [, arr] of idx) arr.sort(better);
  return idx;
}

const matchCachePath = (platform) => path.join(__dirname, '..', `igdb-matches.${platform}.json`);

function loadMatches(platform) {
  try { return JSON.parse(fs.readFileSync(matchCachePath(platform), 'utf8')); } catch { return {}; }
}
function saveMatches(platform, obj) {
  // sorted keys for a stable, reviewable diff
  const sorted = Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  fs.writeFileSync(matchCachePath(platform), JSON.stringify(sorted, null, 2) + '\n');
}

// Match the spine against the index. Honors overrides (forced igdb id) and a
// frozen match-cache (positive matches only — misses stay open to retry).
function matchSpine(spine, games, index, platform, overrides) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const matches = loadMatches(platform);
  const result = new Map(); // spine id -> igdb game
  let frozen = 0, fresh = 0, overridden = 0;

  for (const g of spine) {
    const ov = overrides[g.id];
    if (ov && ov.igdbId != null) {
      if (byId.has(ov.igdbId)) { result.set(g.id, byId.get(ov.igdbId)); matches[g.id] = ov.igdbId; overridden++; continue; }
    }
    if (matches[g.id] != null && byId.has(matches[g.id])) { result.set(g.id, byId.get(matches[g.id])); frozen++; continue; }

    const cand = index.get(normName(g.title));
    if (cand && cand.length) { result.set(g.id, cand[0]); matches[g.id] = cand[0].id; fresh++; }
  }
  saveMatches(platform, matches);
  return { result, stats: { frozen, fresh, overridden, total: spine.length, matched: result.size } };
}

// --- media (screenshots + artworks + trailers) for the matched set ---------
// Artworks (promo/key art) ride alongside screenshots to fatten the gallery —
// retro titles often have only a handful of true screenshots on IGDB.

async function fetchMedia(igdbIds, auth) {
  const media = new Map(); // igdb id -> { screenshots, artworks, videos }
  for (let i = 0; i < igdbIds.length; i += 500) {
    const chunk = igdbIds.slice(i, i + 500);
    const rows = await igdb('games',
      `fields id,screenshots.image_id,artworks.image_id,videos.video_id; where id = (${chunk.join(',')}); limit 500;`, auth);
    for (const r of rows) {
      media.set(r.id, {
        screenshots: (r.screenshots || []).map((s) => s.image_id).filter(Boolean),
        artworks: (r.artworks || []).map((a) => a.image_id).filter(Boolean),
        videos: (r.videos || []).map((v) => v.video_id).filter(Boolean),
      });
    }
    process.stdout.write(`\r     media for ${Math.min(i + 500, igdbIds.length)}/${igdbIds.length}...`);
  }
  if (igdbIds.length) process.stdout.write('\n');
  return media;
}

const EMPTY_MEDIA = { screenshots: [], artworks: [], videos: [] };

// --- field derivation -------------------------------------------------------

const round = (x) => (x == null ? null : Math.round(x));

// Compose headline rating + per-source review breakdown from an IGDB game,
// keeping any Wikidata Metacritic score. IGDB total_rating is preferred headline.
function deriveRatings(igdbGame, wikidataRating) {
  const g = igdbGame || {};
  const rating = round(g.total_rating) ?? wikidataRating ?? null;
  const ratingCount = g.total_rating_count ?? null;
  const reviews = [];
  if (g.aggregated_rating != null) reviews.push({ source: 'Critics', score: round(g.aggregated_rating), count: g.aggregated_rating_count ?? null });
  if (g.rating != null) reviews.push({ source: 'IGDB users', score: round(g.rating), count: g.rating_count ?? null });
  if (wikidataRating != null) reviews.push({ source: 'Metacritic', raw: `${wikidataRating}/100`, score: wikidataRating });
  return { rating, ratingCount, reviews };
}

function companies(igdbGame, role) {
  return (igdbGame?.involved_companies || [])
    .filter((c) => c[role] && c.company && c.company.name)
    .map((c) => c.company.name);
}

const igdbCover = (g) => (g && g.cover && g.cover.image_id ? g.cover.image_id : null);
const igdbUrl = (g) => (g && g.slug ? `https://www.igdb.com/games/${g.slug}` : null);

module.exports = {
  getToken, bulkPlatformGames, buildIndex, matchSpine, fetchMedia, EMPTY_MEDIA,
  deriveRatings, companies, igdbCover, igdbUrl, round,
};
