# Provenance

A Warframe drop-source lookup tool. Given an item, it shows **every** way to get it, ranked by
expected effort — including the items gated behind Void Relics, where the honest answer is a
chain rather than a single table row.

Static site, client-side data, no accounts, no database.

## Status

Phase 1 of 10 — monorepo scaffold and deploy pipeline. Drop data lands in Phase 2.
See `DESIGN.md` § 11 for the phase plan.

## Development

```bash
pnpm install
pnpm dev          # apps/web on :3000
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm data:build   # run the data pipeline locally
```

pnpm only — the workspace assumes it, and `npm install` anywhere is a bug.

## Layout

| Path | Role |
|---|---|
| `apps/web` | Next.js app. The only deployable. |
| `packages/core` | Types, Zod schemas, drop-graph math. Pure, isomorphic, zero I/O. |
| `packages/sources` | Build-time fetchers and parsers. Node-only, never shipped to the browser. |
| `scripts/build-data.ts` | Pipeline entrypoint, run daily by CI. |

The boundary between `sources` and everything else is enforced by lint rules, not convention —
nothing that touches Digital Extremes' endpoints is permitted to reach client code.

## Attribution

Warframe and all game data are the property of **Digital Extremes**. This is an unofficial fan
tool and is not affiliated with or endorsed by Digital Extremes.

Data is derived from the community projects that make this possible:

- [WFCD/warframe-drop-data](https://github.com/WFCD/warframe-drop-data) — drop tables parsed from
  DE's public drop table repository
- [@wfcd/items](https://github.com/WFCD/warframe-items) — item metadata, icons, riven dispositions
- [warframe.market](https://warframe.market) — live market listings

## License

Code is MIT. Game data and assets remain the property of their respective owners.
