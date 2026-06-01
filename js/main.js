// main.js — orchestrates load → filter → roll → profile, and the swipe loop.
// The rolled game IS the main view; the persistent bottom bar drives the loop.
import { loadManifest, slimUnion, getDetail } from './data.js';
import { state, pushHistory, vetoId, resetAll } from './state.js';
import { collectFacets, applyFilters } from './filters.js';
import { roll } from './randomizer.js';
import { renderProfile } from './ui/profile.js';
import { initControls, mount } from './ui/controls.js';
import { el } from './util.js';

const $ = (id) => document.getElementById(id);

let slim = [];
let pool = [];
let current = null;

// ---------- boot ----------
(async function boot() {
  const m = await loadManifest();
  window.__manifest = m;
  if (!state.activeConsoles) state.activeConsoles = m.consoles.map((c) => c.id);

  initControls({ onFilters: recompute, onConsoles: reloadConsoles });
  await reloadConsoles();
  wireUI();
})().catch((e) => {
  $('view').innerHTML = `<div class="empty-prompt"><p>Couldn't load data.<br><small>${e.message}</small></p></div>`;
});

async function reloadConsoles() {
  slim = await slimUnion(state.activeConsoles);
  mount(collectFacets(slim));
  recompute();
}

function recompute() {
  pool = applyFilters(slim, state.filters, state.blocklist);
  $('poolCount').textContent = pool.length;
  $('drawerCount').textContent = pool.length;
  const r = $('rollBtn');
  r.disabled = pool.length === 0;
}

// ---------- roll loop ----------
function doRoll() {
  if (!pool.length) return;
  const btn = $('rollBtn');
  btn.classList.remove('rolling'); void btn.offsetWidth; btn.classList.add('rolling');
  if (state.settings.haptics && navigator.vibrate) navigator.vibrate(12);

  current = roll(pool);
  pushHistory(current.id, 'shown');
  showGame(current);
}

function showGame(game) {
  const view = $('view');
  view.scrollTop = 0;
  getDetail(game).then((d) => {
    const hero = renderProfile(view, game, d);
    wireSwipe(hero, game);
  });
  $('rollBtn').textContent = '↻ Roll again';
  $('acceptBtn').hidden = false;
}

function accept(game) {
  if (!game) return;
  pushHistory(game.id, 'accepted');
  current = game;
  toast(`Tonight: ${game.title} 🎮`);
}

// horizontal swipe on the hero art: right = play, left = reroll. Vertical scrolls.
function wireSwipe(hero, game) {
  let startX = 0, startY = 0, dx = 0, active = false, axis = '';
  const yes = hero.querySelector('.verdict.yes');
  const no = hero.querySelector('.verdict.no');
  const reset = () => { hero.style.transition = 'transform .2s'; hero.style.transform = ''; yes.style.opacity = 0; no.style.opacity = 0; };

  hero.addEventListener('pointerdown', (e) => { startX = e.clientX; startY = e.clientY; active = true; axis = ''; hero.style.transition = 'none'; });
  hero.addEventListener('pointermove', (e) => {
    if (!active) return;
    const ddx = e.clientX - startX, ddy = e.clientY - startY;
    if (!axis) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      axis = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y';
      if (axis === 'y') { active = false; return; }
      hero.setPointerCapture(e.pointerId);
    }
    dx = ddx;
    hero.style.transform = `translateX(${dx}px) rotate(${dx * 0.025}deg)`;
    yes.style.opacity = dx > 0 ? Math.min(1, dx / 120) : 0;
    no.style.opacity = dx < 0 ? Math.min(1, -dx / 120) : 0;
  });
  const end = () => {
    if (axis !== 'x') { active = false; reset(); return; }
    active = false;
    const decided = dx; dx = 0; reset();
    if (decided > 110) accept(game);
    else if (decided < -110) doRoll();
  };
  hero.addEventListener('pointerup', end);
  hero.addEventListener('pointercancel', end);
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
  $('acceptBtn').addEventListener('click', () => accept(current));

  $('filterBtn').addEventListener('click', () => { $('drawerBackdrop').hidden = false; $('drawer').classList.add('open'); });
  const closeDrawer = () => { $('drawer').classList.remove('open'); $('drawerBackdrop').hidden = true; };
  $('applyFilters').addEventListener('click', closeDrawer);
  $('drawerBackdrop').addEventListener('click', closeDrawer);

  // explicit veto (delegated)
  $('view').addEventListener('click', (e) => {
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
