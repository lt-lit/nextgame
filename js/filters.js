// filters.js — facet collection + pool filtering.
// "Everything is a facet": the filter UI is generated from whatever the loaded
// data contains, so adding tags/genres never needs new filter code.

// Tally every facet value across the loaded slim union, sorted by frequency.
export function collectFacets(slim) {
  const tally = (key) => {
    const m = new Map();
    for (const g of slim) for (const v of (g[key] || [])) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  };
  const buckets = new Map();
  for (const g of slim) if (g.hltbBucket) buckets.set(g.hltbBucket, (buckets.get(g.hltbBucket) || 0) + 1);
  return {
    genres: tally('genres'),
    modes: tally('modes'),
    buckets: [...buckets.entries()].map(([value, count]) => ({ value, count })),
  };
}

// Standard faceted-search semantics: AND across facets, OR within a facet.
// Rating: unrated games PASS by default (most of the retro catalog is unrated);
// the `onlyRated` toggle is what excludes them. (Design doc §7.3.)
export function applyFilters(slim, filters, blocklist) {
  const blockedGenres = new Set(blocklist.genres);
  const blockedIds = new Set(blocklist.ids);
  const { genres, modes, buckets, rating } = filters;
  return slim.filter((g) => {
    if (blockedIds.has(g.id)) return false;
    if (g.genres.some((x) => blockedGenres.has(x))) return false;
    if (genres.length && !genres.some((x) => g.genres.includes(x))) return false;
    if (modes.length && !modes.some((x) => g.modes.includes(x))) return false;
    if (buckets.length && !buckets.includes(g.hltbBucket)) return false;
    if (rating.onlyRated && g.rating == null) return false;
    if (rating.min > 0 && g.rating != null && g.rating < rating.min) return false;
    return true;
  });
}

// Count of currently active filter constraints (for the UI badge).
export function activeFilterCount(filters) {
  return filters.genres.length + filters.modes.length + filters.buckets.length
    + (filters.rating.min > 0 ? 1 : 0) + (filters.rating.onlyRated ? 1 : 0);
}
