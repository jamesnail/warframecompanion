# Cephalon Tel — Design Document

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

### 2.1 The one live exception

Everything about the drop graph is committed static JSON. **World state is the single
exception, and it is exempt for a reason that does not generalise:** it cannot be committed.
Fissures expire in one to three hours and Baro is present two days in fourteen, so a daily
build would publish a page that is wrong most of the time — actively wrong, not merely stale.

It is fetched in the browser from WFCD's status API, and each part of constraint 2's rationale
was checked rather than assumed:

**Source, as of 2026-08-26:** Digital Extremes' own `worldState`, mirrored minutely by
`oracle.browse.wf`. The parsed mirror this replaced (`api.warframestat.us`) froze for six hours
with its own timestamp stuck, taking the whole page down with it; a mirror of the SOURCE has one
less thing between us and the truth. The cost is that everything arrives as an internal token —
`SolNode232`, `VoidT3`, `MT_VOID_CASCADE` — so `lib/world.ts` is mostly translation, and node
ids resolve through a committed star chart.

**The star chart** comes from the Warframe wiki's `Module:Missions/data`, which publishes the
only mapping from DE's internal ids to places a player recognises. All 44 nodes the live feed
referenced resolved through it when measured. It is a Lua page, not an API — that instance has
no Cargo — so it is fetched raw and parsed field-wise, which is more brittle than everything
else here and is why the pipeline gates on the parsed count. It also carries per-node faction,
level range and tileset, none of which DE's drop tables publish at all.

| Constraint 2's reason | Why it does not apply |
|---|---|
| No CORS guarantees | Sends `access-control-allow-origin: *`. Also why no server route is needed, leaving constraint 3's single escape hatch unspent. |
| LZMA-compressed manifests | Parsed JSON. |
| Multi-megabyte HTML | 184 KB. |
| DE's "for reference only" note | This is WFCD's public API, built for third-party clients — the same project the drop data and riven prices already come from. |

The page is a prerendered shell with a client island, so constraint 4 holds. It degrades to a
stated message with a retry, and says plainly that the rest of the site still works — which it
does, because nothing else depends on this call.

**Do not treat this as a precedent.** The test is not "is it convenient to fetch live", it is
"is this datum meaningless unless it is live". Drop rates are not. Prices are not — the weekly
riven file proves it. Fissure timers are.

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

**The unit has a name, and it is not always "run".** The math above counts repetitions of one
act. For a mission, a bounty or a fissure that act is a run; for an enemy it is a kill, and
labelling it a run is wrong in a way players notice — one Survival run produces dozens of the
eximus unit that drops the mod, so "expected runs: 51" reads as fifty-one missions when it
means fifty-one bodies. `attemptNoun()` in `packages/core/src/attempts.ts` is the single place
that decides; only `enemy` is a kill, because `cache` and `transient` are both reached by
queueing the mission.

> **Amended 2026-08-28.** This previously ruled the opposite way — always "runs", never
> "kills", on the argument that the run is the unit every source has in common and switching
> nouns makes the same statistic incomparable between two pages. Overruled by the owner. The
> comparability argument was real but bought at the price of being wrong on 935 items, and
> the pages that quote a figure now also name what they counted, so nothing is silently
> compared.

Two grains follow from that. A figure describing ONE source takes that source's noun. A
table whose rows span several — 492 items mix enemy drops with mission or bounty drops — has
no single noun, so its effort column names both (`attemptColumn`) and each row's own detail
line, which already reads "Enemy" or names a mission type, is the discriminator. Inventing a
neutral third noun ("attempts", "tries") was rejected: it appears nowhere in the game's
vocabulary, and CLAUDE.md's copy rule forbids friendlier synonyms for game terms.

A relic chain is the one composite. `chainRuns` there sums farming the relic with cracking it
at a fissure, so `chainNoun` reports runs even when an enemy drops the relic — the fissure is
a mission you queue, and "kills" would name only half the total. The trace's first hop still
says "Kill", because that hop really is one.

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
| `/item/[slug]` | The main event. Also serves assembled sets (hazard 17): an item with `components` shows a Needs table with each part's best source, and an item with `buildsInto` gets a "Part of" backlink, capped because Orokin Cell builds into 177 of them. Direct sources and relic sources side by side, each ranked by drop rate. Statically generated for every item — this is what gets indexed by search engines. **2026-08-24:** the effort model (expected time, relics needed, solo-vs-share) came off this page on owner feedback. **2026-08-26:** time ranking was dropped from the project entirely and its code deleted — the page answers *where*, and there is no longer a later surface waiting for a duration model. |
| `/source/[kind]/[...slug]` | Forward view: what a mission, enemy, bounty or syndicate drops, by rotation. Statically generated; catch-all because a source id carries slashes (`mission:earth/cambria`). **Shipped 2026-08-25.** Relics are excluded deliberately — a relic is an item too, and `/item/<relic>` already shows its contents at every refinement level, so a second page would split one object across two URLs that each know half of it. Tables here are uncapped: on `/item` the source list is context, here it IS the page. |
| `/source/[kind]` | Index of one kind, grouped by planet where the kind has one. Exists for reachability, not decoration — see hazard 15. |
| `/browse` | The filterable table. Virtualized, dense, sortable, URL-driven. **2026-08-28:** six filter params collapsed into one query string (§ 11); the chips now write query terms rather than holding state of their own, so a chip and the same text typed by hand produce the identical URL. `-is:vaulted` is the old **Farmable now** filter — 455 of 582 prime parts are reachable only through a vaulted relic, so it is a different question from "where is it from". When a query matches items but no rows, the empty state lists the items: `is:prime cat:warframe` has 50 answers and zero drop rows. |
| `/relics` | **Shipped 2026-08-26.** 771 relics, tier and vault filtering, and the refinement ladder stated once. Distinct from `/browse?category=Relic`, where a row is one EDGE and a relic appears once per place it drops; here a row is one RELIC and the question is what is inside it. Search matches CONTENTS, because you look for the part, not the relic. |
| `/collection` | What you own and which sets it completes, closest to finished first. Prerendered like everything else; only the owned ids come from IndexedDB, inside a client island. Carries the export/import backup story. |
| `/settings` | **Shipped 2026-08-28.** Every preference on one page rather than in a popover — enough controls that a menu would scroll, and a page is a URL you can send ("turn on high contrast" is a link). Prerendered; only the values come from IndexedDB. `noindex`, like `/collection`. |
| `/rivens` | Disposition and weekly trade price per riven FAMILY (see § 9.2), sortable and filterable. Prerendered shell, client table, 132 KB chunk. Weapons link to their item page only where the drop data knows one — 243 of 687; the rest are bought, never dropped. |
| `/farm` | **The plan.** What to run next, ranked. Intersects the explicit farm list (see hazard 38) with the drop chains and the live fissure list, then groups by the ACTION that advances the most parts — one Neo fissure run counts toward every part behind a Neo relic. Chains come from the same `buildBestChain` the item pages use, so the plan can never contradict the page it links to. `noindex`: it is whatever the viewer has ticked. |
| `/world` | **The one live surface.** Open fissures by relic tier, invasions, sortie, archon hunt and Baro, fetched from a mirror of DE's own `worldState` (§ 2.1) into a client island under a prerendered shell. Open-world cycles sit above all of it and are *computed*, not fetched — see hazards 39 and 40 — so they survive the feed being down. This is also where the Factions tile ended up. |
| `/about` | Data sources, update cadence, attribution, methodology — including honest notes on where the numbers are estimates. |

