# Provenance — Design Document

A Warframe drop-source lookup tool. Static site, client-side data, deployed on Vercel.

> Companion document: `CLAUDE.md` holds the enforced rules. This document holds the reasoning,
> the data model, and the math. Where they disagree, `CLAUDE.md` wins and this file needs updating.

---

## 1. Goals

**Primary.** Answer "how do I get this item, and where is it likeliest" for every obtainable
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
/data/search-index.<hash>.json         NOT EMITTED — see below
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

> **Amended 2026-08-23 — no separate search index.** The palette reads `items` directly.
> A slim `[id, name, category]` index measured 40.0 kB brotli against 42.2 kB for the full
> item table: a 5.4% saving, because `Item` carries only four fields and brotli collapses
> the repeated keys. Not worth a second chunk to keep in sync, and `/browse` needs the full
> table anyway. Revisit if `Item` grows substantially — `@wfcd/items` enrichment will add
> icons, mastery rank and unique paths, which changes the arithmetic.

### Indices (built in the Worker)

> **Amended 2026-08-23 — index building runs on the main thread, not in a Worker.**
> Measured against the real dataset of 4834 items:
>
> | | |
> |---|---|
> | index build | 5.94 ms (once) |
> | search, average | 0.157 ms per query |
> | search, worst | 0.188 ms |
>
> At a sixth of a millisecond per keystroke there is nothing to move off the main thread;
> allowing an order of magnitude for a mid-range phone still leaves it inside a tenth of one
> frame. Turbopack also refuses to compile a `.ts` worker referenced via
> `new Worker(new URL(...))` — it emits the raw TypeScript as a static asset, so the build
> passes and search breaks only in production, which is a bad failure mode to accept for no
> measured gain.
>
> `createSearchIndex` in `apps/web/src/lib/search-index.ts` is pure and worker-ready.
> Revisit when `/browse` indexes the 30k edge list, or if search approaches a frame.

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
| `/` | Search-first. The palette *is* the home page. Below it: a directory of the browsable surfaces — not corpus statistics, which describe the dataset rather than offering a way in. Unbuilt surfaces are listed and marked, never linked. |
| `/item/[slug]` | The main event. Also serves assembled sets (hazard 17): an item with `components` shows a Needs table with each part's best source, and an item with `buildsInto` gets a "Part of" backlink, capped because Orokin Cell builds into 177 of them. Direct sources and relic sources side by side, each ranked by drop rate. Statically generated for every item — this is what gets indexed by search engines. **2026-08-24:** the effort model (expected time, relics needed, solo-vs-share) came off this page on owner feedback; the page answers *where*, and time-ranking belongs on a surface that compares unlike missions. `rotationCycleCost()` and `mission-durations.ts` stay in core, tested, for that surface. |
| `/source/[kind]/[...slug]` | Forward view: what a mission, enemy, bounty or syndicate drops, by rotation. Statically generated; catch-all because a source id carries slashes (`mission:earth/cambria`). **Shipped 2026-08-25.** Relics are excluded deliberately — a relic is an item too, and `/item/<relic>` already shows its contents at every refinement level, so a second page would split one object across two URLs that each know half of it. Tables here are uncapped: on `/item` the source list is context, here it IS the page. |
| `/source/[kind]` | Index of one kind, grouped by planet where the kind has one. Exists for reachability, not decoration — see hazard 15. |
| `/browse` | The filterable table. Virtualized, dense, sortable, URL-driven. |
| `/relics` | Relic browser with vaulted filtering and refinement comparison. |
| `/collection` | What you own and which sets it completes, closest to finished first. Prerendered like everything else; only the owned ids come from IndexedDB, inside a client island. Carries the export/import backup story. |
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
- ~~Probability bars are typographic objects: a hairline track, a filled segment, the number set
  in mono immediately adjacent.~~ **Removed 2026-08-24** on owner feedback. Inside one item's
  source list the bar re-encoded a numeric column that is now sorted, and its per-page `max`
  scaling meant the same 5% drew a different width on a different page — inviting a comparison
  it could not support. The number, set in mono and sorted, is the whole object.
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
4. **Non-relic gacha.** Archon shards, Duviri, Netracells, and Deep Archimedea don't fit the
   standard relic model. Handle them as explicit special cases with their own edge kinds rather
   than bending the relic math to cover them.

   **Corrected 2026-08-25:** this line used to name Requiem relics too, and the pipeline excluded
   the Requiem and Vanguard tiers wholesale on the strength of it. Checking every row showed the
   claim was true of exactly ONE relic — Requiem ETERNA, eight flat 9.5% slots totalling 76%.
   All 16 Vanguard rows and all 16 Requiem I–IV rows are ordinary 3/2/1 tables summing to 100%.
   The guess cost real coverage: Vanguard relics carry Caliban, Mesa, Ash, Protea, Ember and Volt
   Prime parts, so four relics' worth of prime-part sources were missing, along with the 1200×
   Kuva in every Requiem relic. Inclusion is now decided by SHAPE — the Intact row must derive
   cleanly to 3 common / 2 uncommon / 1 rare — and the count of rejects is budgeted so that a
   change to DE's table fails the build instead of quietly emptying the dataset.

   The general lesson: exclude on a property you can test, not on a category you inferred from
   one example.
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

