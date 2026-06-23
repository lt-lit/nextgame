# NextGame — Design Document

> **Working title:** "NextGame" (working stand-in — may change).
> **Purpose:** A mobile-first, static personal webapp that picks something to play from entire console libraries, using extensive faceted filters plus a randomizer, and shows a rich profile for the chosen game.
> **Audience for this doc:** Claude Code (implementation handoff). Decisions below are settled unless flagged in §13.
>
> **Status (evolved during prototyping):** Two libraries — **N64** and **Xbox (original)** — are built and deployed on GitHub Pages, **both IGDB-enriched** (covers, screenshot + key-art galleries, trailers, per-source ratings) over a Wikidata spine, with meaty Wikipedia descriptions (full lead section) and libretro art (N64 box/snap/title). Cover and screenshot records are **source-tagged** and resolved to URLs client-side, so one gallery blends IGDB media, libretro snap/title, and ready-made URLs. Remaining gap: a true **≥5 screenshots for every game** is capped by IGDB's retro holdings (~⅓–½ of titles) — closing it needs a richer screenshot source (e.g. a MobyGames/TheGamesDB key), which the `{ src:'url', url }` record type already accommodates. Several original assumptions changed in contact with reality — this doc reflects the current vision; see §0 for the diff.

---

## 0. What changed from the original plan

The prototype reshaped several decisions. The headline changes:

- **Sources are free-first.** The spine is **Wikidata** (not raw No-Intro/Redump DATs); art is **libretro-thumbnails** (No-Intro–named, via the jsDelivr CDN); descriptions + magazine review scores are **Wikipedia**. IGDB moves from "source of everything" to an **optional enrichment layer** behind one free key. HowLongToBeat is **bot-blocked** and demoted.
- **The rolled game is the main view**, not a bottom sheet. (A sheet implies a background you return to; here the game *is* the content.)
- **No swipe-to-decide.** It clashed with swiping the screenshot carousel; the `Roll again` / `I'll play this` buttons cover it.
- **Time-to-beat is a minor, collapsed filter**, not a hero feature. The main screen has no time chips.
- **All filters live in one drawer**, prioritized by use (Players + Score up top; Genre + Length collapsed). Console selection lives there too — nothing filter-related sits on the main screen.
- **Ratings show a per-source breakdown** (incl. old magazines), not a single opaque number.
- **localStorage namespace is `ng.*`** (was `gr.*`).

---

## 1. Overview & goals

A personal toy for answering "what should I play tonight?" by rolling a random game out of a filtered pool drawn from **complete console libraries** (not an owned-backlog subset — assume access to any game on a given console). Filters narrow the pool; a roll picks one; a profile view gives enough context to decide.

**The one framing that drives every decision:** this is a **decision aid over a fixed, finite, mostly-retro library**, *not* a discovery/recommendation engine. Prior art (Pangamea, Ludocene, etc.) all solve the opposite problem — finding *new* games to acquire from the marketplace, with taste-learning recommenders and store links. This app deliberately does **none** of that. No recommendations, no taste model, no "games you might buy." Keep that boundary firm — it prevents scope creep.

---

## 2. Non-negotiable constraints (the established workflow)