`generateStaticParams` over every item and source produces roughly 6,500 static pages. That is well
within Next's comfort zone and is the backbone of the SEO strategy: each page targets the query a
player actually types, which is the item name plus the word "drop".

Generating them is only half of it, though — a crawler still has to find them. Three things close
that gap: the per-kind source indexes make every page reachable by following links (hazard 15),
`sitemap.xml` makes them discoverable without the walk, and every page declares a canonical so the
many filtered `/browse` permutations consolidate onto one URL instead of competing with each other.
`/collection` is `noindex` and absent from the sitemap — its content is whatever the viewer has
ticked, so there is nothing stable to index.

The canonical origin lives in `site.ts` as a plain constant, NOT an environment variable. Vercel's
own `VERCEL_URL` is per-deployment, so a preview build would emit canonicals pointing at itself and
invite search engines to index a throwaway origin. Attaching a custom domain means editing that one
line — and it lifts the SSO gate too, since Vercel exempts custom domains from it.

---

## 8. Visual system

### Direction

**Orokin.** Warm near-black plating, gold ornament, chamfered framing, a faint hex lattice behind
everything. The tool as an Orokin instrument rather than a web page about one.

This is the third direction, and the history matters because it is the argument that keeps
getting tested. The original was deliberately *un*-Warframe: it held that Orokin gold-on-black is
what every fan site already does, that the generic "dark dashboard with an acid accent" is what
every AI-generated data tool does, and that the way to avoid both was to look like a precision
readout rather than a tribute. On 2026-08-26 that gave way to a Tenno HUD palette; later the same
day the owner asked for the full Orokin treatment — new palette, new layout, hover motion, a
background — which is what this section now describes.

The part of the original argument that was wrong: that committing to the subject costs
seriousness. It does not. A tool used exclusively with Warframe running in the other window has
nothing to gain from pretending otherwise, and "looks like nothing in particular" was never
actually a goal anyone had.

The part that was right, and still governs every decision below:

- The accent appears **once per view**, on the thing you searched for. That is why gold has two
  weights (§ Palette): the moment ornament and accent share a value, "important" stops meaning
  anything. If a screen has two things glowing, one of them is wrong.
- Density and legibility outrank flavour, always. Every colour is contrast-measured before it
  ships, and the ones that fail get changed rather than kept for looks.
- Nothing moves unless the reader moved it. Hover responds; the page does not perform.

### Logo and icons

The logo is a hexagonal badge with a P monogram — the hexagon echoing the same Orokin
chamfer the panels use. It is supplied as dark slate on transparency, so it is composited
onto a light plate for every derived icon: left as-is it would be invisible against this
site’s near-black background. Inverting it for a dark plate is an open question for the
owner, not something to decide in a build script.

`icon.png` and `apple-icon.png` are the MONOGRAM only. The full lockup is unreadable at
16px, which is the size that actually matters for a favicon; `opengraph-image.png` uses the
whole lockup because 1200×630 can carry it. Regeneration is documented in `assets/README.md`.

### Layout

A persistent sidebar on `lg` and up, a top bar and drawer below it. The sidebar carries routes
only — never a filtered view of one, never a surface that has not shipped — because navigation is
used dozens of times a session and every extra row costs the reader something. The home page keeps
the opposite job: it is the full directory, including the pre-filtered `/browse` views and the
surfaces still to come.

Every route opens with the same hero: kicker, title in accent gold, optional lede, actions, and a
gold rule that fades out to the right. Below it, where a page has a number worth leading with, come
summary cards — and only then the dense table. That ordering is the point of the restructure: the
question people arrive with is "can I farm this right now", and the old layout made them read a
39-row table to find out that 2 rows mattered.

The breadcrumb and the per-page search trigger both went away with this. The shell carries the
palette on every route, and the sidebar makes the breadcrumb's parent link redundant on all but
the source detail pages, which keep theirs as the kicker.

### Signature element

**The drop-chain trace.** A rendered path from item back to the mission you actually queue, drawn
as a connected vertical trace with the probability compounding visibly at each hop. It's the one
thing here no other tool does well, it's the direct visual expression of the hardest problem the
codebase solves, and it's what people will screenshot into clan chat. Every other component should
be quiet enough to let it be the memorable thing.

### Palette

Warm near-black plating, gold ornament. Defined in OKLCH so the rarity ramp can hold constant
chroma and lightness across hues; those four colours then read as one measurement scale instead
of four unrelated tags. `globals.css` is authoritative — the block below is the summary.

```css
--void-950:        oklch(0.09  0.012 70);  /* wells, inset, code */
--void-900:        oklch(0.135 0.014 72);  /* page */
--void-800:        oklch(0.18  0.017 74);  /* panel */
--void-700:        oklch(0.235 0.020 76);  /* raised / table header */
--void-600:        oklch(0.30  0.024 78);  /* hover */
--hairline:        oklch(0.35  0.030 80);  /* 1px structure */
--hairline-strong: oklch(0.50  0.055 82);
--text:            oklch(0.95  0.014 85);
--text-dim:        oklch(0.76  0.022 82);
--text-faint:      oklch(0.70  0.026 80);
--gold:            oklch(0.84  0.140 88);  /* accent. once per view. */
--gold-dim:        oklch(0.62  0.075 86);  /* ornament. never text. */

/* rarity ramp — constant C and L, hue only varies */
--r-common:    oklch(0.72 0.10 250);
--r-uncommon:  oklch(0.72 0.10 150);
--r-rare:      oklch(0.72 0.11 320);
--r-legendary: oklch(0.72 0.10  20);
```

Three decisions in there are load-bearing:

**Gold has two weights.** This is what makes an all-gold theme survive the once-per-view rule.
`gold` is the accent and appears on one thing per screen; `gold-dim` is ornament — frames, corner
braces, rules, the panel-header diamond — and is deliberately too low in contrast to be usable as
text, so it cannot quietly become one. A single gold value was tried first and made every panel
header shout as loudly as the page title.

**"Rare" gave up gold rather than the theme keeping it.** Rare sat at hue 85, which is exactly
where Orokin gold lives. A page where everything is gold cannot also use gold to mean "rare", so
rare moved to magenta at 320 and the other three ramp hues stayed put. The ramp lost a hue it had
a claim to; the alternative was an accent that meant two things at once, which is the failure this
project has now made twice and does not intend to make again.

