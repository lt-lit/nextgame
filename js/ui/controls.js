// ui/controls.js — console toggles, time chips, filter drawer, active-filter chips.
// All filter widgets are generated from the facets present in the loaded data.
import { state, save, defaultFilters } from '../state.js';
import { activeFilterCount } from '../filters.js';
import { pretty, TIME_LABELS, TIME_CHIPS, el } from '../util.js';

const PLATFORM_LABELS = { n64: 'Nintendo 64' };
const $ = (id) => document.getElementById(id);

let _facets = { genres: [], modes: [], buckets: [] };
let _onFilters = () => {};
let _onConsoles = () => {};

export function initControls({ onFilters, onConsoles }) {
  _onFilters = onFilters;
  _onConsoles = onConsoles;
  $('clearFilters').addEventListener('click', () => {
    state.filters = defaultFilters();
    afterChange(true);
  });
}

// (Re)build every widget from the current facets + state. Called on load and
// whenever the active console set changes (which changes the facet vocabulary).
export function mount(facets) {
  _facets = facets;
  renderConsoles();
  renderTime();
  renderDrawer();
  renderActive();
  updateDot();
}

// ---- helpers ----
const activeConsoleSet = (manifestConsoles) => new Set(state.activeConsoles ?? manifestConsoles.map((c) => c.id));

function chip(label, on, onclick, opts = {}) {
  const c = el('button', { class: 'chip' + (on ? ' on' : '') + (opts.removable ? ' removable' : ''), onclick });
  c.append(label);
  if (opts.count != null) c.append(el('span', { class: 'count' }, String(opts.count)));
  return c;
}

const has = (arr, v) => arr.includes(v);
const toggle = (arr, v) => (has(arr, v) ? arr.filter((x) => x !== v) : [...arr, v]);

// ---- console chips ----
function renderConsoles() {
  const box = $('consoleChips');
  box.innerHTML = '';
  const consoles = window.__manifest.consoles;
  const active = activeConsoleSet(consoles);
  for (const c of consoles) {
    box.append(chip(c.label, active.has(c.id), () => {
      const next = new Set(active);
      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
      if (next.size === 0) return; // keep at least one console on
      state.activeConsoles = [...next];
      save('activeConsoles');
      _onConsoles();
    }, { count: c.count }));
  }
}

// ---- time-budget chips ----
function renderTime() {
  const box = $('timeChips');
  box.innerHTML = '';
  for (const t of TIME_CHIPS) {
    const on = t.buckets.length > 0 && t.buckets.every((b) => has(state.filters.buckets, b));
    box.append(chip(t.label, on, () => {
      const set = new Set(state.filters.buckets);
      if (on) t.buckets.forEach((b) => set.delete(b));
      else t.buckets.forEach((b) => set.add(b));
      state.filters.buckets = [...set];
      afterChange();
    }));
  }
}

// ---- drawer body: genres, modes, rating ----
function renderDrawer() {
  const body = $('drawerBody');
  body.innerHTML = '';

  if (_facets.genres.length) {
    const wrap = el('div', { class: 'facet' }, el('h3', {}, 'Genre'));
    const row = el('div', { class: 'chip-row', style: 'padding:0' });
    for (const { value, count } of _facets.genres) {
      const on = has(state.filters.genres, value);
      const c = chip(pretty(value), on, (e) => {
        state.filters.genres = toggle(state.filters.genres, value);
        e.currentTarget.classList.toggle('on');
        afterChange();
      }, { count });
      row.append(c);
    }
    wrap.append(row);
    body.append(wrap);
  }

  if (_facets.modes.length) {
    const wrap = el('div', { class: 'facet' }, el('h3', {}, 'Players'));
    const row = el('div', { class: 'chip-row', style: 'padding:0' });
    for (const { value, count } of _facets.modes) {
      const on = has(state.filters.modes, value);
      row.append(chip(pretty(value), on, (e) => {
        state.filters.modes = toggle(state.filters.modes, value);
        e.currentTarget.classList.toggle('on');
        afterChange();
      }, { count }));
    }
    wrap.append(row);
    body.append(wrap);
  }

  // rating
  const r = state.filters.rating;
  const wrap = el('div', { class: 'facet' }, el('h3', {}, 'Score'));
  const valSpan = el('span', { class: 'slider-val' }, r.min ? String(r.min) : 'any');
  const range = el('input', { type: 'range', min: '0', max: '95', step: '5', value: String(r.min) });
  range.addEventListener('input', () => {
    r.min = +range.value;
    valSpan.textContent = r.min ? String(r.min) : 'any';
    _onFilters();
  });
  range.addEventListener('change', () => afterChange());
  wrap.append(el('div', { class: 'slider-row' }, el('span', { class: 'k', style: 'color:var(--muted)' }, 'min'), range, valSpan));

  wrap.append(toggleRow('Only rated games', 'Most retro titles have no score — leave off to keep them in the pool.', r.onlyRated, (on) => { r.onlyRated = on; afterChange(); }));
  wrap.append(toggleRow('Favor never-rolled', 'Bias the roll toward games you have not seen yet.', state.settings.favorNeverRolled, (on) => { state.settings.favorNeverRolled = on; save('settings'); }));
  body.append(wrap);
}

function toggleRow(label, sub, on, onChange) {
  const sw = el('div', { class: 'switch' + (on ? ' on' : '') });
  const row = el('div', { class: 'toggle' },
    el('div', { class: 'lbl' }, label, el('small', {}, sub)), sw);
  row.addEventListener('click', () => { const next = !sw.classList.contains('on'); sw.classList.toggle('on', next); onChange(next); });
  return row;
}

// ---- active-filter chips (removable, on the main screen) ----
function renderActive() {
  const box = $('activeChips');
  box.innerHTML = '';
  const f = state.filters;
  const add = (label, remove) => box.append(chip(label, true, () => { remove(); afterChange(true); }, { removable: true }));
  f.genres.forEach((g) => add(pretty(g), () => { f.genres = f.genres.filter((x) => x !== g); }));
  f.modes.forEach((m) => add(pretty(m), () => { f.modes = f.modes.filter((x) => x !== m); }));
  f.buckets.forEach((b) => add(TIME_LABELS[b] || b, () => { f.buckets = f.buckets.filter((x) => x !== b); }));
  if (f.rating.min > 0) add(`★ ≥ ${f.rating.min}`, () => { f.rating.min = 0; });
  if (f.rating.onlyRated) add('Rated only', () => { f.rating.onlyRated = false; });
  box.hidden = box.children.length === 0;
}

function updateDot() { $('filterDot').hidden = activeFilterCount(state.filters) === 0; }

function afterChange(rebuildDrawer = false) {
  save('filters');
  renderTime();
  renderActive();
  updateDot();
  if (rebuildDrawer) renderDrawer();
  _onFilters();
}
