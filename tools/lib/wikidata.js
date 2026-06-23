// lib/wikidata.js — the spine: canonical game list + genre/mode/dev/publisher/
// year + Metacritic-where-present + enwiki sitelink, for a given platform QID.
// (Query + parsing preserved from the original build-n64.js, parameterized.)
'use strict';

const { slug, uniq, fetchWithTimeout } = require('./util');

const sparqlFor = (qid) => `
SELECT ?game ?gameLabel ?wiki
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
  (GROUP_CONCAT(DISTINCT ?modeLabel;  separator="|") AS ?modes)
  (GROUP_CONCAT(DISTINCT ?devLabel;   separator="|") AS ?devs)
  (GROUP_CONCAT(DISTINCT ?pubLabel;   separator="|") AS ?pubs)
  (GROUP_CONCAT(DISTINCT ?mc;         separator="|") AS ?metacritic)
  (MIN(?date) AS ?firstDate)
WHERE {
  ?game wdt:P31 wd:Q7889 ;          # instance of: video game
        wdt:P400 wd:${qid} .         # platform
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
  if (l.includes('multiplayer') || l.includes('multi-player')) return 'multiplayer';
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

// Query Wikidata and return the merged, sorted spine for one platform.
// `idFor(title)` builds the namespaced game id (so ids stay stable per console).
async function queryWikidata(qid, idFor) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparqlFor(qid));
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/sparql-results+json' } }, 60000);
  if (!res.ok) throw new Error(`Wikidata SPARQL ${res.status}`);
  const rows = (await res.json()).results.bindings;

  const byId = new Map();
  for (const r of rows) {
    const title = r.gameLabel?.value?.trim();
    if (!title || /^Q\d+$/.test(title)) continue; // skip unlabeled items
    const id = idFor(title);

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

module.exports = { queryWikidata, placeholderBucket };