**The surfaces are warm, not neutral.** Gold on a neutral or cool black reads as brass. The void
ramp carries a low warm chroma (hue 70–78) specifically so the ornament reads as gold, and that is
also what keeps a near-black page from looking like default dark mode.

Contrast is machine-measured before anything ships, not eyeballed. Under this palette the tightest
text pairing is `text-faint` on `void-600` — the row-hover surface — at **5.11:1**, and `vaulted`
content composites to 6.12:1 on a panel. `gold-dim` is the sole exemption and is ornament-only,
which is why it is a separate token rather than an opacity applied to `gold`: a token you cannot
put text on should not look like one you can.

### Background

A hex lattice — chamfered hexagons with radial spurs — drawn once as an inline SVG and tiled at
120px on `body::before`, at **0.055 opacity**. Fixed rather than scrolling, so it never repaints,
and `pointer-events: none` so it never hit-tests. About 400 bytes, no network request, no decode.

The opacity is the entire design decision. It is deliberately at the edge of perceptible: this is
a reference tool read for long stretches with the game running, and a background that competes
with a drop-rate column is a defect no matter how good it looks in a screenshot. It survives
`prefers-reduced-motion` because it is texture, not motion — a reader who asked for less movement
did not ask for less texture.

### Type

- **Display:** Archivo Expanded, 600–700, tight tracking, sentence case. Wide industrial grotesque
  reads as signage and instrumentation. Chosen specifically to avoid the sci-fi font cliché —
  no Rajdhani, no Orbitron, no Chakra Petch.
- **Body / UI:** Inter Tight.
- **Data:** IBM Plex Mono, always `tabular-nums`, for every percentage, duration, and count.

Scale: 12 / 14 / 16 / 20 / 28 / 40. Six sizes, no more.

### Structure

- Panels chamfer their top-left and bottom-right corners at 10px via a shared `clip-path` utility.
  One asymmetric cut, applied consistently.
- **Corner braces.** The chamfer cuts two corners; the other two get a short right-angle tick in
  `hairline-strong`. That is the HUD-framing motif and the whole of it — the theme is carried by
  framing and palette, not by added ornament. Drawn as four background gradient layers on the
  `panel` utility rather than pseudo-elements, so it costs no DOM, cannot be displaced by panel
  content, and survives the `clip-path` that would slice a real border off.
- **Panel headers carry a 2px tick** before the title, in the same `hairline-strong` as the
  braces, and sit on a brighter rule. It was drawn in the accent for one revision, which put a
  cyan mark on every header — four on /world — and quietly broke the once-per-view rule the
  Direction section above insists on. Framing colour, not accent. Decorative and therefore
  `aria-hidden`, with the heading text doing the actual labelling.
- ~~Probability bars are typographic objects: a hairline track, a filled segment, the number set
  in mono immediately adjacent.~~ **Removed 2026-08-24** on owner feedback. Inside one item's
  source list the bar re-encoded a numeric column that is now sorted, and its per-page `max`
  scaling meant the same 5% drew a different width on a different page — inviting a comparison
  it could not support. The number, set in mono and sorted, is the whole object.
- Vaulted content is desaturated and marked, never hidden by default.
- Density over comfort in tables. This is a reference tool used with the game running.

### Motion

Page transitions via the View Transitions API, filter result reflow, the drop-chain trace drawing
in on item pages (~400ms, once), and hover feedback. Nothing ambient. Everything disabled under
`prefers-reduced-motion`.

Hover is one duration and one curve for the whole app — `--duration-hover` (150ms) and
`--ease-orokin` — because feedback that varies in speed between components reads as jitter rather
than as one interface. Two treatments:

- **`hover-lift`** on tiles and controls: a 2px rise plus a warmer frame.
- **`hover-edge`** on block rows: a gold bar wipes in from the top of the row's leading edge, via
  `scaleY` on a pre-placed element so the animation is compositor-only.

Table rows and virtualised rows get the background change only, not the edge. `::before` on a
`<tr>` is unreliable across engines, and `hover-edge` sets `position: relative` — which on rows
absolutely positioned by TanStack Virtual would collapse the entire list to the top of its
container. Both are the kind of thing that looks fine in a screenshot and is broken in use.

---

## 9. Riven tracker

### Data

- **Dispositions** from `@wfcd/items`, refreshed by the pipeline. Both forms are carried: the 1-5
  dots the game draws, and `omegaAttenuation`, the multiplier it actually applies. Players say the
  dots to each other; the multiplier is the precise number. Rounding one back from the other at
  render time would reinvent a value we were handed.
- **Valuation floor** from DE's weekly trade JSON, mirrored by WFCD's status API: median, min, max
  plat and population per weapon per riven type. Fetched at BUILD time and committed as static
  JSON like everything else, so the riven surface needs no server route and no runtime market call.
- **The trade file carries no timestamp of its own.** DE republishes it weekly and dates nothing,
  so the only honest provenance is when the pipeline read it — recorded in `manifest.upstream` as
  `riven-trades-fetched` and NOT rendered as a publication date, which it is not. An early draft
  of the page borrowed `manifest.builtAt` for this, which is the drop tables' date and has nothing
  to do with riven prices.
- **Live listings** from `api.warframe.market` remain unbuilt, and are the only reason the market
  proxy in constraint 3 would ever be needed. The weekly file covers the question without it.

### Storage

IndexedDB. Explicit JSON export/import as the backup story, stated plainly in the UI: this data
lives in your browser and nowhere else — clearing site data deletes it.

Share a single roll via a URL fragment: serialize compactly, compress with `lz-string`, put it after
`#` so it never reaches a server. `/rivens/share#<compressed>`.

### 9.1 Market: a link, not a proxy

The plan was an Edge pass-through to `api.warframe.market` serving live listings. What shipped
instead is a link to the item’s page there, and the reasoning is worth keeping because the
investigation changed the answer twice.

- **The proxy would genuinely have been required.** CLAUDE.md hedged that the API "may not"
  send CORS headers. It does not — no `Access-Control-Allow-Origin` on any response — so
  unlike world state, a browser cannot call it directly.
- **The v1 API is retired.** `/v1/items` 404s and the v1 orders endpoint 403s. Anything built
  against the API this document was drafted from would have been dead on arrival. Current is
  `/v2/orders/item/{slug}`.
- **The payload is mostly noise.** One item is 135 KB and 278 orders, of which 11 were from
  sellers actually in game. A proxy worth having would have had to trim it to a handful of
  numbers, which is real server-side logic to own, cache, rate-limit and keep working.
- **A link costs none of that** and shows more: every open order, both sides, live, on a page
  built for exactly that. Owner’s call, and the right one.

