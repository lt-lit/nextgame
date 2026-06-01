// ui/profile.js — render the rolled game as the main full-screen view.
import { coverUrl, snapUrl, titleUrl } from '../data.js';
import { pretty, TIME_LABELS, el } from '../util.js';

const PLATFORM_LABELS = { n64: 'Nintendo 64' };
let _stopCarousel = null; // tears down the previous game's auto-advance timer

export function renderProfile(container, game, detail) {
  if (_stopCarousel) { _stopCarousel(); _stopCarousel = null; }
  container.innerHTML = '';
  const d = detail || {};
  const wrap = el('div', { class: 'profile' });

  // --- hero: art carousel (contained over a blurred backdrop) ---
  const hero = el('div', { class: 'pf-hero' });
  _stopCarousel = buildCarousel(hero, game);
  wrap.append(hero);

  // --- details ---
  const pad = el('div', { class: 'profile-pad' });
  const sub = [PLATFORM_LABELS[game.platform] || game.platform, game.year].filter(Boolean).join(' · ');
  pad.innerHTML = `<h2>${game.title}</h2><div class="sub">${sub}</div>`;

  const badges = el('div', { class: 'badges' });
  if (game.rating != null) badges.insertAdjacentHTML('beforeend', `<span class="badge score">★ ${game.rating}</span>`);
  if (game.hltbBucket) badges.insertAdjacentHTML('beforeend',
    `<span class="badge time placeholder" title="Estimated — real HowLongToBeat data not yet wired in">~${TIME_LABELS[game.hltbBucket]}</span>`);
  for (const g of game.genres) badges.insertAdjacentHTML('beforeend', `<span class="badge">${pretty(g)}</span>`);
  for (const m of game.modes) badges.insertAdjacentHTML('beforeend', `<span class="badge">${pretty(m)}</span>`);
  pad.append(badges);

  if (d.summary) { const s = el('p', { class: 'summary' }); s.textContent = d.summary; pad.append(s); }

  const kv = [];
  if (d.developer) kv.push(`<div class="kv"><span class="k">Developer</span><span>${d.developer}</span></div>`);
  if (d.publisher) kv.push(`<div class="kv"><span class="k">Publisher</span><span>${d.publisher}</span></div>`);
  if (kv.length) pad.insertAdjacentHTML('beforeend', kv.join(''));

  const links = el('div', { class: 'links' });
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(game.title + ' ' + (PLATFORM_LABELS[game.platform] || '') + ' gameplay')}`;
  links.insertAdjacentHTML('beforeend', `<a class="link-btn play" href="${yt}" target="_blank" rel="noopener">▶ Watch gameplay</a>`);
  if (d.links && d.links.wikipedia) links.insertAdjacentHTML('beforeend', `<a class="link-btn" href="${d.links.wikipedia}" target="_blank" rel="noopener">Read more</a>`);
  pad.append(links);

  pad.insertAdjacentHTML('beforeend', `<div class="veto-row"><button class="veto-btn" data-veto="${game.id}">🚫 Don't show me this again</button></div>`);

  if (game.rating == null) pad.insertAdjacentHTML('beforeend',
    '<p class="note">No aggregate score — most retro titles predate Metacritic, so this is normal. It still passes rating filters unless "only rated" is on.</p>');

  wrap.append(pad);
  container.append(wrap);
}

// Art carousel with page dots + gentle auto-advance. Images that 404 drop out
// (the dot count follows the images that actually load). Returns a stop() fn.
function buildCarousel(hero, game) {
  const bg = el('div', { class: 'pf-bg' });
  const carousel = el('div', { class: 'carousel' });
  const dots = el('div', { class: 'dots' });
  const urls = [coverUrl(game.platform, game.cover), snapUrl(game.platform, game.cover), titleUrl(game.platform, game.cover)].filter(Boolean);

  if (!urls.length) {
    carousel.append(el('div', { class: 'art-fallback' }, el('span', {}, game.title)));
    hero.append(bg, carousel);
    return () => {};
  }

  urls.forEach((u, i) => {
    const img = new Image();
    img.className = 'shot';
    img.src = u;
    img.onload = () => { if (i === 0 || !bg.style.backgroundImage) bg.style.backgroundImage = `url("${u}")`; refresh(); };
    img.onerror = () => { img.remove(); refresh(); };
    carousel.append(img);
  });
  hero.append(bg, carousel, dots);

  let lastInteract = 0;
  const count = () => carousel.querySelectorAll('.shot').length;
  const current = () => Math.round(carousel.scrollLeft / (carousel.clientWidth || 1));
  const go = (i) => carousel.scrollTo({ left: i * carousel.clientWidth, behavior: 'smooth' });

  const updateActive = () => { const c = current(); [...dots.children].forEach((d, i) => d.classList.toggle('on', i === c)); };
  function refresh() {
    const n = count();
    dots.innerHTML = '';
    if (n <= 1) return; // a single image needs no pager
    for (let i = 0; i < n; i++) {
      const dot = el('span', { class: 'dot' });
      dot.addEventListener('click', () => { go(i); lastInteract = Date.now(); });
      dots.append(dot);
    }
    updateActive();
  }
  carousel.addEventListener('scroll', updateActive, { passive: true });
  carousel.addEventListener('pointerdown', () => { lastInteract = Date.now(); }, { passive: true });

  const timer = setInterval(() => {
    const n = count();
    if (n < 2 || Date.now() - lastInteract < 4500) return; // pause briefly after manual interaction
    go((current() + 1) % n);
  }, 3000);

  return () => clearInterval(timer);
}
