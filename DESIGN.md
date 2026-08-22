# Provenance — Design Document

A Warframe drop-source lookup tool. Static site, client-side data, deployed on Vercel.

> Companion document: `CLAUDE.md` holds the enforced rules. This document holds the reasoning,
> the data model, and the math. Where they disagree, `CLAUDE.md` wins and this file needs updating.

---

## 1. Goals

**Primary.** Answer "how do I get this item, and what's the fastest path" for every obtainable
item in the game — including the ~60% of interesting items that are gated behind Void Relics,
where the honest answer is a *chain* (item → relic → relic's own drop sources → mission and
rotation) rather than a single table row.

**Secondary.**
- Forward lookup: "what does this mission/enemy/bounty drop", with rotation and rarity breakdowns.
- Deep filtering: faction, planet, mission type, rotation, tileset, rarity, vaulted status, drop
  chance thresholds, relic tier, refinement level, item category.
- Expected-runs math that accounts for refinement and radiant sharing, so two paths can be compared
  by effort rather than by raw percentage.
- A riven tracker: log rolls, grade them against disposition, value them against DE's weekly trade
  data and live market listings.

**Non-goals.** Build planning, damage calculators, worldstate/alert tracking, trading, a wiki. Other
sites do these well. Scope discipline is what makes this one good.

---

## 2. Why the architecture is shaped this way

The requirement is a client-side app with local caching and a daily refresh. The obvious reading —
fetch DE's endpoints from the browser on a daily TTL — does not survive contact with the actual
endpoints:

| Problem | Detail |
|---|---|
| CORS | `content.warframe.com`, `www-static.warframe.com`, and the drop-table CDN are game-client endpoints. They currently work from browsers by accident of configuration, not by contract. The wiki page listing them says explicitly they are "for reference only." |
| Compression | `PublicExport` manifests are `.txt.lzma`. Decompressible in-browser via WASM, but slow, and the decompressed JSON contains unescaped control characters that break `JSON.parse` without a sanitization pass. |
| Format | The official drop table is one enormous HTML document (`hnfvc0o3jnfvc873njb03enrf56.html`), not JSON. Parsing it is a build step, not a page load. |
| Size | Naively loading everything is multiple megabytes of parse work on every cold visit. |

So the daily refresh moves to CI. A GitHub Action fetches, parses, normalizes, validates, and
commits static JSON. The commit triggers a Vercel deploy. The client only ever fetches same-origin
files. This is still a fully client-side application — the pipeline is build infrastructure, not
a backend. There is no database, no session, no server-held state.

```
┌─ GitHub Actions (daily cron) ──────────────────────────────┐
│  WFCD warframe-drop-data ──┐                               │
│  @wfcd/items ──────────────┼─→ normalize → validate →      │
│  DE weeklyRivens*.json ────┘   build drop graph →          │
│                                emit hashed JSON chunks     │
└────────────────────────┬───────────────────────────────────┘
                         │ commit to main
                         ▼
┌─ Vercel ───────────────────────────────────────────────────┐
│  Next.js build → static HTML + /data/*.hash.json (immutable)│
│  Edge route: /api/market/* → api.warframe.market (proxy)    │
└────────────────────────┬───────────────────────────────────┘
                         ▼
┌─ Browser ──────────────────────────────────────────────────┐
│  manifest.json → hash check → IndexedDB hit or fetch        │
│  → Worker builds indices → in-memory query engine           │
│  → React renders; URL holds all filter state                │
└────────────────────────────────────────────────────────────┘
```

---

## 3. Data sources

Fetched **in CI only**. CORS is irrelevant here, so hit canonical sources directly.