The slug is resolved at BUILD time against warframe.market’s own catalogue — one request for
all 3,840 entries — joined on `gameRef`, which is the same `/Lotus/...` uniqueName our items
already carry from WFCD. 3,185 of 4,875 items link. See hazard 28 for why the obvious
shortcut is wrong.

---

### 9.2 Rivens are per FAMILY, not per weapon

A riven mod fits every variant of a weapon: a Cernos riven works on the Cernos, the Cernos
Prime and the Rakta Cernos. That is why the market lists Cernos riven trades and no Rakta
Cernos ones — and why the existence of *separate* Mutalist Cernos trades is the signal that it
is a family of its own rather than another Cernos variant.

The first cut modelled one row per weapon. That listed the same tradeable mod three times and
implied two prices that do not exist. The shipped model is 516 families covering 724 weapons.

**Deriving the families.** No upstream publishes them. WFCD has no variant link, and the
`uniqueName` paths do not share a key (`AntlerBow` / `PrimeCernos` / `RVCernos`). The
candidates are therefore the names DE's weekly trade file lists, because those ARE the riven
mods that exist; a weapon joins the family whose name appears in its own at a word boundary,
LONGEST match first. Longest-first is load-bearing, not an optimisation — matching "Cernos"
before checking "Mutalist Cernos" would silently merge two separately traded rivens. Hyphens
count as boundaries, so `Mk1-Braton` joins Braton.

**Disposition stays per weapon.** Cernos is 1.30 while Cernos Prime and Rakta Cernos are both
1.25, and the game applies the disposition of whichever weapon the riven is equipped on. So the
price belongs to the family and the disposition belongs to the member. A variant's item page
says so in as many words, because a reader who assumed the price was for a "Cernos Prime riven"
would go hunting for a mod that does not exist.

---

### Grading — deliberately not built

The original plan was to compare each rolled stat against the range that weapon's disposition
allows and express it as a percentage. That was scoped out on 2026-08-26, and the reason is worth
keeping: **no upstream source publishes those ranges.** WFCD gives `disposition` (1-5 dots) and
`omegaAttenuation` (the real 0.5-1.55 multiplier), and DE's trade file gives prices. Neither gives
the per-stat base values a grade would need, so building one would mean reconstructing Warframe's
stat formulas from memory and presenting the output as fact.

That is the exact failure mode this project exists to avoid. A drop rate we cannot source is left
blank; a riven grade should be held to the same standard. Disposition and price are both published
facts and are what a player actually checks before buying or rolling, so the surface ships those
and stops there.

If a source for the stat ranges ever appears, this is a clean addition rather than a rewrite: the
weapon table is already keyed the right way.

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
    pieces reads as a complete answer and is not one; incomplete recipes are counted and
    reported instead.

    **Corrected 2026-08-28.** This entry used to close by saying non-Prime frames were the
    bulk of the unresolved and could never resolve. That was true when it was written and
    the Blueprint-suffix rule above is what stopped it being true: 27 of the 30 non-Prime
    Warframes now resolve completely, and only Excalibur, Mag and Volt do not, because their
    blueprints are not in the drop tables at all. The stale claim also reached `/about` and
    sat there underselling the tool for a month, because it was prose rather than a count.
    Anything on that page that can be counted is now counted — see § 7.

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

22. **Vaulting is a property of the PATH, not the item.** A prime part can sit in one relic
    still in rotation and four that are not; collapsing that to a per-item flag would hide
    the one row that still works. Braton Prime Barrel is in 39 relics and exactly 2 of them
    are live. So the flag rides on the browse ROW, derived from the relic source, and the
    filter cuts paths rather than items. The relic source and the relic item are the same
    object under two ids — `relic:axi-a1` and `axi-a1-relic` — and only the item carries
    `vaulted`, because vaulting is itself derived from whether anything currently drops it.

23. **A sitemap that advertises a 404 is worse than no sitemap.** The URLs are built by the same
    `sourceHref`/`needsSourcePage` resolver the pages themselves use, never by re-deriving the
    path, so the two cannot drift. Verified by cross-checking every `<loc>` against the emitted
    `.html` files: 6,531 URLs, 0 with no page, 0 duplicates, and the only built page absent from
    the sitemap is `/collection`, which is deliberate.

24. **A median is only as good as its sample, and riven prices prove it.** The five most expensive
    rerolled medians in DE's trade file each come from a SINGLE trade — Arca Scisco reads 15,000
    platinum on a population of one. Sorting by price without saying so would put pure noise at the
    top of the table and call it a market. So `pop` rides under every price, anything under three
    trades is called out in the warning colour rather than presented as a number, and "min trades"
    is a first-class filter, not a nicety. The mean is carried in the data and never shown: the
    file's own `avg` sits far above its `median` on almost every weapon, which is the skew
    admitting itself.

25. **Audit link integrity against `prerender-manifest.json`, not against the filesystem.** Next
    leaves stale `.html` files in `.next/server/app` when a route stops being generated —
    `/item/hek` sat there from an earlier build, served a 404, and still looked like a valid page
    to a directory walk. Every earlier "zero broken links" run used that walk, so a link to a
    deleted page could have audited clean. The manifest is the list of routes that actually ship;
    a clean `rm -rf .next` build confirms the two agree.

26. **Upstream returns fissures that have already expired, and its payload can be half an hour
    old.** In one live sample 13 of 32 fissures were past their own `expiry`, some by 27
    minutes, while the payload's own `timestamp` was 32 minutes behind the wall clock. Rendering
    the raw list under a heading that says "32 open" states something false. Filter on the
    READER's clock — the expiry is absolute UTC — and surface the payload age when it exceeds
    five minutes. Countdowns are likewise recomputed locally rather than using the `timeLeft`
    string upstream supplies, which is calculated when the API responds and is wrong by however
    long the payload sat in a cache.

27. **Parsing a label is not the same as knowing the page exists.** `nodeToSourceId` happily
    turns "Eurasia (Earth)" into `mission:earth/eurasia`, and an early version linked on that
    alone — producing 404s for the ~15% of star-chart nodes that have no unique drops and so
    never appear in the drop tables. The fix is to ship the real id set from the server (435
    mission ids, ~12 KB) and check membership before linking. Runtime values that CANNOT be
    checked that way — invasion and Baro reward names, which include items like Dera Vandal
    parts that drop nowhere else — render as plain text instead. An end-to-end check that
    actually fetches the links a page renders is what caught this; reading the markup would not
    have.

28. **Do not derive another site’s slug from your own.** `braton-prime-barrel` →
    `braton_prime_barrel` looks like the whole problem and is right about 74% of the time.
    The 26% is not random: assembled weapons are sold as `<name>_set` (`akbronco_prime_set`),
    augment mods drop the warframe suffix our id keeps (`abating-link-trinity` is their
    `abating_link`), and some items are simply not traded. Join on an identity instead —
    `gameRef` is the `/Lotus/...` uniqueName both sides already have — and the match rate is
    99.5% of tradable items with zero guesses. A link that exists is then a link that resolves.

