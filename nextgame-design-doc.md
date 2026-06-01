# NextGame — Design Document

> **Working title:** "NextGame" (working stand-in — may change).
> **Purpose:** A mobile-first, static personal webapp that picks something to play from entire console libraries, using extensive faceted filters plus a randomizer, and shows a rich profile for the chosen game.
> **Audience for this doc:** Claude Code (implementation handoff). Decisions below are settled unless flagged in §13.

---

## 1. Overview & goals

A personal toy for answering "what should I play tonight?" by rolling a random game out of a filtered pool drawn from **complete console libraries** (not an owned-backlog subset — assume access to any game on a given console). Filters narrow the pool; a roll picks one; a profile view gives enough context to decide.

**The one framing that drives every decision:** this is a **decision aid over a fixed, finite, mostly-retro library**, *not* a discovery/recommendation engine. Prior art (Pangamea, Ludocene, etc.) all solve the opposite problem — finding *new* games to acquire from the marketplace, with taste-learning recommenders and store links. This app deliberately does **none** of that. No recommendations, no taste model, no "games you might buy." The swipe/card interaction is borrowed; the recommender philosophy is not. Keep that boundary firm — it prevents scope creep.

---

## 2. Non-negotiable constraints (the established workflow)

- **Vanilla JS, no framework, no build tools.** Native ES modules (`<script type="module">`), plain HTML/CSS. No bundler, no transpile step, nothing that needs compiling before it serves.
- **Hosted on GitHub Pages**, served straight from the repo. Claude Code commits to GitHub; Pages serves.
- **Pure static serve path.** No backend, no server-side code reachable at runtime. (The data pipeline in §5 is an *offline* tool, run on demand — never served, never hit by the browser.)
- **No runtime API calls** except YouTube embeds/links (see §8). All game data is pre-baked into static JSON.
- **State is `localStorage`, per-device.** No cross-device sync — explicitly out of scope (§12). Tested primarily in a mobile browser.

---

## 3. Architecture overview

```
                    OFFLINE (run on demand via Claude Code)
   No-Intro / Redump DATs ─┐
   IGDB (Twitch OAuth)     ├─►  build pipeline  ─►  /data/*.json  ──► committed to repo
   HowLongToBeat           │     (Node, /tools)
   OPM disc sources        ─┘
                                                         │
                    RUNTIME (pure static, in the browser)│
   index.html + /js + /css  ◄── GitHub Pages ◄───────────┘
        │
        └─ fetch() static JSON on demand ──► filter / roll / profile
```

