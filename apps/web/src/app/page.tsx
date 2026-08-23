import Link from 'next/link'

import { CommandPalette } from '@/components/CommandPalette'
import { Panel, PanelHeader, Stat } from '@/components/Primitives'
import { getDataset } from '@/lib/data'
import { site } from '@/config/site'

/**
 * Phase 1 holding page, reskinned onto the real visual system and wired to real data.
 * The ⌘K palette replaces the hero in Phase 3 — the palette *is* the home page
 * (DESIGN.md § 7).
 */
export default async function HomePage() {
  const { items, sources, edges, relics, manifest, relicsByReward } = await getDataset()

  // Items reachable through the most relic chains are the ones where a flat table row is
  // least useful — which is exactly what this tool exists to answer.
  const mostChained = [...relicsByReward.entries()]
    .map(([itemId, list]) => ({ itemId, count: list.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)

  const itemsById = new Map(items.map((item) => [item.id, item]))
  const built = new Date(manifest.builtAt)

  return (
    <div className="mx-auto max-w-4xl px-5 py-16 sm:px-6 sm:py-24">
      <h1 className="font-display text-2xl font-bold tracking-tight text-orokin sm:text-[3rem]">
        {site.name}
      </h1>
      <p className="mt-3 max-w-xl text-lg text-text-dim">{site.tagline}</p>
      <p className="mt-6 max-w-2xl text-sm text-text-faint">
        Given an item, every path to it — including the ones gated behind Void Relics, where
        the honest answer is a chain rather than a single table row.
      </p>

      <div className="mt-10 max-w-xl">
        <CommandPalette />
      </div>

      <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Stat label="Items" value={items.length.toLocaleString()} />
        <Stat label="Sources" value={sources.length.toLocaleString()} />
        <Stat label="Drop edges" value={edges.length.toLocaleString()} />
        <Stat label="Relics" value={relics.length.toLocaleString()} />
      </div>

      <Panel className="mt-12">
        <PanelHeader title="Most relic paths" aside="by chain count" />
        <ul className="divide-y divide-hairline/50">
          {mostChained.map(({ itemId, count }) => {
            const item = itemsById.get(itemId)
            if (item === undefined) return null
            return (
              <li key={itemId}>
                <Link
                  href={`/item/${itemId}`}
                  className="flex items-baseline justify-between gap-4 px-5 py-3 text-sm transition-colors hover:bg-void-700"
                >
                  <span className="text-text">{item.name}</span>
                  <span className="data-num shrink-0 text-xs text-text-faint">
                    {count} relics
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Panel>

      <p className="label mt-8">
        Drop data {built.toISOString().slice(0, 10)} · build {manifest.hash} · search palette
        lands in phase 3
      </p>
    </div>
  )
}