- **Vanilla JS, no framework, no build tools.** Native ES modules (`<script type="module">`), plain HTML/CSS. No bundler, no transpile step, nothing that needs compiling before it serves.
- **Hosted on GitHub Pages**, served straight from the repo. Claude Code commits to GitHub; Pages serves.
- **Pure static serve path.** No backend, no server-side code reachable at runtime. (The data pipeline in §5 is an *offline* tool, run on demand — never served, never hit by the browser.)
- **No runtime API calls.** All game data is pre-baked into static JSON. The only runtime *network* the browser does is **hotlinking images** (libretro via jsDelivr, and IGDB's CDN once enriched) and **YouTube links** (§8). These are public CDNs — **no key, no Worker, no proxy**.
- **Credentials are free and build-time only.** The free path needs none. The one accepted credential is a **free IGDB/Twitch key**, used only by the offline pipeline (env var, never committed, never in the browser). Because nothing authenticated runs at runtime, **no Cloudflare Worker is needed** (unlike VibeTutor's runtime pattern).
- **State is `localStorage`, per-device.** No cross-device sync — explicitly out of scope (§12). Tested primarily in a mobile browser.

---

## 3. Architecture overview

```
                    OFFLINE (build pipeline, run on demand — /tools, Node)
   Wikidata (SPARQL) ────────┐  game list + genre/mode/dev/publisher/year + Metacritic
   libretro-thumbnails ──────┤  box / snap / title art, keyed by No-Intro filename
   Wikipedia (REST + parse) ─┤  summaries + "Reception" magazine review scores
   IGDB (Twitch OAuth) ──────┤  screenshot galleries, trailer IDs, ratings  [free key]
   Reddit (exploratory) ─────┘  short real user-opinion quotes
                                       │  build scripts → enrich, dedup, normalize
                                       ▼
                                 /data/*.json  ──►  committed to repo
                                       │
                    RUNTIME (pure static, in the browser)
   index.html + /js + /css  ◄── GitHub Pages ◄──┘
        │
        ├─ fetch() static JSON ──► filter / roll / profile
        └─ hotlink images (libretro jsDelivr CDN, IGDB CDN) + YouTube links
```

### 3.1 Data is generated, not fetched live
A Node pipeline ingests the sources, enriches, dedupes, normalizes, and emits static JSON committed to the repo. Re-run **only when adding/updating a console** or refreshing data. Any credential (just IGDB) lives in an env var on the build machine and is **never committed**; nothing authenticated is reachable at runtime.

### 3.2 Two-tier data (the key perf decision)
At many games across many consoles, a single payload is too heavy for mobile. Split into:
- **Slim index** (per console): the minimum needed to filter, roll, and browse. Always loaded for *active* consoles.
- **Fat detail** (per console): everything the profile needs (screenshots, summary, video IDs, review breakdown, social quotes, links). **Lazy-loaded** the first time a profile from that console opens, then kept in memory.

### 3.3 Lazy-load by active console
The user toggles which consoles are "active" (in the filter drawer). Only active consoles' slim indexes load. Filters and the randomizer operate over the **union of active consoles**, bounding the in-memory payload regardless of total library size.

---

## 4. Data model

### 4.1 "Everything is a facet"
Every filterable dimension is either a typed field or a tag in a namespace. Adding a category means **adding tags to entries — never a schema change and never new filter code**. The filter UI is generated from whatever facets exist in the loaded data.

### 4.2 Stable IDs and dedup
- ID format: `"{platform}:{slug}"` (e.g. `n64:the-legend-of-zelda-ocarina-of-time`). The slug function is **frozen** — IDs must stay stable across re-runs, because `localStorage` history/blocklist reference them.
- Dedup regional/revision duplicates down to **one entry per game**, preferring USA/NTSC-U. (For the Wikidata-based prototype this is dedup-by-slug; raw-DAT canonicalization remains the ideal for a fuller set.)

### 4.3 Slim index entry (current shape)
```json
{
  "id": "n64:the-legend-of-zelda-ocarina-of-time",
  "title": "The Legend of Zelda: Ocarina of Time",
  "platform": "n64",
  "year": 1998,
  "genres": ["action-adventure"],
  "modes": ["singleplayer"],
  "rating": 99,
  "hltbBucket": "long",
  "cover": "Legend of Zelda, The - Ocarina of Time (USA)",
  "tags": []
}
```
- `cover` is the **libretro No-Intro base name**; the client resolves it to box/snap/title URLs (§8.5) to keep JSON small.
- `rating` is the **headline aggregate** (0–100) used by the rating filter, computed from whatever sources exist (Metacritic / Wikipedia reception / IGDB). May be `null` — unrated games pass the rating filter by default (§7.3).
- `hltbBucket` is currently a **placeholder** (genre heuristic), flagged in the UI until real playtime data lands.

### 4.4 Fat detail entry (current + planned)
```json
{
  "id": "n64:the-legend-of-zelda-ocarina-of-time",
  "developer": "Nintendo",
  "publisher": "Nintendo",
  "summary": "…Wikipedia extract…",
  "screenshots": ["sc1abc", "sc1def"],      // IGDB image_ids (after enrichment)
  "videos": ["dQw4w9WgXcQ"],                  // YouTube IDs from IGDB (after enrichment)
  "reviews": [                                 // per-source breakdown, normalized 0–100
    { "source": "N64 Magazine", "raw": "98%", "score": 98 },
    { "source": "EGM", "raw": "9.5/10", "score": 95 },
    { "source": "IGDB (users)", "raw": null, "score": 96, "count": 1840 }
  ],
  "social": [                                  // exploratory: real UGC quotes
    { "source": "r/n64", "quote": "…", "url": "https://…" }
  ],
  "links": { "wikipedia": "https://…" },
  "hltb": null,
  "trivia": null
}
```
`reviews`/`social`/`screenshots`/`videos` fill in as enrichment runs; all optional.

### 4.5 Facet namespaces (extensible)
- `platform` — `n64`, … (one per console added).
- `genres`, `modes` — from Wikidata/IGDB. **Note:** the genre vocabulary is *lumpy* (Wikidata's taxonomy has long-tail one-off tags like `photography`, `personal-watercraft-racing`). The UI collapses genres by default; a future pass may curate to meaningful counts.
- `hltbBucket` — `short`/`medium`/`long`/`very-long`. **Placeholder** until a real source; minor filter only.
- `source:opm-demo-disc-NN` + OPM content-type tag — planned (§4.6), later phase.
- `display:*` — optional CRT-night tags; nice-to-have.

### 4.6 OPM overlay (planned, later phase)
Unchanged in intent: an overlay file tags PS2 entries that appeared on Official PlayStation Magazine demo discs (`demo`/`video`/`feature`), enabling "playable OPM demos" filtering and a future "demo disc roulette." Demo-only oddities get their own entries. Not part of the N64 prototype.

### 4.7 Manifest
`manifest.json` lists what's available so the app hardcodes nothing:
```json
{
  "generatedAt": "2026-06-02T00:00:00Z",
  "consoles": [
    { "id": "n64", "label": "Nintendo 64", "count": 413,
      "index": "data/index/n64.json", "detail": "data/detail/n64.json" }
  ],
  "overlays": []
}
```
`count` reflects **post-dedup** unique entries (what actually rolls).

---

## 5. Data sources & generation pipeline

### 5.1 Sources (free-first)
| Source | Used for | Notes |
|---|---|---|
| **Wikidata** (SPARQL) | Game list + genre, player modes, developer, publisher, year, Metacritic-where-present, enwiki sitelink | The practical spine. No key. One query per console. |
| **libretro-thumbnails** (jsDelivr CDN) | Box / in-game snap / title-screen art | Files are **No-Intro–named**, so they double as the canonical name spine. A blobless `git clone --filter=blob:none` yields the exact filename list → near-exact art matching (~95%). |
| **Wikipedia** (REST summary + article parse) | Profile blurb **and** "Reception" review-score tables (old magazines: EGM, N64 Magazine, Nintendo Power, …) | All free, real, attributable. Reception scores normalized to 0–100 (`/10`, `/5`, `%`, letter grades). |
| **IGDB** (api.igdb.com/v4) | **Enrichment:** screenshot galleries, trailer YouTube IDs, `total_rating`/`aggregated_rating`/`rating` + counts, cover/summary backups | Twitch Client ID/Secret → OAuth2 client-credentials → bearer. **Build-time only**, one free key. ~4 req/s. N64 platform id = `4`. |
| **Reddit** (exploratory) | Short real user-opinion quotes per game | Datacenter IPs are often blocked → may need the free official API (OAuth app) or running elsewhere; needs relevance filtering; marquee-only coverage. |
| No-Intro / Redump DATs | Canonical complete libraries | The long-term ideal spine; not required for the free path (libretro filenames already carry No-Intro names). |
| HowLongToBeat | Time-to-beat → buckets | **Bot-blocked (403).** Deprioritized; buckets are placeholders until a workable source. |

### 5.2 Output
`/data/index/<console>.json`, `/data/detail/<console>.json`, `/data/manifest.json` (and `/data/opm-discs.json` later).

### 5.3 Pipeline steps (idempotent, re-runnable, caches responses)
1. **List + metadata** from Wikidata SPARQL (platform-scoped). Build stable `id` (frozen slug); dedup by id.
2. **Art** — match each title to a libretro No-Intro filename (exact from the blobless clone's file list; constructed-candidate fallback). Store the base name.
3. **Descriptions** — Wikipedia REST summary via the enwiki sitelink; fallback to a title search; Wikidata one-liner as last resort.
4. **Ratings** — parse the Wikipedia "Reception" table → per-outlet scores normalized 0–100 + an aggregate; keep Wikidata/Metacritic where present.
5. **IGDB enrich** (build-time, free key) — match by name + platform `4`; pull screenshots, video IDs, ratings + counts, cover/summary backups; **cache the matched IGDB id** per game.
6. **Social** (exploratory) — Reddit search scoped to gaming subs → a representative quote + permalink, filtered for relevance/quality.
7. **Emit** slim index + fat detail + manifest. Cache all source responses to disk; honor an `overrides.json` (manual fixes) and a **match cache** (frozen matched ids) so re-runs are idempotent and never clobber hand-fixes.

### 5.4 Enrichment coverage — the realistic ceiling
Multi-source and free-first, but **"everything" has a ceiling** and we **never fabricate**:
- **Art** → ~95% (libretro); misses show a clean title placeholder.
- **Descriptions** → ~95%; the obscure tail may stay thin.
- **Ratings** → high for games with articles/IGDB presence; a genuinely-never-reviewed tail stays `null` (and passes the filter by default). Store rating *counts* to flag low-confidence scores.
- **Social quotes** → marquee titles only; empty for the long tail.

Do **not** fill gaps with LLM-generated facts. Real-and-blank beats invented. Real user quotes (Reddit) are fine — they're sourced opinion, not invented fact (§14).

---

## 6. Repo structure (current)

```
/index.html
/css/app.css
/js/
   main.js          # boot, roll loop, view orchestration, visualViewport height
   data.js          # manifest load, lazy slim/fat fetch, in-memory cache, image URLs
   state.js         # localStorage-backed state (ng.* namespace, §9)
   filters.js       # facet collection + filtering
   randomizer.js    # recency-weighted roll
   util.js          # small shared helpers (el, label prettify, time labels)
   ui/
     profile.js     # full-screen game view: art carousel (dots + autoplay), details
     controls.js    # filter drawer (console, players, score, length, genre), active chips
/data/              # GENERATED — committed
   manifest.json
   index/n64.json
   detail/n64.json
/tools/             # OFFLINE pipeline — NOT served
   build-n64.js     # current: Wikidata + libretro + Wikipedia
   (planned) enrich-igdb.js, reviews-wikipedia.js, social-reddit.js, overrides.json
   .cache/          # cached source responses (gitignored)
/sw.js              # Phase 3 (service worker)
```

> **Base-path note:** project pages serve under `/<repo>/`. Data is fetched with **relative** paths so it works on both project and custom-domain pages.

---

## 7. App behavior — filters & randomizer

### 7.1 Pool building
1. `A` = union of slim entries across **active consoles**.
2. Apply active facet filters → `P`. Facet semantics: **AND across facets, OR within a facet**.
3. Subtract the **blocklist** (explicit vetoes); apply **recency weighting** from roll history.
4. **Roll** = recency-weighted random pick from `P`.

### 7.2 Weighting (implemented)
Uniform by default, with a **recency penalty** so recently-shown games resurface less (decays over ~2h), an optional **"favor never-rolled"** toggle, and a guard against rolling the **same game twice in a row**. Goal is "stop showing me the same thing," not a recommender. An explicit **veto** ("don't show me this again") is distinct from a casual reroll — veto adds to the blocklist; reroll just touches recency.

### 7.3 Rating filter (implemented)
A numeric **minimum-rating** control over the slim `rating` (0–100 aggregate). **Unrated games pass by default** — most of the retro catalog has no score, so a naive "80+" would nuke it. An explicit **"only rated games"** toggle excludes the unrated. Ratings come from the multi-source blend (§5); the profile shows the per-source breakdown (§8.3).

### 7.4 Time-to-beat (minor, collapsed)
**Demoted from the original plan.** No time chips on the main screen. Time-to-beat is a **collapsed "Length" section** in the filter drawer, on placeholder buckets (`short`/`medium`/`long`/`very-long`) until a real source exists. Flagged as estimates in the UI.

---

## 8. UI / UX (mobile-first)

### 8.1 Layout & core loop
- Single column. **The rolled game is the main full-screen view** — there is no bottom sheet for the profile.
- The top is intentionally bare: just the title and a **pool count**. Active-filter chips appear there **only when a filter is set** (removable).
- A **persistent bottom bar** drives the loop: before a roll it's the hero **Roll** button (+ a filters gear); after a roll it becomes **`↻ Roll again`** + **`✓ I'll play this`** (gear stays). Core loop: **roll → read the game → Roll again / I'll play this.**
- **All filters live in a slide-up drawer** (the one justified sheet — it overlays the game and returns you to it). See §8.4.

### 8.2 Decide interaction
Buttons only — **no swipe-to-decide**. (It conflicted with horizontally swiping the screenshot carousel, and the buttons already cover accept/reroll.)

### 8.3 Profile view contents (the main view)
- **Art carousel** in a **4:3 frame** (matches N64 output and the screenshots): each image shown *contained* over a blurred backdrop of itself (no ugly crop). **Page dots** show count + position; the carousel **auto-advances** (~3s), pausing ~4.5s after manual interaction. Frames: box art, in-game snap, title screen (libretro), plus IGDB screenshots once enriched.
- **Basic info:** title, platform, year, developer, publisher, genres, player modes.
- **Reviews:** a **per-source breakdown** (e.g. `N64 Magazine 90`, `EGM 80`, `IGDB users 78`) plus a headline aggregate badge, with a **"Read more"** link-out. No reproduced long-form review text.
- **Summary:** Wikipedia extract.
- **Social (exploratory):** a short real quote with a link to the source ("what people say").
- **Video (planned):** once IGDB video IDs exist, a **tap-to-play facade** (thumbnail → inject the YouTube iframe only on tap). Until then, a **"Watch gameplay"** button opens a YouTube search (no API/quota).
- **Veto:** an explicit "🚫 Don't show me this again."

### 8.4 Filters (drawer, prioritized by use)
Everything filter-related is in the drawer, ordered by how often it's reached for:
- **Console** (library selection — toggles active consoles), **Players** (modes), **Score** (min-rating slider + "only rated") — all visible.
- **Length** (time buckets) and **Genre** — **collapsed by default** (genre is a long, lumpy list), each showing a selected-count badge.
- **When rolling:** "favor never-rolled."
- A live **"Show N games"** count; **clear-all**; a global **reset**.

### 8.5 Image URL resolution (client-side)
- libretro (current): `https://cdn.jsdelivr.net/gh/libretro-thumbnails/Nintendo_-_Nintendo_64@master/{Named_Boxarts|Named_Snaps|Named_Titles}/{encoded No-Intro name}.png`
- IGDB (after enrichment): cover `…/t_cover_big/{image_id}.jpg`, screenshot `…/t_screenshot_huge/{image_id}.jpg`

### 8.6 Touch / perf details
- Carousel uses native CSS scroll-snap; no heavyweight gesture libs.
- The app shell is sized to the **actual visible viewport** via the Visual Viewport API (`--app-h`), with `100dvh` fallback. **`viewport-fit=cover` is intentionally not used** — it drew the page into the phone's gesture-bar area and left a dead gap under the bottom bar.
- Optional `navigator.vibrate` haptic on roll (Android Chrome; iOS Safari ignores it).

---

## 9. Persistence (`localStorage`, per-device)

Namespace keys under **`ng.`**:
- `ng.activeConsoles` — `string[]`
- `ng.filters` — current facet selection `{ genres, modes, buckets, rating: { min, onlyRated } }`
- `ng.history` — `[{ id, ts, action: "shown" | "accepted" | "vetoed" }]` (capped; feeds recency weighting)
- `ng.blocklist` — `{ genres: [], ids: [] }` (explicit vetoes)
- `ng.settings` — `{ favorNeverRolled, haptics }`
- `ng.presets` — planned (named filter combos)

No sync. A clear **reset** affordance wipes all of the above.

---

## 10. Feature scope & phasing

### Phase 1 — Vertical slice (DONE, with changes)
- [x] Pipeline producing **one console — N64** (via **Wikidata + libretro + Wikipedia**, *not* No-Intro+IGDB), slim + fat + manifest.
- [x] Two-tier loaders with lazy fat fetch + in-memory cache.
- [x] Facet filtering generated from the data; **button roll**.
- [x] **Full-screen profile**: 4:3 art carousel with dots + autoplay, basic info, summary, score + links, "Watch gameplay" button.
- [x] Mobile shell: single column, hero roll button → Roll again / I'll play this, filter drawer.
- [x] `localStorage` state (`ng.*`): active consoles, filters, history.
- [x] Recency-weighted randomizer; explicit **veto**/blocklist; **rating filter** with unrated-passes-by-default.

### Phase 1.5 — Data fill
- [x] **IGDB enrichment** (free build-time key) on **both** consoles: screenshot + key-art galleries, trailer video IDs, ratings + counts, cover/summary backups.
- [x] **Cover fill** → 94% (N64) / 98% (Xbox) via IGDB cover → libretro boxart → Wikipedia lead image.
- [x] **Meaty descriptions** → 100% via Wikipedia full lead section → IGDB summary → metadata-composed fallback.
- [x] **Reviews UI** (breakdown), **video facade** (tap-to-play), enriched screenshot carousel.
- [x] **`overrides.json` + match cache** so IDs freeze and fetched/hand-fixed data survive re-runs.
- [ ] **≥5 screenshots for every game** — capped by IGDB for retro; needs a richer source (MobyGames/TheGamesDB key) plugged into the `{ src:'url' }` record type.
- [ ] **Wikipedia "Reception"** review scores → per-source breakdown + aggregate.
- [ ] **Social quotes** (Reddit) — exploratory, behind reachability.

### Phase 2 — Breadth & more features
- [ ] Pipeline extended to **more consoles** (pressure-tests the two-tier/perf path).
- [ ] **Presets** (save/load named filter combos).
- [ ] **OPM demo disc overlay** (PS2; §4.6).
- [ ] Curated/grouped genre vocabulary.

### Phase 3 — Extra modes & polish
- [ ] **"Roll a disc"** (random OPM disc → full tracklist).
- [ ] **Decision modes:** "Pick 3", "this or that" bracket.
- [ ] **Deep-cuts filter** (high rating, low rating-count → obscure gems).
- [ ] **Local co-op / versus** quick-filter.
- [ ] **PWA:** service worker for offline JSON caching + add-to-home-screen; **data versioning / cache-busting** (a content hash or manifest version the SW respects — needed before SW lands).
- [ ] **Natural-language filter** — LLM (BYO OpenRouter key) → structured filter spec → deterministic roll (§14.1).
- [ ] Haptics + animation polish (roll suspense, pinned hero while details scroll); optional CRT `display:*` tags.

---

## 11. Data & legal note

The dataset stores **metadata only** — titles, genres, years, ratings — plus **URLs to art on third-party CDNs** (libretro via jsDelivr; IGDB once enriched) and YouTube video IDs. **Review scores are facts**, stored with **per-source attribution**. **Social quotes** (if added) are short, attributed excerpts with a link back to the source — personal use, not rehosting. Demo disc tracklists are factual. **No ROMs or game assets are bundled or hosted.** Hotlink images per each provider's terms; don't rehost media. This stays clean — a personal catalog/picker.

---

## 12. Out of scope (explicit)

- Cross-device sync; accounts/auth.
- **Marketplace discovery / acquisition recommendation** (the Ludocene problem). *Note:* LLM features scoped to your **own loaded library** are different — a natural-language filter is in scope (§14.1).
- Store/purchase links as a feature.
- ROM hosting or distribution.
- A server/backend or runtime proxy/Worker of any kind in the serve path.
- LLM-generated *facts* about games (genres, trivia, scores). Real sourced data only; real user quotes are allowed.

---

## 13. Open questions / assumptions to confirm

1. **Enrichment coverage** — *resolved:* free multi-source plan (§5.4). Art ~95%, descriptions ~95%, ratings high-but-not-total, social marquee-only. Never fabricate.
2. **First console** — *resolved:* N64, built (via Wikidata + libretro, not No-Intro+IGDB).
3. **Console list (Phase 2)** — **open:** which consoles next (SNES / PS1 would best stress the perf path).
4. **DAT acquisition** — *resolved for now:* using Wikidata for the list + libretro filenames as the No-Intro name spine; explicit DAT ingestion deferred.
5. **IGDB credentials & rate limits** — *resolved:* free Twitch app (Client ID/Secret), build-time env var only, no Worker, ~4 req/s. **Integration scheduled next session.**
6. **Social blurbs (Reddit)** — **open/exploratory:** datacenter-IP blocking (may need the free official API or a different run host) + relevance/quality filtering.
7. **ID stability & overrides** — **to implement:** freeze the slug, add `overrides.json` + a match cache as sources multiply.
8. **Data versioning** — **to implement before PWA:** cache-busting for re-baked JSON (`generatedAt` won't invalidate a service-worker cache).

---

## 14. LLM layer (BYO OpenRouter key)

**Architecture fit.** A BYO OpenRouter key in `localStorage`, called client-side, is fine for a personal single-user app. It does **not** break the static model and needs **no Worker** (BYOK has nothing to hide).

**Grounding principle (governs everything here).** The LLM never selects games and never asserts game facts from its own memory. It only (a) emits a structured filter spec from a controlled vocabulary the app supplies, or (b) picks from / describes a candidate set the app passes it. The deterministic engine and the baked data stay the source of truth.

### 14.1 Natural-language filter — COMMITTED (Phase 3)
Turns a typed/spoken request into a structured filter that drives the existing deterministic roll. The LLM is a smarter *input* to the filter, never the selector. Depends on the filter engine + visible filter UI (built).

**Flow:** user text → app injects the **available facet vocabulary** (valid platforms, genres, modes, tag namespaces, buckets derived from loaded data) → OpenRouter (JSON-only) → validate the spec against schema **and** vocabulary (drop anything not in-vocabulary) → **populate the visible filter UI** (don't silently auto-roll); the user sees exactly what the model did, can tweak, then rolls. Anything unmappable goes in a surfaced `notes` field — never invented.

**Output schema (sketch):**
```json
{
  "platforms": ["n64"], "genres": ["action-adventure"], "modes": ["co-op"],
  "tags": { "include": [], "exclude": [] },
  "rating": { "min": null, "onlyRated": false },
  "time": { "buckets": [] },
  "history": { "excludePlayed": true, "excludeRecent": false },
  "notes": "couldn't map 'weird' to any facet — left as a note"
}
```
On invalid JSON, retry once then fall back to manual filtering. On a zero-match spec, say so and leave the editable chips in place.

### 14.2 Further LLM uses — exploratory (not committed)
Same BYOK + grounding.
- **Library-scoped recommend.** Pass history + a candidate set (the current pool or a sample); have the model rank/pick from *that set only*.
- **Quote selection/cleanup.** A grounded, allowed use: have the model pick or tidy the most representative quote from **real fetched** social comments (§5.6) — selecting from a real candidate set, not inventing. (This largely supersedes the old "why you'd like this" LLM-pitch idea, since we now prefer **real** user quotes over generated ones.)
