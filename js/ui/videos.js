// ui/videos.js — the 16:9 video stage that sits above the art carousel.
//
// One strip for every video a game has (gameplay first, then trailers, then any
// reviews). Click-to-load facade so no YouTube JS loads until the user opts in
// (or the autoplay setting is on). Uses the IFrame Player API so we can advance
// at a video's end and detect embed-disabled videos at runtime; falls back to a
// plain iframe if the API can't load, and to an "open on YouTube" link if a
// video refuses to embed.
import { ytThumb, ytEmbed, YT_NOCOOKIE_HOST } from '../data.js';
import { state } from '../state.js';
import { el } from '../util.js';

const TYPE_LABEL = { gameplay: 'Gameplay', trailer: 'Trailer', review: 'Review' };

// Accepts both legacy bare-string ids and typed { id, type, title } records, so
// the section works against pre-rebuild data too. De-dupes by id.
function normalizeVideos(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const rec = typeof v === 'string' ? { id: v, type: 'trailer', title: '' } : v;
    if (!rec || !rec.id || seen.has(rec.id)) continue;
    seen.add(rec.id);
    out.push({ id: rec.id, type: rec.type || 'trailer', title: rec.title || '' });
  }
  return out;
}

// Load the IFrame Player API exactly once. Resolves with window.YT, or rejects
// if it doesn't arrive in time (caller then falls back to a plain iframe). The
// rejection isn't cached, so a late-arriving API still gets picked up next time.
let _apiPromise = null;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (_apiPromise) return _apiPromise;
  _apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    const to = setTimeout(() => { _apiPromise = null; reject(new Error('YT API timeout')); }, 6000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(to);
      if (typeof prev === 'function') { try { prev(); } catch {} }
      resolve(window.YT);
    };
    if (!document.getElementById('yt-iframe-api')) {
      document.head.append(el('script', { id: 'yt-iframe-api', src: 'https://www.youtube.com/iframe_api' }));
    }
  });
  return _apiPromise;
}

// Build the section. Returns { node, stop } or null when there are no videos.
export function buildVideoSection(detail) {
  const vids = normalizeVideos(detail && detail.videos);
  if (!vids.length) return null;

  const section = el('div', { class: 'pf-videos' });
  const stage = el('div', { class: 'pf-video-stage' });
  const mount = el('div', { class: 'pf-video-mount' });          // stable container; player lives inside
  const facade = el('button', { class: 'pf-video-facade', 'aria-label': 'Play video' });
  const facadeThumb = el('img', { class: 'pf-video-thumbimg', loading: 'lazy', alt: '' });
  facade.append(facadeThumb, el('span', { class: 'pf-video-play' }, '▶'));
  stage.append(mount, facade);
  section.append(stage);

  // Filmstrip (only worth showing when there's more than one video).
  const chips = vids.map((v, i) => {
    const img = el('img', { class: 'pf-video-chipimg', loading: 'lazy', src: ytThumb(v.id), alt: '',
      onerror: (e) => { e.target.style.visibility = 'hidden'; } });
    const chip = el('button', { class: 'pf-video-chip', onclick: () => select(i, true) },
      img, el('span', { class: 'pf-video-tag' }, TYPE_LABEL[v.type] || 'Video'));
    return chip;
  });
  if (vids.length > 1) section.append(el('div', { class: 'pf-video-strip' }, ...chips));

  let idx = 0;
  let player = null;
  let starting = false;   // a player is being created (API still loading)
  let destroyed = false;
  const dead = new Set(); // indices whose video refused to embed / errored

  const setActiveChip = () => chips.forEach((c, i) => c.classList.toggle('on', i === idx));
  const setFacade = () => { facadeThumb.src = ytThumb(vids[idx].id); };

  // Next playable index after `from`, or -1 (we stop at the end, no looping).
  function nextAlive(from) {
    for (let j = from + 1; j < vids.length; j++) if (!dead.has(j)) return j;
    return -1;
  }

  // Move to video i. play=true actually starts it (a user gesture, or a
  // gesture-blessed auto-advance); otherwise it just stages the thumbnail.
  function select(i, play) {
    if (destroyed || i < 0 || i >= vids.length) return;
    idx = i;
    setActiveChip();
    if (player && player.loadVideoById) {
      stage.classList.add('playing');
      player.loadVideoById(vids[i].id);
    } else if (play) {
      start(false);
    } else {
      setFacade();
    }
  }

  // Create the player on the current video. muted=true is for autoplay-on-open
  // (browsers only allow gesture-less autoplay when muted).
  function start(muted) {
    if (destroyed || player || starting) return;
    starting = true;
    stage.classList.add('playing');
    loadApi().then((YT) => {
      if (destroyed) return;
      const holder = el('div');
      mount.replaceChildren(holder);
      player = new YT.Player(holder, {
        host: YT_NOCOOKIE_HOST,
        videoId: vids[idx].id,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, autoplay: 1, mute: muted ? 1 : 0 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) { const n = nextAlive(idx); if (n >= 0) select(n, true); }
          },
          onError: () => {
            dead.add(idx);
            const n = nextAlive(idx);
            if (n >= 0) select(n, true); else unavailable();
          },
        },
      });
    }).catch(() => { if (!destroyed) injectRawIframe(); }).finally(() => { starting = false; });
  }

  // No Player API available: a plain iframe still plays (just no auto-advance).
  function injectRawIframe() {
    mount.replaceChildren(el('iframe', {
      class: 'pf-video-frame', src: ytEmbed(vids[idx].id, { autoplay: true }), title: 'Video',
      frameborder: '0', allow: 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture',
      allowfullscreen: '',
    }));
  }

  function unavailable() {
    mount.replaceChildren(el('a', { class: 'pf-video-unavail', target: '_blank', rel: 'noopener',
      href: `https://www.youtube.com/watch?v=${vids[idx].id}` }, 'Video unavailable — open on YouTube ↗'));
  }

  facade.addEventListener('click', () => start(false));

  setFacade();
  setActiveChip();
  // Autoplay-on-open (muted) when the user has turned it on in settings.
  if (state.settings && state.settings.autoplayVideos) start(true);

  function stop() {
    destroyed = true;
    try { if (player && player.destroy) player.destroy(); } catch {}
    player = null;
  }

  return { node: section, stop };
}
