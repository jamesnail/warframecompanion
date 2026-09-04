# CLAUDE.md

Operating manual for Claude Code in this repository. Read this before touching anything.
The full rationale lives in `DESIGN.md` — this file is the rules; that file is the reasoning.

---

## What this is

**Cephalon Tel** — a Warframe drop-source lookup tool. The primary question it answers is the
*reverse* one: given an item, show every way to get it, ranked by expected effort, including
items gated behind Void Relics where the path is a chain rather than a single row.

Renamed from "Provenance" on 2026-08-28. The name lives in `apps/web/src/config/site.ts` and
`package.json` and nowhere else — read `site.name`, including in `metadata` objects.

Three names deliberately did NOT change and must not: the IndexedDB database `provenance` and
the `provenance:settings` mirror key, because they are where every viewer's collection and
settings physically live and renaming them would silently open an empty store; and
`DropEdge.provenance`, which is a domain term for where a claim came from. The `@provenance/*`
package scope is internal and was left alone — renaming it touches every import to change
nothing a user can see.

The logo and the three image assets derived from it still carry the old wordmark; see
`assets/README.md`.

Repo → GitHub → Vercel. Public site, public repo. Assume every commit ships.

---

## Non-negotiable constraints

These are architecture, not preference. Do not "improve" your way around them; if one seems
wrong, stop and ask.

1. **No database. No user accounts. No server-held state.** Ever. All user data (riven
   collection, tracked items, settings) lives in the browser via IndexedDB, with explicit
   JSON export/import as the backup story.

2. **Never fetch Digital Extremes endpoints from the browser.** No exceptions. All DE data is
   fetched, parsed, normalized, and validated in CI, then committed as static JSON. The client
   only ever fetches same-origin files under `/data/`. Reasons: no CORS guarantees, LZMA-compressed
   manifests, multi-megabyte HTML drop tables, and the wiki's own note that these endpoints are
   "for reference only." If you find yourself writing an `lzma` import inside `apps/web`, you have
   taken a wrong turn.

3. **No server routes at all.** `apps/web/src/app/api/` does not exist and never has.

   This constraint used to describe a market proxy at `api/market/[...path]/route.ts` as the
   one permitted escape hatch. It was planned, then made unnecessary before it was written:
   prices are swept at build time (see *Market prices*), so nothing needs to talk to
   warframe.market at runtime. The file was documented for a year and never existed — corrected
   2026-09-03. Do not "restore" it, and do not assume a proxy is available.

   **The one runtime call to a host we do not serve** is `oracle.browse.wf` in
   `apps/web/src/lib/client/world-state.ts`, which mirrors DE's own `worldState` and sends
   `access-control-allow-origin: *`, so it needs no proxy. That is the whole list. Adding a
   route handler, or a second external host, is an ask-first change.

4. **Every page is statically prerendered.** No `dynamic = 'force-dynamic'`, no server-side data
   fetching in components, no ISR. The build emits HTML; Vercel serves it from the edge.

5. **The URL is the source of truth for all filter state.** Any filter combination must be
   copy-pasteable and restore exactly. No filter state that exists only in a React hook.

6. **TypeScript strict, no `any`, no non-null assertions in `packages/core`.** External data is
   parsed through Zod at the boundary and typed thereafter.

---

## Layout

```
provenance/
├── apps/
│   └── web/                    Next.js app. The only deployable.
│       ├── public/data/        Generated JSON. Committed. Never hand-edited.
│       └── src/
│           ├── app/            Routes (App Router)
│           ├── components/     UI. Presentational by default.
│           ├── lib/            Client runtime: cache, workers, query helpers
│           └── config/         site.ts, tokens, feature flags
├── packages/
│   ├── core/                   Types, Zod schemas, drop-graph math, query engine.
│   │                           Pure, isomorphic, zero I/O, zero React. Fully unit-tested.
│   └── sources/                Build-time fetchers + parsers. Node-only. Never imported by web.
├── scripts/
│   └── build-data.ts           Pipeline entrypoint. Run by CI and by hand.
└── .github/workflows/
    └── data.yml                Daily cron. Fetches, builds, diffs, commits.
```

`packages/core` must never import from `packages/sources`, and `apps/web` must never import from
`packages/sources`. Enforce with `eslint-plugin-import` restricted paths. If a helper is needed in
both places, it belongs in `core`.

---

## Commands

