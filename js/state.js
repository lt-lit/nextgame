// state.js — localStorage-backed app state, per-device. Namespace: ng.*
// (Aligned the namespace to the app name; the design doc's draft used gr.*)

const NS = 'ng.';
const KEYS = ['activeConsoles', 'filters', 'history', 'blocklist', 'settings'];

const read = (k, d) => {
  try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); }
  catch { return d; }
};
const write = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch {} };

export function defaultFilters() {
  return { genres: [], modes: [], buckets: [], rating: { min: 0, onlyRated: false } };
}

export const state = {
  activeConsoles: read('activeConsoles', null),   // null => default to every console in the manifest
  filters: { ...defaultFilters(), ...read('filters', {}) },
  history: read('history', []),                    // [{ id, ts, action: 'shown'|'accepted'|'vetoed' }]
  blocklist: read('blocklist', { genres: [], ids: [] }),
  settings: read('settings', { favorNeverRolled: false, haptics: true }),
};

export function save(key) { write(key, state[key]); }

export function pushHistory(id, action) {
  state.history.push({ id, ts: Date.now(), action });
  if (state.history.length > 300) state.history = state.history.slice(-300);
  save('history');
}

export function vetoId(id) {
  if (!state.blocklist.ids.includes(id)) state.blocklist.ids.push(id);
  save('blocklist');
  pushHistory(id, 'vetoed');
}

export function resetAll() {
  for (const k of KEYS) localStorage.removeItem(NS + k);
}
