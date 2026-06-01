// ui/profile.js — render the rolled game as the main full-screen view.
import { coverUrl, snapUrl, titleUrl } from '../data.js';
import { pretty, TIME_LABELS, el } from '../util.js';

const PLATFORM_LABELS = { n64: 'Nintendo 64' };

export function renderProfile(container, game, detail) {
  container.innerHTML = '';
  const d = detail || {};
  const wrap = el('div', { class: 'profile' });

  // --- hero: art shown CONTAINED over a blurred backdrop (no ugly crop) ---
  const hero = el('div', { class: 'pf-hero' });
  const bg = el('div', { class: 'pf-bg' });
  hero.append(bg);
  const carousel = el('div', { class: 'carousel' });
  const urls = [coverUrl(game.platform, game.cover), snapUrl(game.platform, game.cover), titleUrl(game.platform, game.cover)].filter(Boolean);
  if (urls.length) {
    urls.forEach((u, i) => {
      const img = new Image();
      img.className = 'shot';
      img.src = u;
      img.onerror = () => img.remove();
      if (i === 0) img.onload = () => { bg.style.backgroundImage = `url("${u}")`; };
      carousel.append(img);
    });
  } else {
    carousel.append(el('div', { class: 'art-fallback' }, el('span', {}, game.title)));
  }
  hero.append(carousel);
  hero.insertAdjacentHTML('beforeend', '<div class="verdict yes">PLAY</div><div class="verdict no">SKIP</div>');
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
  return hero; // main wires swipe gestures onto this element
}