29. **Our `tradable` flag is not the authority on what a market sells.** 486 items it marks
    untradable have warframe.market pages, assembled Prime sets among them. Gating the link on
    our own flag would have silently dropped every one. Their catalogue answers the question
    "do they sell this"; ours does not.

30. **A pooled haystack is wrong when one row holds several distinct things.** `/browse`
    matches every search term anywhere in a row's combined text, which is right there because
    a row is one item from one source. A relic holds six different rewards, so the same rule
    let "braton prime barrel" match a relic containing Braton Prime *Receiver* alongside a
    different prime *Barrel* — 79 relics, where the item page's independently computed count
    said 39. Terms must all land on the SAME field: the relic's name, or one reward's name.
    The cost is that "lith forma" now finds nothing, which is the right trade — the tier
    filter expresses that exactly, and a false positive here is silent where an empty result
    is not.

31. **`sr-only` is `position: absolute`, so it escapes an `overflow-x-auto` container.**
    Adding screen-reader-only full words beside abbreviated column heads put 13px of real
    horizontal overflow on `/relics`: the spans were not clipped by the scroll container,
    they grew the document. Put the accessible name on the `<th>` with `aria-label` and mark
    both visible spans `aria-hidden` instead. Same root cause as hazard 16 — and note the fix
    is to stop emitting an absolutely positioned element inside a scroll container, not to
    widen the container.

32. **Upstream title-cases roman numerals, and BOTH upstreams do it.** "Lavan Apoc Mk III"
    arrives as "Mk Iii" — from WFCD *and* from DE, whose drop tables carry 30 such names and
    zero correct ones. 115 items were affected. Normalised once, after every name is minted,
    with an explicit allowlist of numeral tokens rather than a "looks like a numeral" pattern:
    a pattern also matches ordinary words, and this is a game that names things Ivara and Xaku.
    Ids are untouched because they are slugged lowercase, so the fix cannot break a bookmark.

33. **An `omegaAttenuation` is not proof a thing takes a riven.** Reading it that way put
    Operator Amps, K-Drive parts, Exalted weapons and Conservation Prey in the riven table —
    86 entries. The fix is a denylist of the four classes that genuinely cannot rather than an
    allowlist of those that can, so a weapon class added upstream shows up rather than silently
    vanishing. The inverse error was live at the same time: an allowlist of weapon TYPES was
    dropping 163 real weapons because `Bow`, `Sniper`, `Launcher` and `Dual Pistols` were
    missing from it, which is how Cernos Prime and Rakta Cernos went absent. Take the riven
    class from the family's traded entry, which is authoritative, and fall back to weapon type
    only when the trade file is silent.

34. **A frozen feed is not a quiet one, and must not be rendered as data.** The world state
    mirror stopped publishing with its own `timestamp` stuck at a single value for over six
    hours. Every fissure, the sortie and every open-world cycle had expired, so the page
    rendered as a wall of "expired" — which reads as this site's defect and tells the reader
    nothing true. Filtering expired rows was not enough: when the feed stops, there are no
    unexpired rows left to show. Compare the payload age against how fast the content actually
    turns over — cycles roughly 50 minutes, fissures one to three hours — and treat anything
    past 30 minutes as stopped: say so, name the age, and render none of the time-sensitive
    sections. There is no honest half-measure, because a stale fissure list is not "mostly
    right", it is a list of things that are over.

35. **A list where some entries link and some do not reads as broken.** 71 of the 180
    multi-weapon riven families end on a variant this site has no page for, because that
    weapon is bought rather than dropped and so never appears in the drop tables. Rendering
    those as plain text that looked identical to a link made them read as dead links rather
    than as "there is nothing here to open". Draw the difference — underline the ones that go
    somewhere — rather than inventing a destination for the rest.

36. **Prefer a mirror of the source to somebody else's summary.** The world state page was
    built on `api.warframestat.us`, a parsed mirror, because parsed is easier to consume. When
    it froze the page had nothing to fall back to. DE's own `worldState` is mirrored by
    `oracle.browse.wf` with the same open CORS, and reading it costs a translation layer —
    internal node ids, `VoidT3`, `MT_VOID_CASCADE` — which is real work but buys independence
    from one intermediary's uptime. The wiki was initially written off here as "not a source at all"
    because its front page computes Baro and the open-world cycles from fixed epochs
    client-side and shows no fissures. That was the wrong conclusion: a fixed epoch plus fixed
    phase lengths IS the source for a deterministic cycle, and a better one than any feed,
    because it cannot go stale or go down. Those epochs now drive `packages/core/src/cycles.ts`.
    What the wiki genuinely does not provide is *state* — fissures, invasions, Baro's actual
    manifest — which still comes from the mirror.

37. **A shared component contaminates any rollup through it.** To make `is:prime cat:warframe`
    work, a set has to inherit its components' sources — a set has no edges of its own. Done
    naively, Ash Prime inherits Orokin Cell's 121 edges and reports itself as dropping from
    missions, bounties, transients and enemies, so `from:enemy` matches every prime Warframe
    in the game. The rule: roll up only through components **exclusive to the set**, meaning
    `buildsInto` names at most one thing. Measured — Ash Prime resolves to `relic` alone, all
    50 prime Warframes resolve, 311 of 313 sets resolve, and the 34 excluded components are
    every one of them a generic resource. This is the same shape as hazards 17 and 38, which is
    why it is a rule and not a third special case: a component shared by many parents carries
    no information about any one of them.

38. **Intent cannot be inferred from inventory.** /farm originally derived "what you are
    working on" from owned parts: any set in which you held at least one component. That reads
    as reasonable and collapses on the first shared component — Orokin Cell belongs to 177
    sets, so owning one put 177 sets on the plan, each "finished" by the same cell. The fix is
    not a better heuristic, it is a second list: `owned` is inventory, `tracked` is intent, and
    the user states the second rather than the tool guessing it. Both are exported, because a
    backup that restored the collection and dropped the plan would lose half the user's work.

39. **A deterministic cycle needs no feed, and a long baseline is what makes it checkable.**
    Cetus day/night, Vallis warm/cold, Cambion Fass/Vome and Duviri's spiral are fixed
    rotations of fixed-length phases, so one known instant locates them forever with no
    network call at all — arithmetic on the reader's own clock. The constants are the Warframe
    wiki's (`Template:CycleClock`), and the Cetus one is *verified*: DE's bounty rotation turns
    over on the same 150-minute boundary, and the epoch predicted it to within **3.3 seconds**
    on 2026-08-27. That number is only meaningful because the epoch is ~2,400 cycles in the
    past — any error in the phase length is multiplied by 2,400, so agreeing to 3.3s bounds the
    period error to ~1.4ms per cycle. It is also why the phase length keeps its odd `- 1126`ms
    rather than a neat 150 minutes: rounded, it would drift ~45 minutes over that span. A unit
    test pins the comparison so nobody "tidies" the constant away.