| Dataset | Source | Cadence | Notes |
|---|---|---|---|
| Drop tables | `WFCD/warframe-drop-data` (`/data/all.json`, or per-category files) | ~daily | Already parsed from DE's HTML. `info.json` carries an MD5 of the source page plus a build timestamp — use that MD5 as an upstream change signal. |
| Item metadata | `@wfcd/items` (npm) | on release | Names, categories, unique paths (`/Lotus/Weapons/...`), icons, riven dispositions, tradability, mastery rank. |
| Riven trade data | `https://www-static.warframe.com/repos/weeklyRivensPC.json` | weekly | Per-weapon, per-riven-type: median/min/max plat and population. The best free valuation anchor that exists. Console variants (`PS4`/`XB1`/`SWI`) exist but are effectively legacy — PC only unless asked. |
| Wiki supplements | `Module:DropTables/data?action=raw`, `Module:Void/data?action=raw` | on demand | The wiki carries entries the official repo omits. **Optional, phase 5+.** Join carefully and mark provenance per edge, because the two disagree in places. |
| Market listings | `api.warframe.market` | runtime | Only source that must be live. Goes through the edge proxy. Rate-limited — respect it. |

**Deliberately not used at runtime:** everything on `content.warframe.com` and `origin.warframe.com`.
The pipeline may read `PublicExport` directly if `@wfcd/items` ever lags behind a release, but that
code lives in `packages/sources` and never ships to the browser.

---

## 4. Canonical data model

Defined once, in `packages/core/src/types.ts`, derived from Zod schemas.

```ts
type ItemId   = string;   // stable slug: "braton-prime-barrel"
type SourceId = string;   // "mission:earth/cambria", "relic:lith-b4", "enemy:corrupted-heavy-gunner"

interface Item {
  id: ItemId;
  name: string;
  category: ItemCategory;       // Warframe | Primary | Secondary | Melee | Mod | Arcane | Resource | Relic | Component | ...
  uniqueName?: string;          // /Lotus/... — the join key to PublicExport
  imageName?: string;           // WFCD CDN asset
  tradable: boolean;
  vaulted?: boolean;            // relics and prime parts only
  masteryReq?: number;
  buildsInto?: ItemId[];        // component → finished item, for "I need 4 more of these"
  components?: { itemId: ItemId; count: number }[];
}

interface Source {
  id: SourceId;
  kind: 'mission' | 'relic' | 'enemy' | 'bounty' | 'syndicate' | 'sortie' | 'transient' | 'cache' | 'other';
  name: string;
  planet?: string;
  missionType?: string;         // Survival, Defense, Disruption, ...
  faction?: 'Grineer' | 'Corpus' | 'Infested' | 'Orokin' | 'Corrupted' | 'Sentient' | 'Narmer';
  tileset?: string;
  levelRange?: [number, number];
  isSteelPath?: boolean;
}

// One edge of the drop graph. This is the atom the whole app is built on.
interface DropEdge {
  itemId: ItemId;
  sourceId: SourceId;
  chance: number;               // 0..1 per eligible event. Never a percentage string.
  rotation?: 'A' | 'B' | 'C' | null;
  stage?: string;               // bounty stage, "Rotation C (Stage 3)", cache index
  quantity: [number, number];   // min, max per drop
  eventsPerRun?: number;        // rounds per rotation-C cycle, cache count, etc. Default 1.
  provenance: 'official' | 'wiki' | 'derived';
}

interface RelicDetail {
  id: ItemId;                   // relics are items and sources both
  tier: 'Lith' | 'Meso' | 'Neo' | 'Axi' | 'Requiem' | 'Vanguard';
  vaulted: boolean;
  rewards: { itemId: ItemId; rarity: 'common' | 'uncommon' | 'rare' }[];
}
```

Two rules that matter more than they look:

- **Chances are always floats in 0..1.** The upstream data mixes numbers and strings like `"nce: 15.00"`.
  Normalize once, in the pipeline, and assert the range.
- **`eventsPerRun` is what makes paths comparable.** A 10% Rotation C reward on a 20-minute Survival
  and a 10% reward on a 4-minute Capture are not the same thing. Carry the event count; let the UI
  translate it into time.

### Emitted files

