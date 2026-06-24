// lib/youtube.js — build-time, no-API-key gameplay lookup + video assembly.
//
// We resolve "<title> <console> gameplay" to a YouTube video id through YouTube's
// internal InnerTube search — the same endpoint youtube.com's own page calls. The
// "key" below is the public WEB client constant shipped in every YouTube page (not
// a personal key, not secret, no quota, nothing to register), so this keeps the
// build keyless and consistent with the project's no-Worker/no-proxy stance.
//
// Candidates are scored with simple heuristics to skip 10-hour streams, trailers,
// reviews and wrong-game matches, then checked for embeddability via oEmbed. The
// whole thing is best-effort: any failure yields nothing (or keeps a video) rather
// than breaking the build, and the runtime player has its own embed backstop.
'use strict';

const { normName, fetchWithTimeout } = require('./util');

// Public WEB InnerTube client key + a plausible client version. Constants baked
// into youtube.com, not credentials. Bump CLIENT_VERSION if search ever breaks.
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const CLIENT_VERSION = '2.20240620.05.00';
const SEARCH_URL = `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}&prettyPrint=false`;
const FILTER_VIDEO = 'EgIQAQ=='; // protobuf: results type = Video (drops channels/playlists)
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- low-level search -------------------------------------------------------

async function innertubeSearch(query) {
  const res = await fetchWithTimeout(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: CLIENT_VERSION, hl: 'en', gl: 'US' } },
      query,
      params: FILTER_VIDEO,
    }),
  }, 10000);
  if (!res.ok) throw new Error(`InnerTube search ${res.status}`);
  return res.json();
}

// The response is deeply nested and its layout shifts over time, so rather than
// hardcode a path we recursively collect every videoRenderer node, in order.
function collectVideoRenderers(obj, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (obj.videoRenderer && obj.videoRenderer.videoId) out.push(obj.videoRenderer);
  for (const k of Object.keys(obj)) collectVideoRenderers(obj[k], out);
  return out;
}

const runText = (t) => (!t ? '' : (t.simpleText || (t.runs || []).map((r) => r.text).join('')));

// "12:34" / "1:02:03" -> seconds; null when absent (live / upcoming).
function parseDuration(txt) {
  if (!txt || !/^\d+(:\d{1,2})+$/.test(txt)) return null;
  return txt.split(':').reduce((acc, n) => acc * 60 + parseInt(n, 10), 0);
}

function parseCandidate(vr) {
  const length = runText(vr.lengthText);
  return {
    id: vr.videoId,
    title: runText(vr.title),
    channel: runText(vr.ownerText) || runText(vr.longBylineText),
    duration: parseDuration(length),
    live: length === '' || /\bLIVE\b/i.test(JSON.stringify(vr.badges || vr.thumbnailOverlays || [])),
  };
}

function parseSearchResponse(json) {
  return collectVideoRenderers(json).map(parseCandidate);
}

// --- scoring ----------------------------------------------------------------

const MIN_SEC = 60;          // skip < 1 min (ads, intros, shorts)
const MAX_SEC = 30 * 60;     // skip > 30 min (full streams, compilations)
const GOOD = /\b(gameplay|game play|walkthrough|playthrough|long ?play|let'?s play|playing|hd)\b/i;
const BAD = /\b(trailer|review|reaction|unboxing|top \d+|tier list|vs\.?|versus|news|explained|theory|ranking|speedrun|how to|tutorial)\b/i;

// Higher is better; -Infinity means "reject". Requires a sane duration and at
// least one significant game-title token to appear in the candidate's title.
function scoreCandidate(cand, titleTokens) {
  if (!cand.id || cand.live || cand.duration == null) return -Infinity;
  if (cand.duration < MIN_SEC || cand.duration > MAX_SEC) return -Infinity;
  const ctNorm = normName(cand.title);
  const overlap = titleTokens.filter((t) => t.length > 2 && ctNorm.includes(t)).length;
  if (!overlap) return -Infinity;
  let s = overlap * 2;
  if (GOOD.test(cand.title)) s += 4;
  if (BAD.test(cand.title)) s -= 5;
  if (cand.duration >= 180 && cand.duration <= 900) s += 1; // prefer 3–15 min clips
  return s;
}

// Rank + de-dupe candidates for a title, returning typed gameplay records.
function rankGameplay(title, candidates, limit = 1) {
  const titleTokens = normName(title).split(' ').filter(Boolean);
  const ranked = candidates
    .map((c) => ({ c, s: scoreCandidate(c, titleTokens) }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s);
  const seen = new Set();
  const out = [];
  for (const { c } of ranked) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, type: 'gameplay', title: c.title });
    if (out.length >= limit) break;
  }
  return out;
}

// --- video assembly ---------------------------------------------------------

const VIDEO_ORDER = { gameplay: 0, trailer: 1, review: 2 };

// Merge gameplay finds with typed IGDB videos: de-dupe by id, drop ids an
// embeddability map marks false (unknown/absent ids are kept — the runtime has a
// backstop), order gameplay -> trailer -> review, and cap the list.
function mergeVideos(igdbVids = [], gameplayVids = [], embedOk = null, cap = 10) {
  const seen = new Set();
  const out = [];
  for (const v of [...gameplayVids, ...igdbVids]) {
    if (!v || !v.id || seen.has(v.id)) continue;
    if (embedOk && embedOk[v.id] === false) continue;
    seen.add(v.id);
    out.push({ id: v.id, type: v.type || 'trailer', title: v.title || '' });
  }
  out.sort((a, b) => (VIDEO_ORDER[a.type] ?? 9) - (VIDEO_ORDER[b.type] ?? 9));
  return out.slice(0, cap);
}

// --- public (network) API ---------------------------------------------------

// Resolve up to `limit` embeddable-ish gameplay videos for a title. Best-effort:
// returns [] on any error.
async function findGameplay(title, consoleLabel, limit = 1) {
  try {
    const json = await innertubeSearch(`${title} ${consoleLabel} gameplay`);
    return rankGameplay(title, parseSearchResponse(json), limit);
  } catch {
    return [];
  }
}

// oEmbed: 200 = public & embeddable, 401 = private/embedding-disabled, 404 = gone.
// Returns false ONLY on a definitive negative; network errors keep the video
// (true) so a flaky build can't wipe every id.
async function isEmbeddable(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`;
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA } }, 8000);
    if (res.status === 401 || res.status === 403 || res.status === 404) return false;
    return true;
  } catch {
    return true;
  }
}

module.exports = {
  findGameplay, isEmbeddable, mergeVideos, VIDEO_ORDER,
  // exported for offline unit tests:
  parseSearchResponse, parseDuration, scoreCandidate, rankGameplay,
};