40. **An epoch that is one phase out is worse than no epoch.** The same wiki template lists a
    Zariman epoch. It is wrong — on 2026-08-27 it computed Corpus while DE published Grineer,
    inverted, with the period itself correct. The wiki's own gadget does not trust it either
    and fetches the live faction. So the Zariman is the one cycle here that is fetched rather
    than computed, and it simply disappears when the feed does, while the other four keep
    running. Confidently wrong is the failure mode to design against; absent is fine.

41. **`Time` is the one field DE publishes in seconds.** Every other timestamp in `worldState`
    is milliseconds inside a `{ $date: { $numberLong } }` wrapper. Reading `Time` the same way
    dates the payload to 1970, which makes a perfectly healthy feed look 56 years stale and
    trips the staleness guard on every load. Caught by a unit test asserting a healthy feed is
    NOT stale — the assertion that would otherwise never have been written.

---

## 11. The query language

One grammar, shared by the ⌘K palette and `/browse`, replacing the six filter parameters
`/browse` used to carry. Shipped 2026-08-28.

### 11.1 It is defined over items, not edges

The obvious design — evaluate over the 28,020-row edge table, the grain `/browse` already
uses — was prototyped first and measured against real data:

    is:prime cat:warframe    rows=0   items=0
    cat:melee from:bounty    rows=0   items=0

All 50 prime Warframes have **zero drop edges of their own**. An assembled set is not dropped,
its parts are. 1,046 of 4,875 items have no edge at all, and the number decomposes exactly:
737 vaulted relics plus 309 assembled sets. So the grain is a correctness constraint, not a
preference — a language evaluated only over edges cannot answer the question the feature
exists to answer.

The language is therefore defined over **items**, and edge facts are reached by an existential
lift: `from:relic` on an item means "has at least one relic path". Both grains share one
evaluator, so the same term cannot mean different things on different surfaces.

| Grain | Surface | A result is |
|---|---|---|
| Item | palette; the empty-state fallback on `/browse` | one item |
| Path | `/browse` rows | one item-from-one-source path |

One consequence is accepted deliberately: at item grain `from:relic chance:>10` is "has a
relic path AND has a >10% path", not "has a >10% relic path". A conjunction of two existentials
is not one existential over a conjunction. The tight reading needs a scoping syntax nobody
types; `/browse` gives the exact answer at path grain.

### 11.2 Two indexes, loaded in two stages

The palette boots on the 1.1 MB item chunk alone, which answers every intrinsic key — `cat:`,
`mr:`, `is:prime`, `has:market`. A query that asks about paths (`from:`, `planet:`, `tier:`,
`rotation:`, `chance:`, `source:`, and `is:vaulted` for anything but a relic) needs the 3.9 MB
edge chunk, which is fetched the first time one is typed and not before. `queryNeedsPaths` is
what makes that decision; without it the palette would either load 5 MB to power a search box
or silently return nothing for half the language.

`tier:` is the exception that avoids a third chunk: the relic tier is the first word of the
relic source's name on 771 of 771 relic sources, measured, and validated against `RelicTier`
rather than trusted. Loading the 294 KB relic chunk to look up one word would have cost more
than the key is worth.

### 11.3 What it does not do

No `OR` and no parentheses. Every real query written while designing this was a conjunction,
and `OR` doubles the parser and the error surface to serve queries a second bare word already
approximates.

No `faction:`, `tileset:`, `level:` or `is:steelpath`. All four are declared in `types.ts`
and all four are populated on **0 of 2,417 sources**. Faction can be partly recovered by joining
missions to `nodes.json`, but that join reaches 234 of 435 mission sources — 20% of all edges.
A key that silently misses four-fifths of the graph is worse than a missing key, because a
reader takes an empty result for an answer. It ships when the pipeline populates the field.

No `provenance:`: all 28,020 edges are `official`, so the key would have exactly one value.

### 11.4 The URL

The whole filter state is one `q=` param holding the literal text the user typed. Old
six-param links are translated once on mount and replaced — a pure function, tested by
comparing result sets rather than strings, and deliberately not a permanent compatibility
layer, because two live ways to express one filter is how the URL stops being the source of
truth.

This closes § 19's open question about saved presets with a no: once the URL holds the query
text, the bookmark **is** the preset.

---

## 12. Settings

Viewer preferences: theme, density, motion, and three switches for what the tool shows.
Shipped 2026-08-28.

### 12.1 IndexedDB is the record; localStorage is a mirror

Constraint 1 names settings as user data, so they live in IndexedDB beside the collection and
ride in the same export file. But theme, density and motion have to be on `<html>` **before
the first paint**, and IndexedDB cannot be read synchronously — a pre-paint script that reads
it is not a thing that can exist. So a copy is kept in localStorage, read by a small inline
script in `layout.tsx`, ahead of any stylesheet.

The mirror is never authoritative. On hydrate IDB wins and the mirror is rewritten from it. If
localStorage is blocked, everything still works and the first paint is simply the default.
Verified: set Grineer + Compact, reload, and the attributes are already correct at 150 ms;
delete the mirror, reload, and IDB restores it.

### 12.2 A theme is values, never names

Each theme redefines the same semantic tokens. Nothing outside `globals.css` knows a theme
exists — `bg-void-800` resolves through one custom property in all four, so no component is
theme-aware and no class changed.

Two rules hold across all four. The rarity ramp's HUES never move, because rarity colour
encodes a measurement; high contrast lifts lightness and chroma uniformly across all four
rarities, which preserves the scale rather than restyling it. And the two gold weights keep
their contract under their new hues: `gold` may carry text, `gold-dim` may not.

Contrast was measured for every foreground against every surface it can sit on, not assumed:

| Theme | Tightest text pairing | `gold-dim` (ornament, must not carry text) |
|---|---|---|
| Orokin | 5.11:1 | 3.74:1 |
| Corpus | 5.51:1 | 4.01:1 |
| Grineer | 5.60:1 | 3.44:1 |
| High contrast | 9.22:1 | 7.02:1 |

The palette blocks are attribute selectors rather than `:root[…]` so a nested element can
carry `data-theme` and paint itself in that theme. That is how the swatches on `/settings`
preview each option: they cannot drift from the real thing because they ARE the real thing.

### 12.3 A preference is not a filter

None of these change a row count. Filter state lives in the URL and only in the URL
(constraint 5), so a preference that quietly narrowed a table would be a filter nobody could
see, share or clear.

That is why **drops only** hides chrome — the Rivens nav row, the market link — rather than
excluding untradable rows, and why **mastery rank** marks items above the viewer's rank
instead of hiding them: the parts are farmable at any rank, only equipping the finished thing
is gated, so hiding the page would answer a question nobody asked.

There is no setting that forces motion ON against `prefers-reduced-motion`. A viewer who has
told their operating system they want less movement does not get overruled by a site control.

---

