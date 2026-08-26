import Link from 'next/link'
import type { Metadata } from 'next'

import { SearchTrigger } from '@/components/CommandPalette'
import { CollectionManager, type SetSummary } from '@/components/CollectionManager'
import { getDataset } from '@/lib/data'

export const metadata: Metadata = {
  title: 'Your collection',
  description:
    'Track which prime parts you already own and how close each set is to complete. Stored in your browser, never uploaded.',
}

/**
 * Statically prerendered like everything else (CLAUDE.md constraint 4). The set catalogue is
 * a build-time fact and ships in the HTML; only the owned ids come from IndexedDB, inside
 * the client island.
 *
 * The whole set list is passed down rather than fetched, because it is small — 309 recipes
 * and their component names — and the alternative is loading the 833 KB item chunk to render
 * a page that is mostly a progress list.
 */
export default async function CollectionPage() {
  const { items, itemsById } = await getDataset()

  const sets: SetSummary[] = items
    .filter((item) => item.components !== undefined && item.components.length > 0)
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      components: item.components ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Only the names actually referenced, so this is a few hundred short strings rather than
  // the whole catalogue.
  const names: Record<string, string> = {}
  for (const set of sets) {
    for (const component of set.components) {
      names[component.itemId] ??= itemsById.get(component.itemId)?.name ?? component.itemId
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-6 sm:py-16">
      <nav className="label mb-6 flex items-center justify-between gap-4">
        <span>
          <Link href="/" className="transition-colors hover:text-text">
            Provenance
          </Link>
          <span className="mx-2 text-hairline-strong" aria-hidden="true">
            /
          </span>
          <span>Collection</span>
        </span>
        <SearchTrigger compact />
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">Your collection</h1>
      <p className="mt-2 max-w-prose text-sm text-text-dim">
        Tick off the parts you own on any set page and they show up here, closest to finished
        first.
      </p>

      <CollectionManager sets={sets} names={names} />
    </div>
  )
}
