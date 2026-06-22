// data.js — manifest load + two-tier (slim/fat) lazy loading with in-memory cache.
// Paths are relative so this works under GitHub Pages project subpaths (/<repo>/).

const DATA_ROOT = 'data';
const CDN = 'https://cdn.jsdelivr.net/gh';

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
function artUrl(platform, kind, base) {
  const repo = ART_REPO[platform];
  return repo && base ? `${CDN}/${repo}/${kind}/${encodeURIComponent(base)}.png` : null;
}
export const coverUrl = (platform, base) => artUrl(platform, 'Named_Boxarts', base);
export const snapUrl  = (platform, base) => artUrl(platform, 'Named_Snaps', base);
export const titleUrl = (platform, base) => artUrl(platform, 'Named_Titles', base);