## 13. Market prices

Live trade prices from warframe.market, fetched at build time. Shipped 2026-08-28.

### 13.1 The endpoint choice is a politeness decision

warframe.market's full order book — `/v2/orders/item/{slug}` — is about **510 KB per item**,
and it ignores both `?limit` and `?status`. Across the 3,185 items that carry a market slug
that is roughly **1.6 GB per run**, every day, from a service volunteers pay for. This tool is
a guest there and does not need the data that badly.

`/v2/orders/item/{slug}/top` is **2.8 KB** and returns the five best live orders per side,
already restricted to sellers who are online or in-game. The same sweep costs about **9 MB**.
Measured, not assumed, before the design was fixed.

What that costs is stated rather than hidden: a true count of every open offer, and a true
mean across all of them, are not obtainable this way. Both were asked for. Neither is worth
1.6 GB a day, and — see below — neither is the number it sounds like.

### 13.2 The unfiltered average is fiction

Measured against the live API while designing this:

| Item | Basis | n | min | max | mean |
|---|---|---|---|---|---|
| Vitality | every visible sell order | 217 | 1 | **99,999** | **1,019** |
| Vitality | online sellers only | 21 | 1 | 200 | 56 |
| Braton Prime Set | every visible sell order | 958 | **1** | 200 | 14.4 |
| Braton Prime Set | online sellers only | 63 | 5 | 100 | 19.6 |

The full book is thick with parked listings: somebody's 99,999-platinum placeholder drags
Vitality's mean up twenty-fold, and a stale 2019 offer prices Braton Prime's floor at 1
platinum — a number that would send a reader to buy at a price nobody will honour. Both
failure directions are worse than useless, because a reader acts on them.

So the stored snapshot is the cheapest live ask (`sellLow`), the median of the five cheapest
(`sellTypical`), and the best live bid (`buyHigh`) — what you would pay and what you would
get. `sellOrders`/`buyOrders` record how many of the five-wide window were filled, so the UI
can distinguish "five sellers agree" from "one person is asking this".

### 13.3 Prices are hashed separately from drop data

The market moves daily; the drop tables do not. A combined hash would rename all 5 MB of
unchanged drop chunks every day — filenames carry the hash — forcing every returning visitor
to re-download the lot to read a price tick, which is the exact thing content-addressing
exists to prevent.

So `manifest.hash` still means only "the drop data changed", and prices carry their own hash
in their own filename. The client cache follows: chunks are versioned by FILENAME rather than
by the manifest hash, and `pruneStale` takes every live filename rather than one hash — it
would otherwise have deleted the price chunk on every load and re-fetched it forever.

### 13.4 The one dataset allowed to fail

Every other source fails the build loudly, because a truncated drop table ships a lie. Prices
are different in kind: a third party's live service, a garnish rather than the product. A
sweep where fewer than 80% of requests succeed is treated as an outage — the previous price
chunk stays published and the run says so — because replacing it with a half-empty sweep would
read as "nobody is selling this" across half the site. A sweep that fails entirely leaves
prices untouched and never blocks the drop data from shipping.

---

## 16. Curated knowledge

Shipped 2026-09-02. Until this section the tool asserted nothing: every figure on every page
traced back through the pipeline to a DE drop table, and § 2 treats that as the point. Two
owner requests could not be answered under that rule, so the rule now has a bounded exception.

### 16.1 What the drop tables cannot say

DE's repository publishes what an enemy drops. It never publishes where that enemy spawns. An
enemy source record carries exactly three fields — `id`, `kind`, `name` — with no faction, no
planet and no tileset, so 1,055 of 2,417 sources cannot be placed anywhere. Only missions
(435) and bounties (50) carry a planet at all.

A planet-resource page built from that data reports mission and bounty REWARD TABLES, which
is the end-of-mission screen. Earth came out as 14 rows, four of the top six being credit
caches and two being Railjack "Extra" rewards, and omitted Ferrite, Rubedo, Detonite Ampule,
Neurodes, Oxium and Circuits — every resource a player means by the question. Ferrite has 15
edges in the whole dataset and all 15 are mission reward tables; Detonite Ampule has one.

The answer is community knowledge. There is no feed to fetch it from.

### 16.2 The curated surface is kept small on purpose

Most of the planet answer is still derived. `nodes.json` records which factions hold which
planet across 353 nodes — real data — and a planet's common resources follow from its factions
almost exactly. So only two small tables are asserted, both in `packages/sources/src/planets.ts`:

| Table | Asserts | Size |
|---|---|---|
| `FACTION_RESOURCES` | what a faction's units drop, anywhere | 4 factions, ~20 ids |
| `PLANET_EXCLUSIVES` | what belongs to one place only | ~20 places, ~90 ids |

220 of the 517 emitted rows are curated; the rest are read from the drop tables. Every curated
id is validated against the item table THAT BUILD produced, and one unresolved id fails the
build — the tables are small enough that every entry is meant to resolve. That gate has already
paid for itself: it caught Pathos Clamps, which are a real Duviri reward and are absent from
the item catalogue entirely.

### 16.3 Every claim carries its basis

`PlanetResource.basis` is part of the data, not a UI decoration, and the reader always sees it:

- `exclusive` — curated. Found here and nowhere else.
- `faction` — the planet-to-faction half is derived from the star chart; the
  faction-to-resource half is asserted.
- `reward-table` — derived entirely, with a published chance.

Curated rows sort above reward-table rows regardless of chance, because ranking them together
buries Ferrite (which has no chance on Earth at all) under a credit cache. The two render in
separate panels — "Farmed here" and "Also in the reward tables" — with a legend under the
first stating plainly that it is community knowledge and why no feed can produce it.

**The rule this establishes:** curated content is permitted where no upstream feed can answer
the question, must be validated against real data at build time, and must be distinguishable
from derived content by the reader. Content that fails any of the three does not ship.

---

## 17. Farming strategy per item type

The drop chain (§ 8) ranks routes by the probability of one drop. That is right for a prime
part and wrong for anything that stacks, and two failures made it concrete.

**Endo.** `/item/endo` led with "Kill Rare Corpus Storage Container — 100.00% per kill,
expected kills: 1". A storage container always holds 80 Endo, so at 100% it wins a chance
ranking outright. Nobody farms Endo that way. Two separate defects sat behind that one row:

1. **Containers were filed as enemies.** 34 of the 1,055 "enemy" sources are storage
   containers and crown caches. They are now `cache`, the existing kind for a thing you open
   inside a mission you queued, which also gives them the run noun instead of the kill noun
   (§ 5.1). Matched on name, because the name is all upstream gives an enemy record; turrets
   and Raknoids stay enemies because they are shot.
2. **Ranking ignored quantity.** `directEdges` sorted on `perRunChance` alone while the row
   renderer carried a comment reading *"on a resource page this decides more than the drop
   rate does — 350 Plastids at 4% beats 10 at 20%"*. The quantity was displayed and then not
   used to sort.