```
/data/manifest.json                    hash, builtAt, upstream hashes, file list, attributions, counts
/data/items.<hash>.json                ~6k items,  ≈900 kB raw / ≈180 kB br
/data/sources.<hash>.json              ~2k sources
/data/edges.<hash>.json                ~40k edges, the bulk of the payload
/data/relics.<hash>.json               relic → reward mapping with rarities
/data/rivens.<hash>.json               dispositions + weekly trade stats
/data/search-index.<hash>.json         prebuilt name index for the palette
```

Ship raw JSON and let Vercel's Brotli handle it. Don't reach for MessagePack or a custom binary
format until the profiler says to — and if it does, the answer is probably splitting `edges` by
category, not changing encoding.

---

## 5. The drop graph and the math

This is where the tool earns its existence. Most Warframe sites show you the table row. The
interesting cases are the ones where there isn't one.

### 5.1 Direct drops

```
P(item per run) = 1 - (1 - chance)^eventsPerRun
```

Each event in a run is an independent trial, so the per-run chance is the complement of
missing every one of them.

> **Amended 2026-08-22.** This previously read `chance × eventsPerRun`, which is wrong: it
> exceeds 1 once chance and event count are both high (a 50% drop over four rotations would
> report "200%"). The two agree closely for the small chances that dominate real drop tables,
> which is why the error is easy to miss. `perRunChance()` in `packages/core/src/probability.ts`
> implements the corrected form, and its test asserts the failure case of the old one.

Report expected runs as `1 / P`, and "nearly guaranteed" as the runs `n` where
`1 - (1 - P)^n ≥ 0.95`. Both numbers, always — players intuit the second better than the first,
and the gap between them is the actual lesson about RNG.

### 5.2 Relic-gated items (the hard case)

For a prime part, the path is: run a mission that drops relic `R`, then open `R` at some refinement
level. Composed:

```
P(item per run of source S)
  = P(relic R drops from S)  ×  P(item | R, refinement)
```

`P(item | R, refinement)` comes from the relic reward table, which is fixed by rarity tier:

| Refinement | Common (×3) | Uncommon (×2) | Rare (×1) |
|---|---|---|---|
| Intact | 25.33% | 11.00% | 2.00% |
| Exceptional | 23.33% | 13.00% | 4.00% |
| Flawless | 20.00% | 17.00% | 6.00% |
| Radiant | 16.67% | 20.00% | 10.00% |

**Read these from the drop data, don't hardcode them.** Keep the table above in the source as a
validation fixture: if the parsed values drift from it, DE changed something and the build should
say so loudly rather than silently shipping different math.

Radiant sharing (four players each opening a Radiant relic, best reward taken):

```
P(at least one drop across n players) = 1 - (1 - p_radiant)^n
```

For a rare at Radiant: 10% solo, 34.4% in a 4-player share. That single comparison is the most
useful number this site can show a player, and no existing tool surfaces it well. Make it a
first-class control, not a footnote.

An item may have many relics, each with many drop sources. The result set is a **ranked list of
complete paths**, not a flat table:

```
Braton Prime Barrel
  ├ Lith B4  (Rare, 2.00% intact / 10.00% radiant)
  │   ├ Hepit, Void — Capture — 12.5% — ~1.5 min/run
  │   └ Ukko, Void  — Capture — 10.0% — ~2 min/run
  └ Meso B3  (Uncommon, 11.00% intact / 20.00% radiant)
      └ Io, Jupiter — Defense — Rotation A — 14.3% — ~5 min/rotation
```

Rank paths by **expected minutes**, not by chance. Mission durations aren't in any dataset, so
maintain `packages/core/src/data/mission-durations.ts` — a hand-curated table of median minutes per
mission archetype (Capture ≈ 1.5, Exterminate ≈ 3, Defense rotation ≈ 5, Survival rotation ≈ 5,
Disruption round ≈ 4). Label it clearly in the UI as an estimate, make it user-overridable, and keep
it in one file so it's easy to tune.

### 5.3 Multi-component items