```bash
pnpm install
pnpm dev                # apps/web on :3000
pnpm build              # turbo build; must pass before any commit
pnpm typecheck          # tsc --noEmit across the workspace
pnpm lint
pnpm test               # vitest
pnpm data:build         # run the pipeline locally, writes apps/web/public/data/
pnpm data:diff          # show what a fresh pipeline run would change
```

pnpm only. If you see `npm install` or a `package-lock.json` anywhere, that is a bug.

**Curated knowledge (2026-09-02).** The tool now asserts things DE never published, under
three rules that hold together and are not optional. Curated content is permitted **only**
where no upstream feed can answer the question — the planet↔resource map exists because enemy
records carry no planet, not because deriving it was inconvenient. Every curated id is
**validated at build time** against the item table that build produced; one unresolved id
fails the build, as does a citation dated in the future. And a curated claim must be
**distinguishable by the reader**: `PlanetResource.basis` is data, not decoration, and the
tiers render in separate panels. Curated tables live in `packages/sources/src/planets.ts`,
`packages/sources/src/guides.ts` and `packages/core/src/farming.ts`, and are meant to stay
small — a growing `FARM_OVERRIDES` means the category rules are wrong. See DESIGN.md § 16.

**Resources are bound to the REGION, never to the faction (2026-09-02).** `REGION_RESOURCES`
is the wiki's documented per-region pool, with rarity stored per row because rarity belongs to
the pair — Morphics is rare on Mercury and uncommon on Mars. A faction-derived model was tried
and reverted the same day: it gave Earth the Infested pool off three Infested nodes, and about
a third of its rows were wrong. **Do not reintroduce one.** Factions still render in the page
header, describing what you shoot rather than what drops.

**Community claims are dated, never quoted (2026-09-02).** Anything in `guides.ts` is
consensus, not documentation. Write findings in your own words; never assert what the cited
page does not say; prefer the wiki's own farming guides because they publish a last-edited
timestamp, so staleness is checkable. `Citation.updated` is the source's own date and
`retrieved` is when we read it — the UI says "updated" or "read" accordingly, and must never
present the weaker claim as the stronger. Past `STALE_AFTER_DAYS` a claim renders "may be out
of date". SEO content-farms are not citable: they contradicted each other and one placed the
Orokin Derelict on Earth.

**Farming strategy (2026-09-02).** `farmStrategy()` in `packages/core/src/farming.ts` picks
how an item is farmed, and that decides both the ranking and the copy. Two rules. **Anything
that stacks ranks by `expectedYield`, not by chance** — chance ranking put "Rare Corpus
Storage Container, 100%" at the top of `/item/endo`, and yield is units per attempt with no
model of duration, so it is not the expected-TIME metric that was cut. **The drop chain
renders for `relic-chain` only** — elsewhere it draws "kill one container" as a plan. Storage
containers and crown caches are `cache`, never `enemy`; upstream files them as enemies and
`isBreakable()` in `packages/sources/src/tables.ts` is the one place that corrects it. See
DESIGN.md § 17.

**Runs and kills (2026-08-28).** Effort figures name the act they counted: a mission, bounty
or fissure is counted in **runs**, an enemy in **kills**. `attemptNoun()` in
`packages/core/src/attempts.ts` is the only place that decides — never hardcode either word
in a component. Only `enemy` is a kill. A table spanning both takes `attemptColumn`, which
names both rather than picking one. A relic chain stays in runs (`chainNoun`), because its
figure already includes the fissure run. This REVERSED an earlier deliberate rule; see
DESIGN.md § 5.1 for why, and do not revert it.

**Market prices (2026-08-28).** Swept at build time from warframe.market's `/top` endpoint,
never at runtime. Two rules, both load-bearing. **Never switch to the full order book** — it is
510 KB per item against 2.8 KB, which is 1.6 GB per daily run from a volunteer-run service, and
the tool does not need it that badly. **Never average the whole book** — parked listings make
the unfiltered mean fiction (DESIGN.md § 13.2). Prices are hashed separately from drop data and
are the one dataset permitted to fail without failing the build.

**Settings (2026-08-28).** Viewer preferences live in IndexedDB beside the collection and
export with it. A localStorage MIRROR exists for one reason — the pre-paint script in
`layout.tsx` must set theme, density and motion before first paint and IDB cannot be read
synchronously. IDB is the record; the mirror is rewritten from it on hydrate. Themes are
alternate VALUES for the existing tokens under `[data-theme]`, never new token names: adding
one is a block in `globals.css` plus an entry in `THEMES`, and its contrast must be measured
against every surface before it ships. **No preference may change a row count** — filter state
is the URL's job (constraint 5), so preferences hide chrome and mark things, never filter.

