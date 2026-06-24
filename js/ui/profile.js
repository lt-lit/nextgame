// ui/profile.js — render the rolled game as the main full-screen view.
import { coverUrl, screenshotUrl, consoleInfo } from '../data.js';
import { buildVideoSection } from './videos.js';
import { pretty, TIME_LABELS, el } from '../util.js';

const platformLabel = (p) => consoleInfo(p)?.label || p;
let _stopCarousel = null; // tears down the previous game's auto-advance timer
let _stopVideo = null;    // tears down the previous game's video player

export function renderProfile(container, game, detail) {
  if (_stopCarousel) { _stopCarousel(); _stopCarousel = null; }
  if (_stopVideo) { _stopVideo(); _stopVideo = null; }
  container.innerHTML = '';
  const d = detail || {};
  const wrap = el('div', { class: 'profile' });

  // --- title header (top of the page) ---
  const sub = [platformLabel(game.platform), game.year].filter(Boolean).join(' · ');
  const head = el('div', { class: 'pf-head' });
  head.innerHTML = `<h2>${game.title}</h2><div class="sub">${sub}</div>`;
  wrap.append(head);

  // --- videos: a 16:9 stage above the art (gameplay + trailers) ---
  const video = buildVideoSection(d);
  if (video) { _stopVideo = video.stop; wrap.append(video.node); }

  // --- hero: art carousel (contained over a blurred backdrop) ---
  const hero = el('div', { class: 'pf-hero' });
  _stopCarousel = buildCarousel(hero, game, d);
  wrap.append(hero);

  // --- details ---
  const pad = el('div', { class: 'profile-pad' });

  const badges = el('div', { class: 'badges' });
  if (game.rating != null) {
    const title = d.ratingCount ? ` title="${d.ratingCount} ratings"` : '';
    badges.insertAdjacentHTML('beforeend', `<span class="badge score"${title}>★ ${game.rating}</span>`);
  }
  if (game.hltbBucket) badges.insertAdjacentHTML('beforeend',
    `<span class="badge time placeholder" title="Estimated — real HowLongToBeat data not yet wired in">~${TIME_LABELS[game.hltbBucket]}</span>`);
  for (const g of game.genres) badges.insertAdjacentHTML('beforeend', `<span class="badge">${pretty(g)}</span>`);
  for (const m of game.modes) badges.insertAdjacentHTML('beforeend', `<span class="badge">${pretty(m)}</span>`);
  pad.append(badges);

  const reviews = reviewsBlock(d);
  if (reviews) pad.append(reviews);

  if (d.summary) { const s = el('p', { class: 'summary' }); s.textContent = d.summary; pad.append(s); }

  const kv = [];
  if (d.developer) kv.push(`<div class="kv"><span class="k">Developer</span><span>${d.developer}</span></div>`);
  if (d.publisher) kv.push(`<div class="kv"><span class="k">Publisher</span><span>${d.publisher}</span></div>`);
  if (kv.length) pad.insertAdjacentHTML('beforeend', kv.join(''));

  const links = el('div', { class: 'links' });
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(game.title + ' ' + platformLabel(game.platform) + ' gameplay')}`;
  links.insertAdjacentHTML('beforeend', `<a class="link-btn play" href="${yt}" target="_blank" rel="noopener">▶ Watch gameplay</a>`);
  if (d.links && d.links.wikipedia) links.insertAdjacentHTML('beforeend', `<a class="link-btn" href="${d.links.wikipedia}" target="_blank" rel="noopener">Read more</a>`);
  if (d.links && d.links.igdb) links.insertAdjacentHTML('beforeend', `<a class="link-btn" href="${d.links.igdb}" target="_blank" rel="noopener">IGDB</a>`);
  pad.append(links);

  pad.insertAdjacentHTML('beforeend', `<div class="veto-row"><button class="veto-btn" data-veto="${game.id}">🚫 Don't show me this again</button></div>`);

  if (game.rating == null) pad.insertAdjacentHTML('beforeend',
    '<p class="note">No aggregate score — most retro titles predate Metacritic, so this is normal. It still passes rating filters unless "only rated" is on.</p>');

  wrap.append(pad);
  container.append(wrap);
}

// Ordered hero images: cover first, then the screenshot gallery (source-tagged
// records — IGDB shots/artwork, libretro snap/title, or ready URLs). Falsy URLs
// (e.g. an art record that doesn't resolve) drop out.
function mediaUrls(game, d) {
  const out = [coverUrl(game.platform, game.cover)];
  const shots = Array.isArray(d.screenshots) ? d.screenshots : [];
  for (const s of shots.slice(0, 8)) out.push(screenshotUrl(s));
  return out.filter(Boolean);
}

// Per-source review breakdown (IGDB-enriched consoles only). Each row pairs the
// source with its normalized 0–100 score and a bit of context (count or raw scale).
function reviewsBlock(d) {
  if (!Array.isArray(d.reviews) || !d.reviews.length) return null;
  const box = el('div', { class: 'pf-section reviews' });
  box.append(el('div', { class: 'pf-section-h' }, 'Reviews'));
  for (const r of d.reviews) {
    const meta = r.count != null ? `${r.count} ${r.count === 1 ? 'rating' : 'ratings'}` : (r.raw || '');
    const tier = r.score == null ? '' : (r.score >= 75 ? ' good' : r.score >= 60 ? ' ok' : ' weak');
    box.append(el('div', { class: 'review-row' },
      el('span', { class: 'review-src' }, r.source),
      meta ? el('span', { class: 'review-meta' }, meta) : null,
      el('span', { class: 'review-score' + tier }, r.score != null ? String(r.score) : '—'),
    ));
  }
  return box;
}

// Art carousel with page dots + gentle auto-advance. Images that 404 drop out
// (the dot count follows the images that actually load). Returns a stop() fn.
function buildCarousel(hero, game, detail) {
  const bg = el('div', { class: 'pf-bg' });
  const carousel = el('div', { class: 'carousel' });
  const dots = el('div', { class: 'dots' });
  const urls = mediaUrls(game, detail);

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