A Warframe needs Neuroptics, Chassis, Systems, and a Blueprint, each from a different path. The
item page must show the aggregate: expected time to complete the *set*, given which parts the user
already has. Track owned parts in IndexedDB. This is the "should I keep farming or just buy it"
question, and answering it well is a genuine differentiator.

### 5.4 Implementation

Precompute the flattened edge list in the pipeline; do not compose chains in the browser per query.
Relic gating is a fixed two-hop expansion — resolve it once at build time and emit
`derived` edges with the composed probability and a `via` field naming the relic. The client then
does index lookups, never graph traversal. Query latency target: **< 16ms** for any lookup.

---

## 6. Client runtime

### Boot sequence

1. Fetch `/data/manifest.json` (~200 bytes, `must-revalidate`).
2. Compare `manifest.hash` against the hash in IndexedDB.
3. Match → hydrate from IDB. Mismatch or empty → fetch the hashed chunks, store, hydrate.
4. Post the raw arrays to a Worker; it builds the indices and transfers them back.
5. Render.

Cold load target: interactive in under 2s on a mid-range phone over 4G. Warm load: under 300ms.
Show the shell and the search palette immediately — search should accept typing before the indices
finish, and flush the query when they land.

Because filenames are content-addressed, `/data/*` is served `immutable`. The daily refresh is a
new hash in `manifest.json`, nothing more. When the hash changes mid-session, show an unobtrusive
"Drop data updated — reload" affordance rather than swapping data underneath the user.

### Indices (built in the Worker)

```ts
itemsById:        Map<ItemId, Item>
sourcesById:      Map<SourceId, Source>
edgesByItem:      Map<ItemId, DropEdge[]>     // the reverse index — the whole point
edgesBySource:    Map<SourceId, DropEdge[]>   // forward lookup
relicsByReward:   Map<ItemId, RelicDetail[]>
nameHaystack:     string[]                    // parallel to itemIds, for uFuzzy
```

### Filtering

All filters are predicates composed over the candidate edge array. At this scale that is fast enough
and vastly easier to reason about than a query DSL. Filter state lives in the URL via `nuqs`, with
short param keys and a compact encoding so shared links stay reasonable:

```
/item/braton-prime-barrel?ref=radiant&share=4&sp=1
/browse?cat=mod&f=grineer&mt=survival&rot=C&min=5&vault=0
```

Never store a filter in React state alone. If it changes what's displayed, it belongs in the URL.

---

## 7. Surfaces

| Route | Job |
|---|---|
| `/` | Search-first. The palette *is* the home page. Below it: recently vaulted, newly added, common lookups. |
| `/item/[slug]` | The main event. All paths to the item, ranked by expected time, with the chain trace. Statically generated for every item — this is what gets indexed by search engines. |
| `/source/[kind]/[slug]` | Forward view: what a mission, relic, or enemy drops, by rotation. Also statically generated. |
| `/browse` | The filterable table. Virtualized, dense, sortable, URL-driven. |
| `/relics` | Relic browser with vaulted filtering and refinement comparison. |
| `/rivens` | The riven tracker. Client-only, no prerender. |
| `/about` | Data sources, update cadence, attribution, methodology — including honest notes on where the numbers are estimates. |

`generateStaticParams` over every item and source produces roughly 8,000 static pages. That is well
within Next's comfort zone and is the entire SEO strategy: each page targets the query a player
actually types, which is the item name plus the word "drop".

---

## 8. Visual system

### Direction

The subject's world offers two obvious visual routes and both are traps. Orokin gold-on-black is
what every Warframe fan site already does; the generic "dark dashboard with an acid accent" is what
every AI-generated data tool does. The framing that avoids both: **this is an instrument, not a
shrine.** A precision readout for someone deciding where to spend the next two hours.

So: an industrial signage aesthetic borrowed from Corpus interface panelling rather than Orokin
ornament — wide engineered type, generous negative space, hairline structure — with gold used
exactly once per view, on the thing you searched for. Restraint is the point. The gold reads as
gold *because* nothing else is competing with it.

### Signature element