**Query language (2026-08-28).** The palette and `/browse` share one grammar, defined in
`packages/core/src/query/`. It is defined over ITEMS with an existential lift to paths, because
all 50 prime Warframes have zero drop edges of their own and an edge-grain language returns
nothing for "prime warframes" (DESIGN.md § 11). Adding a key is one entry in `keys.ts` plus a
test. Do not add a key whose field is not populated — `faction:` is absent for exactly this
reason, and the check is a measurement against `public/data`, not a look at `types.ts`.
`/browse` carries its whole filter state in one `q=` param; do not add a second filter param.

**Parts are not ingredients (2026-09-03).** `Item.components` was one array holding two
different things and it is now two: `parts` are the pieces you FARM, `ingredients` are the
resources the recipe consumes. Three rules. **The split comes from upstream, not from us** —
WFCD nests a part's recipe under its parent (`/Recipes/` in `uniqueName`) and names
ingredients as their own items, so `isPartOfParent` in `packages/sources/src/enrich.ts`
preserves a distinction rather than inventing one. **A set's drop paths are its PARTS' paths,
via `pathSourceIds()` in `packages/core/src/parts.ts`, which is the only place that decides**
— rolling up an ingredient gave Ash Prime Orokin Cell's 121 edges and made `from:enemy` match
every prime Warframe in the game. And **only an item with a part is a set**: `isSet()`, not
`components.length > 0` re-derived per call site, and a build gate fails on a set with
ingredients and no parts. This replaced a heuristic ("inherit unless it builds into more than
one thing") that was wrong in both directions — it leaked 16 single-use resources, Oxium and
Cryotic among them, and stripped genuine parts from the four Ak- weapons. Measured after: no
part is shared between two sets — fan-in is exactly 1 over all 931 of them — asserted over
the whole corpus in `apps/web/src/lib/query-index.test.ts`. Do not reintroduce a single `components` field.
Ingredients are still shown — under the recipe table, without a tick — because a recipe that
hides what it consumes is incomplete, not clean. See DESIGN.md § 20.

**/browse has two grains (2026-09-03).** `view=items` (the default) is one row per item;
`view=paths` is the original one row per edge. Both are real and neither is a fallback. Items
default because that view **cannot be empty while items match** — the path grain answered
`is:prime cat:warframe` with "0 of 28,020 rows", which is true and reads as "there are no
prime Warframes", and 1,046 of 4,875 items are in that position. Paths stay because the item
grain cannot be precise about a conjunction: the language is lifted existentially, so at item
grain `tier:axi rotation:c` is satisfied by one Axi path and a separate rotation-C path
(DESIGN.md § 11). An item row that reaches its source through a part must SAY so — `via` on
`ItemRow` — or it claims a relic drops an assembled Warframe.

**A measurement in a comment is a claim, and claims are tested (2026-09-04).** Comments here
argue from counts — "0 of 2,417 sources carry a faction, so there is no `faction:` key",
"Orokin Cell builds into 177 sets, so cap the backlink". Those justify decisions, and the data
under them changes daily, so `apps/web/src/lib/claims.test.ts` asserts them against the shipped
dataset. Three had drifted silently before it existed. Two rules. **Assert the CLAIM, not the
figure** — `data.yml` commits a refresh without running anything and the push then triggers CI,
so an exact bound would turn the build red the morning after a routine data change; use a
bound wide enough to absorb DE adding a Warframe, and reserve exact assertions for claims that
are structural rather than incidental. And **a failure there is not automatically a code bug**:
it means a comment now says something untrue, so read the one the test names and decide whether
to update it or to reconsider what it was justifying. If you add a comment that argues from a
number, add the assertion with it.

**Table note (2026-08-25).** `/browse` ships with TanStack **Virtual** only; TanStack Table v8
was dropped from the plan. Virtualization is genuinely required — 28k rows — but the table
itself is four fixed columns with one sort key and a handful of AND-ed predicates, all of which
live in `apps/web/src/lib/browse.ts` as ~60 lines of pure, unit-tested functions. TanStack
Table earns its weight on grouping, pagination, column resizing and faceted state; none of that
is on the roadmap here, and routing sort and filter through its state model would have put an
abstraction between the URL and the predicate when CLAUDE.md constraint 5 requires the URL to
BE the state. Revisit if /browse grows column pinning or grouping.

---

## Stack

Verify current stable versions when scaffolding rather than trusting the numbers below —
this document was written in August 2026 and majors move.

| Concern | Choice | Why not the alternative |
|---|---|---|
| Framework | Next.js App Router | Vercel is the host and item pages need to be indexable. Not Vite: SEO is a stated goal. |
| Routing state | `nuqs` | Typed search params without hand-rolling serialization. |
| Runtime data | Plain `fetch` + IndexedDB | TanStack Query is for volatile data only (market prices). Static JSON keyed by build hash doesn't need a query cache. |
| IndexedDB | `idb` | Not Dexie — we store a handful of blobs keyed by hash, we don't query IDB. Filtering happens in memory. |
| Tables | TanStack Virtual (see note) | Source lists run to tens of thousands of rows. Virtualization is mandatory. |
| Search | `uFuzzy` | Fastest option for a fixed ~6k string list; powers the ⌘K palette. |
| Styling | Tailwind + shadcn/ui primitives | shadcn is the *starting* point, heavily reskinned. See DESIGN.md § Visual System. |
| Charts | Recharts, or hand-rolled SVG | Prefer hand-rolled for the probability bars — they're typographic objects, not charts. |
| Motion | Motion (ex-Framer) | Used sparingly. See the motion budget below. |
| Validation | Zod | At every data boundary, both pipeline and client. |
| Workers | Comlink | Index building happens off the main thread. |
| Tests | Vitest | Playwright optional, later. |

---

## Conventions

**Files.** `kebab-case.ts` for modules, `PascalCase.tsx` for components. Colocate a component's
sub-parts in a folder only once there are three or more.

**Exports.** Named exports everywhere except Next.js route files, which require defaults.

**Types.** Derive from Zod schemas (`z.infer`) rather than declaring twice. Canonical domain types
live in `packages/core/src/types.ts` and nowhere else.

**Errors.** In the pipeline: fail loud, fail the build. A malformed drop table must not silently
ship an empty dataset. In the client: degrade gracefully — a missing optional dataset hides a
feature, it does not blank the page.

**Comments.** Explain *why*, particularly for probability math and DE data quirks. The drop data has
real inconsistencies (duplicated chance fields, chances as strings, category renames); every
workaround gets a comment naming the quirk.

**Never mutate `apps/web/public/data/` by hand.** It is build output that happens to be committed.

---

## The pipeline is the product

Most of the difficulty is here, not in the UI. Rules:

- Every fetch is retried with backoff and has a hard timeout. Network flake must not commit a
  truncated dataset.
- Every fetched payload is Zod-parsed before use. Schema drift fails the build loudly.
- **Sanity gates** before writing output — if any fail, exit nonzero and commit nothing:
  - item count within ±15% of the previous build
  - drop-edge count within ±15% of the previous build
  - every relic's rarity-tier probabilities sum to 100% ± 0.1
  - zero orphaned edges (every edge's `itemId` and `sourceId` resolve)
- Output is content-addressed: `manifest.json` carries a build hash; data chunks are written as
  `<name>.<hash>.json` so they can be served immutable.
- The workflow commits only when the hash changes. No empty daily commits.
- Attribution and source URLs for every dataset go into `manifest.json` and render in the UI footer.

---

## Visual rules (enforced, not suggested)

Full system in DESIGN.md. The rules Claude Code must not violate:

- **No raw hex or arbitrary Tailwind color values in components.** Every color comes from a
  semantic token defined in OKLCH in `globals.css`. If a needed color doesn't exist, add a token.
  The single exception is the background lattice's inline SVG in `globals.css`, where the stroke
  must be a literal hex because a data URI cannot read a custom property. It is commented as such.
- **All numerals in data contexts use `tabular-nums`.** A drop-rate column that doesn't align
  vertically is a defect, not a nitpick.
- Rarity colors come from the constant-chroma ramp. Never pick a rarity color ad hoc.
- Panel chamfers use the shared `clip-path` utility, not `border-radius`. Panels also carry gold
  corner braces on the two corners the chamfer does not cut, drawn as background layers on the
  `panel` utility. Chamfer and brace together are the Orokin geometry; do not invent a third.
- **Four themes, one token set.** A theme redefines the values of the tokens in `globals.css`
  under `[data-theme='…']`; it never introduces a token name. Components stay theme-unaware.
  The rarity ramp's hues do not vary by theme — they encode a measurement — though a theme may
  move all four together, as high contrast does.
- **Gold has two weights and they are not interchangeable.** `gold` is the accent — spend it once
  per view, on the thing the reader searched for. `gold-dim` is ornament: frames, rules, corner
  marks, the panel-header diamond. `gold-dim` does not clear 4.5:1 on any surface and must never
  carry text.
- The background lattice sits at `opacity: 0.055` on `body::before`. That is the whole budget.
  Raising it puts texture behind a drop-rate column, which is a defect however good it looks.
- **Motion budget:** page transitions (View Transitions API), filter result reflow, the drop-chain
  reveal, hover feedback on interactive rows, tiles and controls, a one-shot entrance rise on
  panels and the home title card, the one-shot gold sweep on `rule-gold`, and the Orokin decode
  on the home page. That is the entire list. Everything in it plays **once** with a single
  exception: the home title card's decode cycles — decode, hold, encode, repeat — because the
  home page carries no data to read behind it. Nothing loops on any page that shows a number.
  Hover uses `--duration-hover` and `--ease-orokin` — one duration and one curve for the whole
  app, because feedback that varies in speed between components reads as jitter rather than as
  one interface — and animates transform and colour only, never a property that triggers layout.
  Still forbidden: scroll-jacking, glow pulses, looping motion anywhere but the home title
  card, anything still moving a second after a page with data on it settles. `prefers-reduced-motion` disables all of it — and for the
  entrance animations that means `animation: none`, not a zeroed duration: an animation that
  starts at `opacity: 0` and is merely made instant still paints one frame of nothing. The lattice is texture, not motion, and stays:
  a reader who asked for less movement did not ask for less texture.
- Quality floor, unannounced: responsive to 360px, visible keyboard focus rings, real `<th>` scopes
  on data tables, contrast ≥ 4.5:1 for body text.
- **A virtualized list is still a data table and must still say so.** `/browse` cannot use
  `<table>` — the virtualizer absolutely positions its rows — so it carries `role="grid"`,
  `aria-rowcount`/`aria-rowindex`, `role="columnheader"` and `role="gridcell"` instead. This is
  not optional decoration: it shipped without them and was an undifferentiated list of links to a
  screen reader, with `aria-sort` sitting on a bare `<button>` where it is silently ignored.
  `aria-sort` goes on the columnheader, never on the control inside it.

---

## Copy

Plain, terse, in the tool's voice — this is instrumentation, not a companion app.

- Label things the way players say them: "Relic", "Rotation C", "Radiant", "Disposition". Never
  invent friendlier synonyms for game terms.
- Empty states direct: "No source found. Try clearing the vaulted filter." Not "Oops!"
- Errors state what happened and what to do. They do not apologize and are never vague.
- Buttons name the action, and the resulting toast uses the same word.

---

## Deployment

- Vercel project root is `apps/web`. Install command `pnpm install`, build `pnpm build`.
- Production deploys from `main`. Every PR gets a preview.
- The daily data workflow commits to `main`, which triggers a normal production deploy. That
  redeploy *is* the daily refresh — there is no runtime revalidation.
- `/data/*` gets `Cache-Control: public, max-age=31536000, immutable` (filenames are hashed).
  `manifest.json` gets `max-age=0, must-revalidate`.
- No secrets are required to build or run. If a task seems to need an environment variable, stop
  and ask — it probably violates constraint 1 or 2.

---

## Legal and attribution

Warframe and all game data are property of Digital Extremes. This is an unofficial fan tool.
Drop data is derived from DE's public drop table repository via the WFCD community project; item
metadata comes from `@wfcd/items`. Both must be credited in the footer and in `README.md`, with
links. Do not strip attribution. Do not present the site as official. Do not mirror game assets
beyond icons already published by WFCD.

---

## Ask before doing

Stop and check with the owner rather than deciding unilaterally:

- Adding any server route, environment variable, or third-party service
- Adding a dependency over ~50kB gzipped to the client bundle
- Changing the canonical data model in `packages/core/src/types.ts`
- Changing probability math or the drop-chain composition rules
- Anything that would make a page non-static
- Any change to the color or type tokens

## Definition of done

A change is complete when `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` all pass;
new probability logic has unit tests with hand-verified expected values; the UI works at 360px
and with keyboard only; and no new client-side network call points at a non-same-origin host
except `oracle.browse.wf` (constraint 3).
