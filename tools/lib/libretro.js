// lib/libretro.js — reconstruct the No-Intro/Redump base name for a title and
// verify it resolves against a libretro-thumbnails repo (via the jsDelivr CDN).
// Stored as a base name only; the client builds box/snap/title URLs (design §8.5).
// (Matcher preserved from the original build-n64.js, parameterized by repo.)
'use strict';

const { uniq, deburr, fetchWithTimeout } = require('./util');

const flipArticle = (seg) => {
  const m = seg.match(/^(The|A|An)\s+(.*)$/i);
  return m ? `${m[2]}, ${m[1]}` : seg;
};

// Generate candidate base names (most-likely first).
function artCandidates(title) {
  const t = title.trim().replace(/\s*:\s*/g, ' - ');
  const segs = t.split(' - ');
  // The article flips WITHIN the first title segment, before any subtitle:
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

// Resolve a title to a verified libretro base name (or null). `repo` is e.g.
// 'libretro-thumbnails/Nintendo_-_Nintendo_64@master'. `cache` is title->name.
async function resolveArt(title, repo, cache) {
  if (title in cache) return cache[title];
  const cdn = `https://cdn.jsdelivr.net/gh/${repo}`;
  for (const name of artCandidates(title)) {
    const url = `${cdn}/Named_Boxarts/${encodeURIComponent(name)}.png`;
    try {
      const res = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-0' } }, 8000);
      if (res.ok || res.status === 206) { cache[title] = name; return name; }
    } catch { /* timeout/network — try next candidate */ }
  }
  // don't cache misses — lets re-runs retry them as the matcher improves
  return null;
}

module.exports = { resolveArt, artCandidates };