`expectedYield()` fixes the second: events × chance × mean stack. It is deliberately NOT built
on `perRunChance`, whose complement form caps at 1 — four cache rolls at 100% for 80 Endo is
320 Endo a run, not "1".

> This is not the expected-TIME metric that was cut from this project as useless. That one
> modelled how long a run takes and averaged a 90-second Capture against a 20-minute Survival.
> Yield is units per attempt, published by DE, with no model of duration in it at all.

### 17.1 Strategy decides the ranking and the copy

`packages/core/src/farming.ts` picks one of six strategies per item, and it decides two things:
how routes are ranked, and what the page says about them.

| Strategy | Chosen when | Ranked by |
|---|---|---|
| `relic-chain` | the item drops from a relic | composed chance — the drop chain stays |
| `resource` | category `Resource` | expected units per attempt |
| `currency` | an override — Endo, Kuva, Steel Essence, Aya… | expected units per attempt |
| `mod` | category `Mod` or `Arcane` | chance |
| `assembled` | the item has a recipe and no relic path | not ranked; the recipe is the answer |
| `direct` | everything else | chance |

A relic path beats the category, because a prime part is filed as a `Component` and its
category says nothing about how to get it. An explicit override beats even that.

`FARM_OVERRIDES` is deliberately short and a test caps it at 15 entries: a growing list means
the category rules are wrong, not that more overrides are needed. Two of its entries exist
purely for an upstream quirk — **Ferrite and Neurodes are categorised `Other`, not `Resource`**,
which would otherwise have excluded the two most-farmed resources in the game from resource
handling everywhere. Override ids are validated against the item table at build time, because
unlike the planet tables they never reach a chunk and nothing else would notice one going stale.

### 17.2 The drop chain is now conditional

It renders for `relic-chain` and nothing else. For a resource it would draw "kill one
container" as though that were a plan. In its place every item page carries a **How this is
farmed** panel, headed `community knowledge` — curated copy per strategy, ten blocks covering
4,875 items. It is copy rather than data because it varies by item TYPE, not by item; shipping
it in a chunk would be shipping a constant.

Summary cards follow the strategy too: a stacking item shows "Best yield / run" in units with
chance demoted, because "expected runs: 1" for a container holding 80 Endo is true and useless.

---

## 18. Phases

Each phase ends deployable. Don't start the next until the current one ships.

| Phase | Deliverable | Done when |
|---|---|---|
| 1 | Monorepo scaffold, Vercel wired, CI green, empty app deployed | A commit to `main` produces a live URL |
| 2 | Pipeline v1 — items + sources + direct edges, Zod-validated, sanity gates, hashed output | `pnpm data:build` emits committed JSON; the daily workflow runs |
| 3 | Client cache + Worker indices + ⌘K search palette | Cold load < 2s, warm < 300ms, search feels instant |
| 4 | Item pages with direct drops, statically generated, design system implemented | 6k+ pages build; visual system fully tokenized |
| 5 | **Relic chain expansion** — derived edges, refinement comparison, radshare math, the chain trace | Math shipped with the phase; the **trace itself shipped 2026-08-27**, a month later. Until then `composeThroughRelic`, `runsForRelicPath`, `shareChance` and `atLeastOnce` had zero callers in `apps/web` — the engine for the signature element was dead code behind a page that stopped at "here are the relics". |
| 6 | `/browse` — virtualized table, full filter set, URL state | 40k rows scroll at 60fps; every filter is shareable |
| 6.5 | `/source/[kind]` and `/source/[kind]/[...slug]` — the forward view, and the graph finally navigating both ways | Every source name on the site is a link; zero broken links and zero orphaned pages across all 6,223 |
| 7a | **Assembled sets** — synthesised set items, recipes, `buildsInto` backlinks | Shipped 2026-08-25: 309 sets, 161 of 163 primes; component refs resolve 100% (was 5.3%) |
| 7b | **Owned-parts tracking** — IndexedDB collection, set progress, JSON export/import | Shipped 2026-08-26: a tick survives a reload and reaches another page, verified end-to-end over CDP |
| ~~7c~~ | ~~Expected-time ranking, mission duration table~~ | **Dropped 2026-08-26.** A number that averages a 90-second Capture against a 20-minute Survival reads as precision and answers a question no player asks. `mission-durations.ts` and `rotations.ts` were deleted rather than left inert. |
| 8 | **Rivens — dispositions and weekly trade prices** | Shipped 2026-08-26: 687 weapons, 416 with an observed price. Roll logging and grading deliberately NOT built — see § 9. |
| ~~9~~ | ~~Market proxy + live listings~~ | **Replaced 2026-08-26 by a link.** See § 9.1. No server route was built; constraint 3’s escape hatch remains unspent. |
| 9.5 | **World state** — live fissures, invasions, factions, Baro | Shipped 2026-08-26. Absorbed the Factions and Vendors tiles, both of which were blocked on data that turned out to be live rather than static. |
| 10 | Polish — wiki supplement join, perf pass, a11y audit (`/about` shipped 2026-08-26) | Lighthouse ≥ 95 across the board |
| 11 | **`/farm` — the plan: collection × chains × live fissures, grouped by action** | Shipped 2026-08-27. Verified end to end over CDP: parts ticked through the real UI, then the plan read back with open fissures attached. |
| 12 | **Query language** — one grammar for the palette and `/browse`, 13 keys, one URL param | Shipped 2026-08-28. `is:prime cat:warframe` returns 50, which the edge-grain design it replaced returned 0 of. |
| 14 | **Market prices** — live asks and bids per item, swept at build time, `price:` in the query language | Shipped 2026-08-28. `/top` not the full book: 9 MB a run instead of 1.6 GB. |
| 13 | **Settings** — four themes, density, motion, drops-only, mastery rank, new player mode | Shipped 2026-08-28. Contrast measured for all four themes; no preference changes a row count. |
| 15 | **Curated knowledge** — /planets and /planet/[slug], resources by place | Shipped 2026-09-02. 220 curated rows, every id validated at build time; each claim renders with its basis. |
| 16 | **Farming strategy per item type** — yield ranking, containers reclassified, drop chain made conditional | Shipped 2026-09-02. Endo no longer recommends smashing a storage container. |

Phase 5 is the one that matters. Everything before it is table stakes that other sites already
have; everything after it is refinement. If the schedule slips, protect phase 5.

---

## 19. Open questions

- Console platforms: PC-only for now. Drop tables are shared, but riven trade data and market
  listings are not. Revisit only if there's demand.
- Localization: the pipeline can read localized `PublicExport` indices. Structure item names so
  a locale layer is addable later, but don't build it now.
- ~~Should `/browse` support saved filter presets?~~ **Answered 2026-08-28 by the query
  language (§ 11.4).** The URL carries the literal query text, so a bookmark is the preset. No
  preset UI.
