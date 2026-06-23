// data.js — manifest load + two-tier (slim/fat) lazy loading with in-memory cache.
// Paths are relative so this works under GitHub Pages project subpaths (/<repo>/).

const DATA_ROOT = 'data';
const CDN = 'https://cdn.jsdelivr.net/gh';
const IGDB_IMG = 'https://images.igdb.com/igdb/image/upload'; // IGDB image CDN; ids resolve client-side

// libretro thumbnail repo per platform — used to resolve art URLs client-side
// (slim JSON only stores the No-Intro base name, keeping payloads small).
const ART_REPO = {
  n64: 'libretro-thumbnails/Nintendo_-_Nintendo_64@master',
};

let _manifest = null;
const _slim = new Map();    // platform -> slim entry array
const _detail = new Map();  // platform -> { id: fat entry }

export async function loadManifest() {
  if (_manifest) return _manifest;
  const res = await fetch(`${DATA_ROOT}/manifest.json`);
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  _manifest = await res.json();
  return _manifest;
}

export function manifest() { return _manifest; }
export function consoleInfo(id) { return _manifest.consoles.find((c) => c.id === id); }

export async function loadSlim(platform) {
  if (_slim.has(platform)) return _slim.get(platform);
  const res = await fetch(consoleInfo(platform).index);
  const arr = await res.json();
  _slim.set(platform, arr);
  return arr;
}

// Union of slim entries across the active consoles (loads any not yet cached).
export async function slimUnion(platforms) {
  const parts = await Promise.all(platforms.map(loadSlim));
  return parts.flat();
}

// Fat detail is lazy-loaded the first time a profile from that console opens.
export async function getDetail(game) {
  if (!_detail.has(game.platform)) {
    const res = await fetch(consoleInfo(game.platform).detail);
    _detail.set(game.platform, await res.json());
  }
  return _detail.get(game.platform)[game.id] || null;
}

// ---- client-side art URL resolution ----
// Cover art is polymorphic by source: a libretro No-Intro base name (free path,
// e.g. N64) or an IGDB image id wrapped as { src:'igdb', id } (IGDB-enriched,
// e.g. Xbox). Screenshots (IGDB ids) and trailers (YouTube ids) ride in detail.
const igdbImg = (id, size) => (id ? `${IGDB_IMG}/t_${size}/${id}.jpg` : null);

function libretroUrl(platform, kind, base) {
  const repo = ART_REPO[platform];
  return repo && base ? `${CDN}/${repo}/${kind}/${encodeURIComponent(base)}.png` : null;
}

export function coverUrl(platform, cover) {
  if (!cover) return null;
  if (typeof cover === 'object') return cover.src === 'igdb' ? igdbImg(cover.id, 'cover_big') : null;
  return libretroUrl(platform, 'Named_Boxarts', cover); // legacy string => libretro boxart
}
// Secondary libretro art (snap/title) only applies to string-named covers;
// IGDB covers carry a screenshots gallery in detail instead.
export const snapUrl  = (platform, cover) => (typeof cover === 'string' ? libretroUrl(platform, 'Named_Snaps', cover) : null);
export const titleUrl = (platform, cover) => (typeof cover === 'string' ? libretroUrl(platform, 'Named_Titles', cover) : null);
export const screenshotUrl = (id) => igdbImg(id, '720p');
export const ytThumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
export const ytEmbed = (id) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