11. **The reward NAME is overloaded, and unpacking it is not optional.** Upstream encodes at least
    three separate facts in the name string, each of which mints a bogus item if slugged raw:
    a refinement (`"Lith A12 Relic (Radiant)"`, 29 items), and a per-drop count in two spellings
    (`"100X Plastids"` and `"100 Endo"`, 247 items between them). Both belong on the edge —
    `refinement` and `quantity` — not in the item's identity. All of it funnels through
    `parseRewardName` in `packages/sources/src/slug.ts`; call `itemIdFor`, never `slug`, on
    anything that came from upstream.

    Unpacking must be conservative, because over-stripping invents facts as readily as
    under-stripping fragments them. `"1,500 Credits Cache"` is ONE cache paying 1,500 credits,
    not 1,500 caches, and `"3 Day Affinity Booster"` is a product name with no quantity in it at
    all. The bare-number form is therefore opt-in per noun; an unrecognised name keeps its number
    and stays whole.

13. **The WFCD item join is by NAME, and names disagree in three specific ways.** The drop
    tables carry names and odds; everything else — category, mastery, tradability, icons,
    components — comes from `warframe-items`. An exact slug match gets 75.5% of non-relic
    items. Three rules take it to 96.8%, and each exists because of a real habit:
    a part reward is "Aeolak Barrel Blueprint" where WFCD nests a component called just
    "Barrel" under "Aeolak"; an augment mod is "Abating Link (Trinity)" where the mod is
    "Abating Link"; and some WFCD names carry a UI sprite token, "<Shard_blue_simple> Azure
    Archon Shard". The remaining 3.2% genuinely are not in WFCD — credit caches, boosters,
    conclave slots — so coverage is a budgeted gate (floor 85%), not an assertion.

    Two traps worth keeping in mind. A parent's `components` array mixes true parts with
    shared build ingredients: Orokin Cell sits beside Barrel, and prefixing it would invent
    "Braton Prime Orokin Cell". Filter on `uniqueName` containing `/Recipes/`. And a part
    carries its OWN `tradable`, which usually disagrees with its parent — Braton Prime is
    untradable while every one of its parts is tradable, so inheriting the parent's flag
    would mark every prime part in the game untradable.

    Fetched as JSON per category rather than depending on `@wfcd/items`: the package unpacks
    to 101 MB that every CI run and every install would pay for, against ~36 MB of category
    files we read a handful of fields from. `All.json` is avoided too — 62 MB, and it merely
    concatenates the rest.

14. **Every id must be minted the same way, and the orphan gate is what proves it.** The quantity
    work updated four id sites and missed a fifth — relic rewards, which slugged their names
    independently. The build failed on 164 orphaned edges pointing at `2x-forma-blueprint`, an
    item that no longer existed. That is the gate doing exactly its job; without it the dataset
    would have shipped with two relic rewards silently unreachable.

15. **A statically generated page nobody links to does not exist.** `/item` caps its direct-sources
    table at 20 rows, so when the source pages first landed, 136 of the 1,646 were unreachable by
    crawl — Armored Roller ranks 487th on the best item it drops, and `/browse` can filter to it
    but renders its rows on the client, where no crawler follows. SEO is a stated goal, so the
    per-kind index pages exist to close that gap. The audit is mechanical and worth repeating
    after any routing change: walk every emitted `.html`, collect every internal `href`, and
    assert both that each one resolves to a generated file AND that every generated file is
    linked from at least one other. The second half is the half that finds this class of bug.
    Two index pages were then dropped for the inverse reason — `relic` and `cache` would have
    rendered nothing but an empty state, and an empty page is still a page a crawler finds.

