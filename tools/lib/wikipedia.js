// lib/wikipedia.js — best-effort profile blurb from the enwiki sitelink.
// (Preserved from the original build-n64.js.)
'use strict';

const { fetchWithTimeout } = require('./util');

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

module.exports = { resolveSummary };
