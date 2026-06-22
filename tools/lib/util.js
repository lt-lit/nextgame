// lib/util.js — shared helpers for the offline data pipeline.
// (Extracted verbatim from the original build-n64.js so behaviour is preserved,
//  plus normName() for cross-source title matching used by the IGDB stage.)
'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '.cache');
const UA = 'NextGame-prototype/0.1 (personal game picker; spades09@gmail.com)';

const deburr = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

function slug(s) {
  return deburr(String(s).toLowerCase())
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

// Aggressive normalization for matching a title across sources (Wikidata <-> IGDB).
// Drops articles, punctuation, edition noise; keeps word order. Lossy on purpose.
function normName(s) {
  return deburr(String(s).toLowerCase())
    .replace(/&/g, ' and ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\b(game of the year|goty|definitive|complete|collector'?s?|special|deluxe|platinum hits|classics)\b/g, ' ')
    .replace(/\bedition\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

// run `fn` over `items` with bounded concurrency (+ a tiny progress ticker)
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
  if (total) process.stdout.write('\n');
  return out;
}

// simple JSON-file cache keyed by filename, under the gitignored .cache dir
function loadCache(name) {
  try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, name), 'utf8')); } catch { return {}; }
}
function saveCache(name, obj) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify(obj));
}

module.exports = { deburr, slug, uniq, normName, fetchWithTimeout, mapPool, loadCache, saveCache, CACHE_DIR, UA };