**The drop-chain trace.** A rendered path from item back to the mission you actually queue, drawn
as a connected vertical trace with the probability compounding visibly at each hop. It's the one
thing here no other tool does well, it's the direct visual expression of the hardest problem the
codebase solves, and it's what people will screenshot into clan chat. Every other component should
be quiet enough to let it be the memorable thing.

### Palette

Cold void base rather than neutral black — a blue-violet cast that reads as Void rather than as
default dark mode. Defined in OKLCH so the rarity ramp can hold constant chroma and lightness
across hues; those four colors then read as one measurement scale instead of four unrelated tags.

```css
--void-900:  oklch(0.14 0.018 275);   /* page */
--void-800:  oklch(0.18 0.020 275);   /* panel */
--void-700:  oklch(0.24 0.022 275);   /* raised */
--hairline:  oklch(0.32 0.020 275);   /* 1px structure */
--text:      oklch(0.93 0.008 275);
--text-dim:  oklch(0.68 0.012 275);
--orokin:    oklch(0.78 0.14  85);    /* the one accent. use once per view. */

/* rarity ramp — constant C and L, hue only varies */
--r-common:    oklch(0.72 0.10 250);
--r-uncommon:  oklch(0.72 0.10 150);
--r-rare:      oklch(0.72 0.10  85);
--r-legendary: oklch(0.72 0.10  20);
```

### Type

- **Display:** Archivo Expanded, 600–700, tight tracking, sentence case. Wide industrial grotesque
  reads as signage and instrumentation. Chosen specifically to avoid the sci-fi font cliché —
  no Rajdhani, no Orbitron, no Chakra Petch.
- **Body / UI:** Inter Tight.
- **Data:** IBM Plex Mono, always `tabular-nums`, for every percentage, duration, and count.

Scale: 12 / 14 / 16 / 20 / 28 / 40. Six sizes, no more.

### Structure

- Panels chamfer their top-left and bottom-right corners at 10px via a shared `clip-path` utility.
  One asymmetric cut, applied consistently — this is the only Orokin geometry the design borrows,
  and one is enough.
- Probability bars are typographic objects: a hairline track, a filled segment, the number set in
  mono immediately adjacent. Never a chart library, never a gradient.
- Vaulted content is desaturated and marked, never hidden by default.
- Density over comfort in tables. This is a reference tool used with the game running.

### Motion

Three moments, total: page transitions via the View Transitions API, filter result reflow, and the
drop-chain trace drawing in on item pages (~400ms, once). Nothing ambient. Everything disabled
under `prefers-reduced-motion`.

---

## 9. Riven tracker

### Data

- **Dispositions** from `@wfcd/items`, refreshed by the pipeline.
- **Valuation floor** from DE's weekly trade JSON: median, min, max plat and population per weapon
  per riven type. Committed weekly by the pipeline. This is a real dataset that almost nothing
  surfaces well.
- **Live listings** from `api.warframe.market` at runtime through the edge proxy, fetched on demand
  per weapon (never bulk), cached in TanStack Query with a long stale time. Respect their rate
  limits; degrade to weekly data if the proxy fails.

### Storage

IndexedDB. Explicit JSON export/import as the backup story, stated plainly in the UI: this data
lives in your browser and nowhere else — clearing site data deletes it.

Share a single roll via a URL fragment: serialize compactly, compress with `lz-string`, put it after
`#` so it never reaches a server. `/rivens/share#<compressed>`.

### Grading

For each stat, compare the rolled value against the expected range for that weapon's disposition
and the roll's stat count and polarity, and express it as a percentage of the possible range.
Show the per-stat grade and a composite, but resist reducing a riven to one letter — whether a roll
is good depends on the build, and pretending otherwise is a lie the interface shouldn't tell.
Surface the inputs; let the player judge.

---

## 10. Known hazards

Write these into code comments as you hit them.

1. **Upstream schema drift.** WFCD's categories have been renamed before (`miscItems` → `resources`).
   Zod-parse everything; fail the build rather than shipping partial data.
