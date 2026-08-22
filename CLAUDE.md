# CLAUDE.md

Operating manual for Claude Code in this repository. Read this before touching anything.
The full rationale lives in `DESIGN.md` — this file is the rules; that file is the reasoning.

---

## What this is

**Provenance** — a Warframe drop-source lookup tool. The primary question it answers is the
*reverse* one: given an item, show every way to get it, ranked by expected effort, including
items gated behind Void Relics where the path is a chain rather than a single row.

Working name is a placeholder. If the owner renames it, update `package.json`, `apps/web/src/config/site.ts`,
and this heading — nowhere else should hardcode the name.

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

3. **One server-side escape hatch, and only one:** `apps/web/src/app/api/market/[...path]/route.ts`,
   an Edge runtime pass-through to `api.warframe.market` used solely because that API may not send
   CORS headers. It is stateless, caches aggressively, forwards no cookies, and accepts no
   client-supplied hostnames. Do not add a second route handler without asking.

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
| Tables | TanStack Table v8 + TanStack Virtual | Source lists run to tens of thousands of rows. Virtualization is mandatory. |
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
- **All numerals in data contexts use `tabular-nums`.** A drop-rate column that doesn't align
  vertically is a defect, not a nitpick.
- Rarity colors come from the constant-chroma ramp. Never pick a rarity color ad hoc.
- Panel chamfers use the shared `clip-path` utility, not `border-radius`. This is the one piece of
  Orokin geometry the design leans on; it must be consistent.
- **Motion budget:** page transitions (View Transitions API), filter result reflow, and the drop-chain
  reveal. That is the entire list. No decorative ambient animation, no scroll-jacking, no
  glow pulses. `prefers-reduced-motion` disables all of it.
- Quality floor, unannounced: responsive to 360px, visible keyboard focus rings, real `<th>` scopes
  on data tables, contrast ≥ 4.5:1 for body text.

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
except the market proxy.
