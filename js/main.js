// main.js — orchestrates load → filter → roll → profile, and the swipe loop.
import { loadManifest, slimUnion, getDetail, coverUrl } from './data.js';
import { state, pushHistory, vetoId, resetAll } from './state.js';
import { collectFacets, applyFilters } from './filters.js';
import { roll } from './randomizer.js';
import { renderProfile } from './ui/profile.js';
import { initControls, mount } from './ui/controls.js';
import { el } from './util.js';

const $ = (id) => document.getElementById(id);

let slim = [];      // slim union across active consoles
let pool = [];      // current filtered pool
let current = null; // last rolled game

// ---------- boot ----------
(async function boot() {
  const m = await loadManifest();
  window.__manifest = m;
  if (!state.activeConsoles) state.activeConsoles = m.consoles.map((c) => c.id);

  initControls({ onFilters: recompute, onConsoles: reloadConsoles });
  await reloadConsoles();
  wireUI();
})().catch((e) => {
  $('cardArea').innerHTML = `<div class="empty-prompt"><p>Couldn't load data.<br><small>${e.message}</small></p></div>`;
});

async function reloadConsoles() {
  slim = await slimUnion(state.activeConsoles);
  mount(collectFacets(slim));
  recompute();
}

function recompute() {
  pool = applyFilters(slim, state.filters, state.blocklist);
  $('matchCount').textContent = pool.length;
  $('drawerCount').textContent = pool.length;
  const roll = $('rollBtn');
  roll.disabled = pool.length === 0;
  roll.style.opacity = pool.length === 0 ? '.45' : '';
}

// ---------- roll loop ----------
function doRoll() {
  if (!pool.length) return;
  const btn = $('rollBtn');
  btn.classList.remove('rolling'); void btn.offsetWidth; btn.classList.add('rolling');
  if (state.settings.haptics && navigator.vibrate) navigator.vibrate(12);

  current = roll(pool);
  pushHistory(current.id, 'shown');
  renderCard(current);
  openSheet(current);
}

function addFallback(card, game) {
  card.append(el('div', { class: 'art-fallback' }, el('span', {}, game.title)));
}

function renderCard(game) {
  const area = $('cardArea');
  area.innerHTML = '';
  const card = el('div', { class: 'game-card', onclick: () => openSheet(game) });
  const url = coverUrl(game.platform, game.cover);
  if (url) {
    const img = el('img', { class: 'cover', src: url });
    img.onerror = () => { img.remove(); addFallback(card, game); };
    card.append(img);
  } else {
    addFallback(card, game);
  }
  card.insertAdjacentHTML('beforeend', '<div class="scrim"></div><div class="tap-hint">tap for details</div>');
  const info = el('div', { class: 'card-info' });
  info.innerHTML = `<h2>${game.title}</h2><div class="sub">${(window.__manifest.consoles.find((c) => c.id === game.platform) || {}).label || game.platform}${game.year ? ' · ' + game.year : ''}</div>`;
  const tags = el('div', { class: 'mini-tags' });
  if (game.rating != null) tags.insertAdjacentHTML('beforeend', `<span class="mini-tag rate">★ ${game.rating}</span>`);
  game.genres.slice(0, 3).forEach((g) => tags.insertAdjacentHTML('beforeend', `<span class="mini-tag">${g.replace(/-/g, ' ')}</span>`));
  info.append(tags);
  card.append(info);
  area.append(card);
}

// ---------- profile sheet ----------
function openSheet(game) {
  $('sheetBackdrop').hidden = false;
  $('sheet').classList.add('open');
  const body = $('sheetBody');
  body.innerHTML = '<div style="padding:60px 0;text-align:center;color:var(--muted)">loading…</div>';
  getDetail(game).then((d) => { const zone = renderProfile(body, game, d); wireSwipe(zone, game); });
}
function closeSheet() { $('sheet').classList.remove('open'); $('sheetBackdrop').hidden = true; }

function accept(game) {
  pushHistory(game.id, 'accepted');
  current = game;
  renderCard(game);
  closeSheet();
  toast(`Tonight: ${game.title} 🎮`);
}

// horizontal swipe on the art zone: right = play, left = reroll
function wireSwipe(zone, game) {
  let startX = 0, startY = 0, dx = 0, active = false, axis = '';
  const yes = zone.querySelector('.verdict.yes');
  const no = zone.querySelector('.verdict.no');
  const reset = () => { zone.style.transition = 'transform .2s'; zone.style.transform = ''; yes.style.opacity = 0; no.style.opacity = 0; };

  zone.addEventListener('pointerdown', (e) => { startX = e.clientX; startY = e.clientY; active = true; axis = ''; zone.style.transition = 'none'; });
  zone.addEventListener('pointermove', (e) => {
    if (!active) return;
    const ddx = e.clientX - startX, ddy = e.clientY - startY;
    if (!axis) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      axis = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y';
      if (axis === 'y') { active = false; return; } // let the sheet scroll vertically
      zone.setPointerCapture(e.pointerId);
    }
    dx = ddx;
    zone.style.transform = `translateX(${dx}px) rotate(${dx * 0.03}deg)`;
    yes.style.opacity = dx > 0 ? Math.min(1, dx / 120) : 0;
    no.style.opacity = dx < 0 ? Math.min(1, -dx / 120) : 0;
  });
  const end = () => {
    if (!active && axis !== 'x') { reset(); return; }
    active = false;
    const decided = dx;
    reset();
    dx = 0;
    if (decided > 110) accept(game);
    else if (decided < -110) doRoll();
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  let t = $('toast');
  if (!t) {
    t = el('div', { id: 'toast' });
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0));transform:translateX(-50%);background:#000c;color:#fff;padding:11px 18px;border-radius:999px;font-weight:700;font-size:14px;z-index:50;transition:opacity .3s;border:1px solid var(--line)';
    document.body.append(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
}

// ---------- wiring ----------
function wireUI() {
  $('rollBtn').addEventListener('click', doRoll);
  $('rerollBtn').addEventListener('click', doRoll);
  $('acceptBtn').addEventListener('click', () => current && accept(current));

  $('filterBtn').addEventListener('click', () => { $('drawerBackdrop').hidden = false; $('drawer').classList.add('open'); });
  const closeDrawer = () => { $('drawer').classList.remove('open'); $('drawerBackdrop').hidden = true; };
  $('applyFilters').addEventListener('click', closeDrawer);
  $('drawerBackdrop').addEventListener('click', closeDrawer);
  $('sheetBackdrop').addEventListener('click', closeSheet);

  // explicit veto (delegated)
  $('sheetBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-veto]');
    if (!b) return;
    vetoId(b.dataset.veto);
    recompute();
    doRoll();
  });

  $('resetBtn').addEventListener('click', () => {
    if (confirm('Reset all filters, history and vetoes on this device?')) { resetAll(); location.reload(); }
  });
}