2. **Duplicated chance fields.** Some entries carry both `blueprintDropChance` and `enemyDropChance`
   with identical values; some carry chances as malformed strings. Normalize in one place.
3. **Wiki/official disagreement.** The wiki has entries the official repo lacks. If you join them,
   tag every edge with `provenance` and let users filter. Never silently blend the two.
4. **Non-relic gacha.** Requiem relics, Archon shards, Duviri, Netracells, and Deep Archimedea don't
   fit the standard relic model. Handle them as explicit special cases with their own edge kinds
   rather than bending the relic math to cover them.
5. **Vaulting churn.** Vaulted status changes with every Prime Access rotation. It's derived data —
   compute it in the pipeline from current relic drop availability, don't trust a static flag.
6. **Steel Path variants** have different drop tables for some content. Model as a `Source` flag,
   not as duplicated sources.
7. **Market rate limits.** Never batch-fetch listings for a full collection. Fetch per weapon,
   on demand, and cache hard.

8. **`relics.json`'s `rarity` field is unusable.** Confirmed 2026-08-22 across all 3086 entries:
   the string `"Common"` never appears once, every common-tier chance (25.33 / 23.33 / 20 / 16.67)
   is labelled `"Uncommon"`, and the Radiant *rare* rate of 10% is labelled `"Uncommon"` too.
   Derive rarity from `(state, chance)` instead — and note that chance alone is not a sufficient
   key, because 20% means common at Flawless but uncommon at Radiant. See `packages/sources/src/relics.ts`.

9. **Malformed rows exist and must be bounded, not merely tolerated.** One Requiem entry ships
   with no `relicName` at all. Skipping it is correct; skipping silently is not. The pipeline
   carries a skip budget so that one known defect passes and a sudden increase fails the build.

10. **Gates must validate the parsed data, not the fixture.** The relic-sum check was first written
    against `REFINEMENT_TABLE`, which is a constant and therefore can never fail. Pointed at the
    actual parsed relics, it immediately caught the Requiem structure (hazard 4). When adding a
    sanity gate, confirm it can fail.

---

## 11. Phases

Each phase ends deployable. Don't start the next until the current one ships.

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Monorepo scaffold, Vercel wired, CI green, empty app deployed | A commit to `main` produces a live URL |
| 2 | Pipeline v1 — items + sources + direct edges, Zod-validated, sanity gates, hashed output | `pnpm data:build` emits committed JSON; the daily workflow runs |
| 3 | Client cache + Worker indices + ⌘K search palette | Cold load < 2s, warm < 300ms, search feels instant |
| 4 | Item pages with direct drops, statically generated, design system implemented | 6k+ pages build; visual system fully tokenized |
| 5 | **Relic chain expansion** — derived edges, refinement comparison, radshare math, the chain trace | Hand-verified against three known prime parts |
| 6 | `/browse` — virtualized table, full filter set, URL state | 40k rows scroll at 60fps; every filter is shareable |
| 7 | Expected-time ranking, mission duration table, multi-component set tracking | Paths ranked by minutes; owned-parts state persists |
| 8 | Riven tracker — dispositions, weekly trade data, local storage, export/import, grading | A roll can be logged, graded, and shared by URL |
| 9 | Market proxy + live listings | Degrades cleanly when the proxy is unavailable |
| 10 | Polish — wiki supplement join, `/about` methodology page, perf pass, a11y audit | Lighthouse ≥ 95 across the board |

Phase 5 is the one that matters. Everything before it is table stakes that other sites already
have; everything after it is refinement. If the schedule slips, protect phase 5.

---

## 12. Open questions

- Console platforms: PC-only for now. Drop tables are shared, but riven trade data and market
  listings are not. Revisit only if there's demand.
- Localization: the pipeline can read localized `PublicExport` indices. Structure item names so
  a locale layer is addable later, but don't build it now.
- Should `/browse` support saved filter presets? Presets are just URLs — bookmarking may be
  sufficient, and a preset UI may be solving a problem the URL already solved.
