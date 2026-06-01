// ui/profile.js — render the game profile into the bottom sheet.
import { coverUrl, snapUrl, titleUrl } from '../data.js';
import { pretty, TIME_LABELS } from '../util.js';

const PLATFORM_LABELS = { n64: 'Nintendo 64' };

// Build a carousel image that hides itself if the art 404s.
function shot(url) {
  const img = new Image();
  img.className = 'shot';
  img.loading = 'lazy';
  img.src = url;
  img.onerror = () => img.remove();
  return img;
}

export function renderProfile(body, game, detail) {
  body.innerHTML = '';
  const d = detail || {};

  // --- swipeable art carousel (boxart → in-game snap → title screen) ---
  const zone = document.createElement('div');
  zone.className = 'swipe-zone';
  const carousel = document.createElement('div');
  carousel.className = 'carousel';
  const urls = [coverUrl(game.platform, game.cover), snapUrl(game.platform, game.cover), titleUrl(game.platform, game.cover)].filter(Boolean);
  if (urls.length) {
    urls.forEach((u) => carousel.append(shot(u)));
  } else {
    const fb = document.createElement('div');
    fb.className = 'art-fallback';
    fb.innerHTML = `<span>${game.title}</span>`;
    carousel.append(fb);
  }
  zone.append(carousel);
  zone.insertAdjacentHTML('beforeend', '<div class="verdict yes">PLAY</div><div class="verdict no">SKIP</div>');
  body.append(zone);

  // --- text block ---
  const pad = document.createElement('div');
  pad.className = 'profile-pad';

  const sub = [PLATFORM_LABELS[game.platform] || game.platform, game.year].filter(Boolean).join(' · ');
  pad.innerHTML = `<h2>${game.title}</h2><div class="sub">${sub}</div>`;

  // badges: score, time, genres, modes
  const badges = document.createElement('div');
  badges.className = 'badges';
  if (game.rating != null) badges.insertAdjacentHTML('beforeend', `<span class="badge score">★ ${game.rating}</span>`);
  if (game.hltbBucket) badges.insertAdjacentHTML('beforeend',
    `<span class="badge time placeholder" title="Estimated — real HowLongToBeat data not yet wired in">~${TIME_LABELS[game.hltbBucket]}</span>`);
  for (const g of game.genres) badges.insertAdjacentHTML('beforeend', `<span class="badge">${pretty(g)}</span>`);
  for (const m of game.modes) badges.insertAdjacentHTML('beforeend', `<span class="badge">${pretty(m)}</span>`);
  pad.append(badges);

  if (d.summary) {
    const s = document.createElement('p');
    s.className = 'summary';
    s.textContent = d.summary;
    pad.append(s);
  }

  const kv = [];
  if (d.developer) kv.push(`<div class="kv"><span class="k">Developer</span><span>${d.developer}</span></div>`);
  if (d.publisher) kv.push(`<div class="kv"><span class="k">Publisher</span><span>${d.publisher}</span></div>`);
  if (kv.length) pad.insertAdjacentHTML('beforeend', kv.join(''));

  // link-outs: Wikipedia (read more) + YouTube gameplay search (no API/quota)
  const links = document.createElement('div');
  links.className = 'links';
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(game.title + ' ' + (PLATFORM_LABELS[game.platform] || '') + ' gameplay')}`;
  links.insertAdjacentHTML('beforeend', `<a class="link-btn play" href="${yt}" target="_blank" rel="noopener">▶ Watch gameplay</a>`);
  if (d.links && d.links.wikipedia) links.insertAdjacentHTML('beforeend', `<a class="link-btn" href="${d.links.wikipedia}" target="_blank" rel="noopener">Read more</a>`);
  pad.append(links);

  // explicit veto (distinct from a casual reroll)
  const veto = document.createElement('div');
  veto.className = 'veto-row';
  veto.innerHTML = `<button class="veto-btn" data-veto="${game.id}">🚫 Don't show me this again</button>`;
  pad.append(veto);

  if (game.rating == null) pad.insertAdjacentHTML('beforeend',
    '<p class="note">No aggregate score — most retro titles predate Metacritic, so this is normal. It still passes rating filters unless "only rated" is on.</p>');

  body.append(pad);
  return zone; // main wires swipe gestures onto this element
}