16. **Verify a responsive layout by measuring it, not by screenshotting it.** Windows clamps the
    minimum window width, so `chrome --window-size=360` yields a 360px *crop* of a wider layout,
    which looks like overflow whether or not any exists — this has already produced one wrong
    diagnosis. Drive CDP `Emulation.setDeviceMetricsOverride` instead and compare
    `documentElement.scrollWidth` against `clientWidth`, then walk the DOM for elements whose
    right edge is past the viewport. That is how the enemy index's 7px overflow was found and
    confirmed fixed: a grid item defaults to `min-width: auto` and will not shrink below its
    content, so the longest name in a 1,055-row list sized the column wider than its own panel.

17. **The catalogue is built from drop tables, so it holds parts and not the things they build.**
    Braton Prime never drops; its four pieces do. That left the tool unable to answer the
    question players actually ask. Sets are therefore SYNTHESISED from WFCD recipes rather
    than read from any table, which makes two rules load-bearing:

    - A component's id depends on whether it is a part or an ingredient. WFCD nests a
      component called simply "Barrel" under "Braton Prime" and the drop table says "Braton
      Prime Barrel"; but "Orokin Cell" is its own item, and prefixing it would invent
      "Braton Prime Orokin Cell". `uniqueName` containing `/Recipes/` is the discriminator,
      same as in enrich.ts.
    - QUIRK — Warframe parts drop as BLUEPRINTS while weapon parts drop as the part itself.
      WFCD calls the component "Chassis"; the drop table says "Ash Prime Chassis Blueprint".
      Without a suffix fallback all 77 frame sets lost three components each and were
      discarded as incomplete. This one rule took fully-resolved sets from 206 to 309.

    A set ships only when EVERY component resolves. A page listing four of five required
    pieces reads as a complete answer and is not one; 673 incomplete recipes are counted and
    reported instead. Non-prime frames are the bulk of them and cannot ever resolve — their
    own blueprint is bought or quest-locked, not dropped — so excluding them is correct
    rather than a coverage failure to chase.

18. **An id reference is an id reference, whether or not it is an edge.** `buildEnrichmentIndex`
    minted `components` ids from WFCD's recipe nesting without checking any existed, so only
    5.3% of them resolved — a component named "Blueprint" became `advanced-nosam-cutter-blueprint`,
    which nothing drops. Those broken references had been shipping for weeks and were harmless
    only because no surface rendered them. Extending the orphan gate to cover `components` and
    `buildsInto` caught 72 of them on its first run. Hazard 14's argument does not stop applying
    because the reference is not an edge; `applySets` now prunes what cannot resolve, and the
    gate proves it.

19. **One database, one version, one connection.** `openDB` throws VersionError when called
    with a version LOWER than the one already open, so two modules each opening 'provenance'
    at their own version is a bug that surfaces only in whichever order the user happens to
    visit pages — the chunk cache at v1 and the collection at v2 would have broken the cache
    for anyone who opened a set page first. `lib/client/db.ts` owns the schema; every store
    is declared there and guarded by its own existence check, because the upgrade callback
    runs both for a fresh database and for each intermediate upgrade.

20. **A prerendered page has no user data, so the first paint must not pretend otherwise.**
    Every page ships as HTML built with an empty collection. A toggle that rendered its real
    state immediately would flash unchecked and then correct itself, which reads as data
    loss on the one feature where that fear is real. Surfaces render neutral until IndexedDB
    answers, gated on a `ready` flag. That flag is read from the store rather than tracked in
    the hook: the store sets it BEFORE it notifies subscribers, and a local flag assigned in
    `hydrate().then()` would be written after the notification meant to publish it, leaving
    every subscriber stale.

21. **Import merges by default.** Restoring a backup onto a device that already has a
    collection and silently discarding it is the one mistake this feature cannot make.
    Replace is offered, but as the deliberate choice. `normalizeIds` is correspondingly
    lenient — it accepts a bare array, ignores unknown fields and reads a newer `version` —
    because an import that rejects a file the user cannot repair has destroyed their only
    backup for them.

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
| 6.5 | `/source/[kind]` and `/source/[kind]/[...slug]` — the forward view, and the graph finally navigating both ways | Every source name on the site is a link; zero broken links and zero orphaned pages across all 6,223 |
| 7a | **Assembled sets** — synthesised set items, recipes, `buildsInto` backlinks | Shipped 2026-08-25: 309 sets, 161 of 163 primes; component refs resolve 100% (was 5.3%) |
| 7b | **Owned-parts tracking** — IndexedDB collection, set progress, JSON export/import | Shipped 2026-08-26: a tick survives a reload and reaches another page, verified end-to-end over CDP |
| 7c | Expected-time ranking, mission duration table | Paths ranked by minutes |
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
