// randomizer.js — recency-weighted roll over the filtered pool.
// Goal (design doc §7.2): "stop showing me the same thing," not a recommender.
import { state } from './state.js';

// Recently-shown games get a lower weight that decays back to normal over ~2h.
// An explicit veto is handled upstream (blocklist), not here.
function weightFor(game, lastShown, everShown, now, settings) {
  let w = 1;
  const ts = lastShown.get(game.id);
  if (ts != null) {
    const recency = Math.max(0, 1 - (now - ts) / 60000 / 120); // 1 at t=0 → 0 after 120 min
    w *= 1 - 0.9 * recency;
  }
  if (settings.favorNeverRolled && !everShown.has(game.id)) w *= 4;
  return Math.max(w, 0.02);
}

export function roll(pool) {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];

  const lastShown = new Map();
  const everShown = new Set();
  for (const h of state.history) { everShown.add(h.id); lastShown.set(h.id, h.ts); }

  // Never roll the same game twice in a row.
  const lastRolled = [...state.history].reverse().find((h) => h.action === 'shown' || h.action === 'accepted');
  const candidates = lastRolled ? pool.filter((g) => g.id !== lastRolled.id) : pool;
  const list = candidates.length ? candidates : pool;

  const now = Date.now();
  const weights = list.map((g) => weightFor(g, lastShown, everShown, now, state.settings));
  let total = 0;
  for (const w of weights) total += w;

  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}
