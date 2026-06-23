// lib/wikipedia.js — profile blurb (+ lead image) from the enwiki sitelink.
//
// Two sources, best-effort:
//   - action API `extracts&exintro&explaintext` — the FULL lead section (plain
//     text), several paragraphs of "meaty" prose, not the 1-2 sentence REST blurb.
//   - REST summary — used only to recover the lead image (usually the box art),
//     and only when a game still lacks a cover, because that endpoint rate-limits
//     hard. `pageimages` can't replace it: it deliberately skips non-free files.
'use strict';

const { fetchWithTimeout } = require('./util');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const titleOf = (wikiUrl) => (wikiUrl ? decodeURIComponent((wikiUrl.split('/wiki/')[1] || '')) : '');

// GET JSON with backoff. Returns { ok, json }: ok=false is a give-up (caller
// shouldn't cache); json=null with ok=true means the page is genuinely absent.
// 429/5xx back off (honoring Retry-After); other 4xx give up immediately.
async function getJson(url, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 9000);
      if (res.ok) return { ok: true, json: await res.json() };
      if (res.status === 404) return { ok: true, json: null };
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after')) || 0;
        await sleep(ra * 1000 || (400 * 2 ** i + Math.random() * 250));
        continue;
      }
      return { ok: false, json: null }; // other 4xx — don't hammer
    } catch { await sleep(400 * 2 ** i + Math.random() * 250); } // transient/network
  }
  return { ok: false, json: null };
}

// Full lead section as plain text. { ok, value }.
async function fetchIntro(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2`
    + `&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`;
  const { ok, json } = await getJson(url);
  if (!ok) return { ok: false, value: null };
  const page = json && json.query && json.query.pages && json.query.pages[0];
  if (!page || page.missing) return { ok: true, value: null };
  return { ok: true, value: (page.extract || '').trim() || null };
}

// Lead image (box art) via the REST summary. { ok, value }.
async function fetchLeadImage(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const { ok, json } = await getJson(url);
  if (!ok) return { ok: false, value: null };
  if (!json) return { ok: true, value: null };
  return { ok: true, value: (json.originalimage && json.originalimage.source) || (json.thumbnail && json.thumbnail.source) || null };
}

// Resolve { summary, image } for an enwiki sitelink. `wantImage` gates the
// throttle-prone REST call — pass false when the game already has a cover. Cache
// is title -> result; only definitive results are cached, so re-runs retry
// network blips but never re-hit settled pages.
async function resolveWiki(wikiUrl, cache, wantImage = true) {
  const title = titleOf(wikiUrl);
  if (!title) return { summary: null, image: null };
  if (title in cache) return cache[title];
  const intro = await fetchIntro(title);
  const img = wantImage ? await fetchLeadImage(title) : { ok: true, value: null };
  const out = { summary: intro.value, image: img.value };
  if (intro.ok && img.ok) cache[title] = out;
  return out;
}

// Back-compat shim (older callers expected just the blurb string).
async function resolveSummary(wikiUrl, cache) {
  return (await resolveWiki(wikiUrl, cache)).summary;
}

module.exports = { resolveWiki, resolveSummary };
