// ui/controls.js — the filter drawer (everything filter-related lives here).
// Order is by likely use: Console, Players, Score up top; Length + Genre
// collapsed by default (lots of genres, rarely used).
import { state, save, defaultFilters } from '../state.js';
import { activeFilterCount } from '../filters.js';
import { pretty, TIME_LABELS, el } from '../util.js';

const $ = (id) => document.getElementById(id);
const BUCKET_ORDER = ['short', 'medium', 'long', 'very-long'];

let _facets = { genres: [], modes: [], buckets: [] };
let _onFilters = () => {};
let _onConsoles = () => {};
let _counters = {}; // section key -> selected-count <em>

export function initControls({ onFilters, onConsoles }) {
  _onFilters = onFilters;
  _onConsoles = onConsoles;
  $('clearFilters').addEventListener('click', () => { state.filters = defaultFilters(); afterChange(true); });
}

export function mount(facets) {
  _facets = facets;
  renderDrawer();
  renderActive();
  updateDot();
}

// ---- helpers ----
const has = (a, v) => a.includes(v);
const toggle = (a, v) => (has(a, v) ? a.filter((x) => x !== v) : [...a, v]);

function chip(label, on, onclick, opts = {}) {
  const c = el('button', { class: 'chip' + (on ? ' on' : '') + (opts.removable ? ' removable' : ''), onclick });
  c.append(label);
  if (opts.count != null) c.append(el('span', { class: 'count' }, String(opts.count)));
  return c;
}
const chipRow = () => el('div', { class: 'chip-row', style: 'padding:0' });

// section header; if collapsible, wires a chevron that shows/hides `content`.
function header(title, { collapsible = false, content = null } = {}) {
  const sel = el('em', { class: 'sel hidden' });
  const h = el('div', { class: 'facet-h3' + (collapsible ? ' clickable' : '') }, el('span', { class: 'facet-title' }, title, sel));
  if (collapsible && content) {
    const chev = el('span', { class: 'chev' }, '▸');
    h.append(chev);
    content.hidden = true; // collapsed by default
    h.addEventListener('click', () => { const open = content.hidden; content.hidden = !open; chev.classList.toggle('open', open); });
  }
  return { h, sel };
}

function facet(title, content, opts) {
  const { h, sel } = header(title, { ...opts, content: opts && opts.collapsible ? content : null });
  return { node: el('div', { class: 'facet' }, h, content), sel };
}

function toggleRow(label, sub, on, onChange) {
  const sw = el('div', { class: 'switch' + (on ? ' on' : '') });
  const row = el('div', { class: 'toggle' }, el('div', { class: 'lbl' }, label, el('small', {}, sub)), sw);
  row.addEventListener('click', () => { const n = !sw.classList.contains('on'); sw.classList.toggle('on', n); onChange(n); });
  return row;
}

// ---- drawer ----
function renderDrawer() {
  const body = $('drawerBody');
  body.innerHTML = '';
  _counters = {};

  // Console (library selection)
  {
    const row = chipRow();
    const consoles = window.__manifest.consoles;
    const active = new Set(state.activeConsoles ?? consoles.map((c) => c.id));
    for (const c of consoles) {
      row.append(chip(c.label, active.has(c.id), () => {
        const next = new Set(active);
        next.has(c.id) ? next.delete(c.id) : next.add(c.id);
        if (next.size === 0) return; // keep at least one
        state.activeConsoles = [...next];
        save('activeConsoles');
        _onConsoles();
      }, { count: c.count }));
    }
    body.append(facet('Console', row).node);
  }

  // Players (modes)
  if (_facets.modes.length) {
    const row = chipRow();
    for (const { value, count } of _facets.modes) {
      row.append(chip(pretty(value), has(state.filters.modes, value), (e) => {
        state.filters.modes = toggle(state.filters.modes, value);
        e.currentTarget.classList.toggle('on');
        afterChange();
      }, { count }));
    }
    body.append(facet('Players', row).node);
  }

  // Score (rating)
  {
    const r = state.filters.rating;
    const valSpan = el('span', { class: 'slider-val' }, r.min ? String(r.min) : 'any');
    const range = el('input', { type: 'range', min: '0', max: '95', step: '5', value: String(r.min) });
    range.addEventListener('input', () => { r.min = +range.value; valSpan.textContent = r.min ? String(r.min) : 'any'; _onFilters(); });
    range.addEventListener('change', () => afterChange());
    const sliderRow = el('div', { class: 'slider-row' }, el('span', { class: 'k', style: 'color:var(--muted)' }, 'min'), range, valSpan);
    const onlyRated = toggleRow('Only rated games', 'Most retro titles have no score — off keeps them in.', r.onlyRated, (on) => { r.onlyRated = on; afterChange(); });
    body.append(facet('Score', el('div', {}, sliderRow, onlyRated)).node);
  }

  // Length (time-to-beat) — minor, collapsed
  if (_facets.buckets.length) {
    const row = chipRow();
    const present = new Set(_facets.buckets.map((b) => b.value));
    for (const b of BUCKET_ORDER.filter((x) => present.has(x))) {
      row.append(chip(TIME_LABELS[b], has(state.filters.buckets, b), (e) => {
        state.filters.buckets = toggle(state.filters.buckets, b);
        e.currentTarget.classList.toggle('on');
        afterChange();
      }));
    }
    const content = el('div', { class: 'facet-content' }, row, el('p', { class: 'note', style: 'margin-top:8px' }, 'Rough estimates — not real playtime data yet.'));
    const f = facet('Length', content, { collapsible: true });
    _counters.buckets = f.sel;
    body.append(f.node);
  }

  // Genre — collapsed (long list, rarely used)
  if (_facets.genres.length) {
    const row = chipRow();
    for (const { value, count } of _facets.genres) {
      row.append(chip(pretty(value), has(state.filters.genres, value), (e) => {
        state.filters.genres = toggle(state.filters.genres, value);
        e.currentTarget.classList.toggle('on');
        afterChange();
      }, { count }));
    }
    const content = el('div', { class: 'facet-content' }, row);
    const f = facet('Genre', content, { collapsible: true });
    _counters.genres = f.sel;
    body.append(f.node);
  }

  // Roll behaviour
  body.append(facet('When rolling', toggleRow('Favor never-rolled', 'Bias the roll toward games you have not seen yet.', state.settings.favorNeverRolled, (on) => { state.settings.favorNeverRolled = on; save('settings'); })).node);

  updateCounts();
}

function updateCounts() {
  setSel(_counters.genres, state.filters.genres.length);
  setSel(_counters.buckets, state.filters.buckets.length);
}
function setSel(em, n) { if (!em) return; em.textContent = n ? String(n) : ''; em.classList.toggle('hidden', !n); }

// ---- active-filter chips (top of screen, only when something is set) ----
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
  renderActive();
  updateDot();
  if (rebuildDrawer) renderDrawer(); else updateCounts();
  _onFilters();
}