### 3.1 Data is generated, not fetched live
A one-off Node pipeline ingests the data sources, enriches, dedupes, and emits static JSON committed to the repo. It is re-run **only when adding/updating a console**. The IGDB secret lives in an env var on the machine running the pipeline and is **never committed** — and because nothing calls IGDB from the browser, **no Cloudflare Worker proxy is needed** (unlike VibeTutor's runtime pattern).

### 3.2 Two-tier data (the key perf decision)
At "a fuck ton" of games across many consoles, a single payload is too heavy for mobile. Split into:

- **Slim index** (per console): the minimum needed to filter, roll, and browse. Always loaded for *active* consoles.
- **Fat detail** (per console): everything the profile view needs (screenshots, summary, video IDs, score, links). **Lazy-loaded** the first time a profile from that console is opened, then kept in memory.

### 3.3 Lazy-load by active console
The user toggles which consoles are "active." Only active consoles' slim indexes load. Filters and the randomizer operate over the **union of active consoles**. This bounds the always-in-memory payload regardless of total library size.

---

## 4. Data model

### 4.1 "Everything is a facet"
Every filterable dimension is either a typed field or a tag in a namespace. Adding a new category (however specific) means **adding tags to entries — never a schema change and never new filter code**. Filters are generated from whatever facets exist in the loaded data.

### 4.2 Stable IDs and dedup
- ID format: `"{platform}:{slug}"` (e.g. `ps1:final-fantasy-vii`). Stable across re-runs.
- **Dedup** regional/revision duplicates from the DATs down to **one entry per game**: prefer USA/NTSC-U region, strip dump/revision flags, drop bad dumps (`[b]`), overdumps, and (per config) homebrew/hacks. Region preference and homebrew inclusion are config flags.

### 4.3 Slim index entry (example)
```json
{
  "id": "ps1:final-fantasy-vii",
  "title": "Final Fantasy VII",
  "platform": "ps1",
  "year": 1997,
  "genres": ["rpg"],
  "modes": ["singleplayer"],
  "rating": 92,
  "hltbBucket": "long",
  "cover": "co1r76",
  "tags": []
}
```
`cover` is an IGDB `image_id`; the client resolves it to a URL (§8.5) to keep JSON small.

### 4.4 Fat detail entry (example)
```json
{
  "id": "ps1:final-fantasy-vii",
  "developer": "Square",
  "publisher": "Sony Computer Entertainment",
  "summary": "…IGDB summary…",
  "screenshots": ["sc1abc", "sc1def", "sc1ghi"],
  "videos": ["dQw4w9WgXcQ"],
  "ratingCount": 1840,
  "hltb": { "main": 38, "mainExtra": 52, "completionist": 80 },
  "links": { "metacritic": "https://…", "igdb": "https://…" },
  "trivia": null
}
```

### 4.5 Facet namespaces (extensible)
- `platform` — `ps1`, `ps2`, `nes`, `snes`, `genesis`, `n64`, `gb`, `gbc`, `gba`, … (one per console added).
- `genres`, `themes`, `modes` — from IGDB (`game_modes`: `singleplayer`, `co-op`, `multiplayer`, `splitscreen`, …).
- `hltbBucket` — `short` / `medium` / `long` / `very-long` (thresholds in config; drives the time-budget chips).
- **`source:opm-demo-disc-NN`** plus an OPM content-type tag — see §5.4.
- `display:*` — optional, e.g. `display:light-gun` (needs a CRT) or `display:240p`, for CRT-night filtering. Phase 3 / nice-to-have.

### 4.6 OPM overlay file (example)
```json
{
  "discs": [
    {
      "issue": 85,
      "date": "2004-09",
      "demos":    ["ps2:def-jam-fight-for-ny", "ps2:star-wars-battlefront"],
      "videos":   ["ps2:metal-gear-solid-3-snake-eater"],
      "features": ["ps2:playboy-the-mansion"]
    }
  ]
}
```
The build tags the referenced PS2 entries with `source:opm-demo-disc-85` + a content-type (`demo` / `video` / `feature`), so the user can filter "playable OPM demos" specifically vs. "anything that appeared on a disc." Demo-only oddities (content with no full-game entry) get their own entries.

### 4.7 Manifest
A single `manifest.json` lists what's available so the app hardcodes nothing:
```json
{
  "generatedAt": "2026-05-31T00:00:00Z",
  "consoles": [
    { "id": "ps1", "label": "PlayStation",  "count": 4200, "index": "data/index/ps1.json", "detail": "data/detail/ps1.json" },
    { "id": "ps2", "label": "PlayStation 2", "count": 2100, "index": "data/index/ps2.json", "detail": "data/detail/ps2.json" }
  ],
  "overlays": [ { "id": "opm", "label": "OPM Demo Discs", "file": "data/opm-discs.json" } ]
}
```

---

## 5. Data sources & generation pipeline

### 5.1 Sources
| Source | Used for | Notes |
|---|---|---|
| **No-Intro** (datomatic.no-intro.org) | Canonical complete cartridge libraries (NES, SNES, N64, GB/GBC/GBA, Genesis, Master System, …) | These match the Everdrive sets. DAT download may be a **manual prep step**. |
| **Redump** (redump.org) | Canonical complete disc libraries (PS1, PS2, …) | Same. |
| **IGDB** (api.igdb.com/v4) | Genres, themes, `game_modes`, year, developer/publisher, summary, cover, screenshots, video (YouTube) IDs, `total_rating` + count | Twitch Client ID/Secret → OAuth2 client-credentials → bearer token. Apicalypse query syntax. **Pipeline-time only.** Verify current rate limit (~4 req/s) at build. |
| **HowLongToBeat** | Time-to-beat → buckets | No official API; use a community/scrape approach at build time, bake results. |
| **PCSX2 Wiki** (wiki.pcsx2.net) + **The PlayStation 2 Project** (playstation2project.wordpress.com) | OPM disc tracklists | Cleanly formatted per-disc pages + master list. **Do not** use the Idea Wiki fandom page — it self-flags as not fully accurate. |
| **Internet Archive** | OPM disc/box art (optional) | Only if we want disc art. |

### 5.2 Output
`/data/index/<console>.json`, `/data/detail/<console>.json`, `/data/opm-discs.json`, `/data/manifest.json`.

### 5.3 Pipeline steps (idempotent, re-runnable, caches API responses)
1. **Acquire DATs** per console (manual download or scripted) → parse XML to raw title lists.
2. **Canonicalize/dedup** (§4.2) → one entry per game with a stable ID.
3. **Enrich via IGDB** — match by name + platform (fuzzy; record match confidence; leave bare on miss). Pull the fields in §5.1.
4. **Enrich HLTB** — match by name; compute buckets.
5. **OPM overlay** — parse PCSX2 + PS2 Project sources, map demo/video/feature → game IDs, tag matching PS2 entries, create entries for demo-only oddities, emit `opm-discs.json`.
6. **Emit** slim index + fat detail per console + manifest. Cache IGDB/HLTB responses to disk so re-runs don't re-fetch.

### 5.4 Enrichment coverage — assumption (confirm in §13)
**Default stance: "good enough."** No-Intro/Redump give 100% complete title lists for free; IGDB auto-matching is fuzzy (regional names, revisions, homebrew), so expect ~80–90% cleanly enriched with a tail of **bare entries** (title/platform only). Bare entries are valid and still roll/show. Manual cleanup of the tail is **optional and deferred**, not a blocker. Do **not** fill gaps with LLM-generated genres/trivia — hallucinated facts in a profile are worse than blanks.

---

## 6. Repo structure (proposed)

```
/index.html
/css/
   app.css
/js/
   main.js
   data.js          # manifest load, lazy slim/fat fetch, in-memory cache
   state.js         # localStorage-backed state (§9)
   filters.js       # facet collection + filtering
   randomizer.js    # pool building, weighting, roll
   ui/              # render: roll button, filter drawer, console chips,
                    #   profile bottom-sheet, screenshot carousel, video facade
/data/             # GENERATED — committed
   manifest.json
   index/<console>.json
   detail/<console>.json
   opm-discs.json
/tools/            # OFFLINE pipeline — NOT served
   build.js
   parse-dats.js
   enrich-igdb.js
   enrich-hltb.js
   build-opm.js
   config.js        # region prefs, homebrew flag, hltb thresholds
/sw.js             # Phase 3 (service worker)
```

> **Base-path note:** project pages serve under `/<repo>/`. Fetch data with paths relative to the app root (or read a `<base>`), so it works on both project and user/custom-domain pages.

---

## 7. App behavior — filters & randomizer

### 7.1 Pool building
1. `A` = union of slim entries across **active consoles**.
2. Apply active facet filters `F` → `P`.
3. Subtract the **blocklist**; apply **recency weighting** from roll history.
4. **Roll** = recency-weighted random pick from `P`.

### 7.2 Weighting
Uniform by default, with a **recency penalty** so recently-shown games resurface less (history in `localStorage`). Optional toggle to favor never-rolled games. Keep it simple — the goal is "stop showing me the same thing," not a recommender.

### 7.3 Rating filter
A numeric **minimum-rating** control (slider or threshold) over the `rating` field in the slim index (IGDB aggregate, 0–100). Optionally also bake `metacritic` (via RAWG) into the slim index if you want to filter on critic score specifically.

**Unrated handling (important):** much of the retro catalog has *no* score — Metacritic didn't exist before ~2001, and many obscure titles have few or no IGDB ratings. So unrated games **pass the rating filter by default**, with an explicit **"only rated games"** toggle to exclude them. Without this, a "rated 80+" filter would silently nuke most of the PS1/SNES/NES era. (Pairs naturally with the deep-cuts idea in Phase 3.)

### 7.4 Time-budget chips
Quick facets on `hltbBucket` surfaced on the main screen: **30 min / 1 hr / all night** → `short` / `medium` / `long`+`very-long`.

---

## 8. UI / UX (mobile-first)

### 8.1 Layout & core loop
- Single column. The **roll button is the hero**, anchored at the bottom in the thumb zone.
- After a roll, the **profile slides up as a bottom sheet**. Core loop: **roll → sheet → "Roll again" / "I'll play this."**
- **Filters + console toggles** live in a slide-up drawer. Active filters render as **removable chips**; console toggles are **chips in a horizontal scroller**.

### 8.2 Swipe-to-decide loop
Each rolled game is a card: **swipe right = "I'll play this," swipe left = reroll** (and that game gets down-weighted via the recency penalty). Buttons remain as a fallback for accessibility.

### 8.3 Profile view contents
- **Basic info:** title, platform, year, developer, publisher, genres, player modes. (IGDB.)
- **Cover + screenshots:** swipeable carousel; images lazy-load when the sheet opens.
- **Score:** aggregate rating (IGDB; optionally Metacritic via RAWG) + a **"Read reviews" link-out**. **No reproduced review text** (copyright + no clean source).
- **Trivia:** link-out or omit; never LLM-generated.
- **Video (A + B):**
  - **(A)** Embed IGDB's trailer inline via a **tap-to-play facade** — show a thumbnail with a play button and only inject the heavy YouTube iframe **on tap** (loading the YT player for every profile would wreck mobile perf/data).
  - **(B)** A **"Watch gameplay"** button that opens a YouTube search (`youtube.com/results?search_query=<title>+gameplay`) — deep-links into the YouTube app for real gameplay footage. No API/quota.

### 8.4 Touch/perf details
- Carousels and drawers use CSS-driven gestures; avoid heavyweight libs.
- Optional `navigator.vibrate` haptic on roll (progressive enhancement — Android Chrome supports it; iOS Safari does not).

### 8.5 IGDB image URL resolution (client-side)
- Cover: `https://images.igdb.com/igdb/image/upload/t_cover_big/{image_id}.jpg`
- Screenshot: `https://images.igdb.com/igdb/image/upload/t_720p/{image_id}.jpg`

---

## 9. Persistence (`localStorage`, per-device)

Namespace keys under `gr.`:
- `gr.activeConsoles` — `string[]`
- `gr.lastFilters` — last facet selection
- `gr.presets` — `[{ name, filters, weighting }]` (§10)
- `gr.blocklist` — `{ genres: [], tags: [], ids: [] }`
- `gr.history` — `[{ id, ts, action: "shown" | "accepted" | "vetoed" }]` (capped length; feeds recency weighting)
- `gr.settings` — `{ haptics, … }`

No sync. Provide a clear "reset" affordance.

---

## 10. Feature scope & phasing

> Phasing de-risks by proving a full vertical slice on **one** console before generating "a fuck ton."

### Phase 1 — Vertical slice (one console, end to end)
- [ ] Pipeline producing **one console — N64 (US) via No-Intro + IGDB**, slim + fat + manifest. (Deliberately exercises the No-Intro cart path that most of the library uses.)
- [ ] Two-tier loaders (`data.js`) with lazy fat fetch + in-memory cache.
- [ ] Facet filtering from loaded data; basic **button roll**.
- [ ] Profile **bottom sheet**: basic info, cover, screenshots carousel, score + links, video facade (A) + gameplay button (B).
- [ ] Mobile shell: single column, hero roll button, filter drawer, console chips.
- [ ] `localStorage` state for active consoles + last filters + history.

### Phase 2 — Full data + core features
- [ ] Pipeline extended to **all desired consoles** (No-Intro cart sets + Redump).
- [ ] **OPM demo disc overlay** (tagging + `opm-discs.json`).
- [ ] **Swipe-to-decide** loop (right = accept, left = reroll/down-weight).
- [ ] **Rating filter** (min-rating control + "only rated games" toggle; §7.3).
- [ ] **Presets** (save/load named filter+weight combos).
- [ ] **Time-budget chips.**
- [ ] **Blocklist.**
- [ ] Recency-weighted randomizer.

### Phase 3 — Extra modes & polish
- [ ] **"Roll a disc"** mode (pick a random OPM disc, show its full tracklist).
- [ ] **Decision modes:** "Pick 3" and "this or that" bracket.
- [ ] **Deep-cuts filter** (high rating, low `ratingCount` → obscure gems).
- [ ] **Local co-op / versus** quick-filter.
- [ ] **PWA:** service worker for offline JSON caching + add-to-home-screen; **home-screen preset shortcuts** ("Demo disc roulette" as its own icon).
- [ ] **Natural-language filter** — LLM (BYO OpenRouter key) → structured filter spec → deterministic roll; §14.1.
- [ ] **(Exploratory) further LLM uses** — library-scoped recommend, "why you'd like this" pitch; §14.2. Not committed.
- [ ] Haptics + animation polish; optional CRT `display:*` tags.

---

## 11. Data & legal note

The dataset stores **metadata only** — titles, genres, years, ratings — plus **URLs to cover/screenshot art on IGDB's CDN** and YouTube video IDs. Demo disc tracklists are factual. **No ROMs or game assets are bundled or hosted.** Hotlink IGDB images per their terms; do not rehost media. This stays clean and is just a personal catalog/picker.

---

## 12. Out of scope (explicit)

- Cross-device sync; accounts/auth.
- **Marketplace discovery / acquisition recommendation** — "find new games to buy" out of the storefront firehose (the Ludocene problem). *Note:* LLM features scoped to your **own loaded library** are a different thing — a natural-language filter is in scope (§14.1), with further uses exploratory (§14.2).
- Store/purchase links as a feature.
- ROM hosting or distribution.
- A server/backend of any kind in the serve path.

---

## 13. Open questions / assumptions to confirm

1. **Enrichment coverage** — assumed **"good enough"** (bare entries OK, ~80–90% auto-match, manual cleanup deferred). Override if you want near-complete genre/cover data (implies grinding the match tail).
2. **First console (Phase 1) — decided & fully specified: N64 (US) via No-Intro.** Small library, console already hooked up = fast iteration and a real hardware test.
3. **Console list (for Phase 2)** — N64 is the Phase 1 console; still need the full list of remaining consoles to ingest.
4. **DAT acquisition** — No-Intro/Redump downloads may be a manual prep step; confirm you'll supply the DAT files or want the pipeline to attempt fetching.
5. **IGDB credentials & rate limits** — Twitch Client ID/Secret to be supplied via env at build; confirm current rate limit when implementing.

---

## 14. LLM layer (BYO OpenRouter key)

**Architecture fit.** A BYO OpenRouter key stored in `localStorage` and called client-side is fine for a personal, single-user app (your own key, your own device) — same pattern as SlopQuest. It does **not** break the static model and needs **no Worker** (the VibeTutor Worker existed to hide a *shared* key; BYOK has nothing to hide).

**Grounding principle (governs everything here).** The LLM never selects games and never asserts game facts from its own memory. It only ever (a) emits a structured filter spec built from a controlled vocabulary the app supplies, or (b) picks from / describes a candidate set the app passes it. The deterministic engine and the baked data stay the source of truth — this is what stops it inventing games or facts that don't exist.

### 14.1 Natural-language filter — COMMITTED (Phase 3)

Turns a typed or spoken request into a structured filter that drives the existing deterministic roll. The LLM is a smarter *input* to the filter, never the selector. Depends on the filter engine + visible filter UI from Phases 1–2.

**Flow:**
1. User enters NL text — e.g. "something short and weird on PS1, co-op, that I haven't played."
2. App assembles the prompt, **injecting the available facet vocabulary** derived from the loaded slim indexes + manifest (valid platform ids, genres, themes, modes, tag namespaces with example values, hltb buckets). This is the crux of grounding — the model can only map to tokens that actually exist in the data.
3. Call OpenRouter (BYOK). Request JSON-only output (use the model's JSON / structured-output mode if available; otherwise parse defensively and strip code fences).
4. Validate the returned spec against the schema **and** the vocabulary; drop any value not in the vocabulary.
5. **Populate the visible filter UI** (chips + sliders) from the spec — do **not** silently auto-roll. The user sees exactly what the model did, can tweak it, then rolls. (Optional "interpret & roll" one-shot for convenience.)

**Output schema (filter spec):**
```json
{
  "platforms": ["ps1"],
  "genres": ["rpg"],
  "themes": [],
  "modes": ["co-op"],
  "tags": { "include": [], "exclude": [] },
  "rating": { "min": null, "onlyRated": false },
  "time": { "maxMinutes": null, "buckets": ["short"] },
  "history": { "excludePlayed": true, "excludeVetoed": false, "excludeRecent": false },
  "notes": "couldn't map 'weird' to any facet — left as a note, not used for filtering"
}
```
All fields optional/nullable; the engine applies only what's set. Anything the model can't map to the supplied vocabulary goes in `notes` (surfaced to the user) — it must **not** invent a token.

**System-prompt design (sketch):**
> You translate a player's natural-language request into a structured filter for a personal game picker. You do **not** choose games and you do **not** know which games exist. Output **only** JSON matching the schema — no prose, no code fences. Use **only** values from the VOCABULARY provided; if a concept doesn't map to an allowed value, put it in `notes` and do not invent a value. Omit or null anything the user didn't ask for.
>
> VOCABULARY: { platforms: […active…], genres: […], themes: […], modes: […], tagNamespaces: { "source": […], "display": […] }, hltbBuckets: [short, medium, long, very-long] }
>
> SCHEMA: { …as above… }

**Refinement (conversational).** For follow-ups like "more chill, less RPG," pass the **current filter spec** alongside the new instruction; the model returns an updated spec, which re-populates the chips. Ties into the swipe-veto loop.

**Config & failure handling.** Model is user-configurable via OpenRouter; default to a cheap, fast model (this is structured extraction, not creative writing). On invalid JSON, retry once, then fall back to manual filtering with a short message. On a spec that matches zero games, say so and leave the editable chips in place rather than rolling nothing.

### 14.2 Further LLM uses — exploratory (not committed)

Same BYOK setup and grounding principle; shapes TBD.
- **Library-scoped recommend.** Pass history (accepted/vetoed/played) + a candidate set (the current filtered pool or a sample) and have the model rank or pick. The "recommend from my history" idea, scoped to games you own.
- **"Why you might like this" pitch.** A short subjective vibe blurb grounded in the rolled game's real metadata — a safer fill for the trivia gap than invented facts.
