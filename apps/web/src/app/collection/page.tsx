import type { Metadata } from 'next'

import { CollectionManager, type SetSummary } from '@/components/CollectionManager'
import { getDataset } from '@/lib/data'
import { PAGE, PageHeader } from '@/components/Primitives'

export const metadata: Metadata = {
  title: 'Your collection',
  description:
    'Track which prime parts you already own and how close each set is to complete. Stored in your browser, never uploaded.',
  // Nothing here is the same for two visitors — the page is whatever the viewer has ticked —
  // so there is no stable content to index. Kept out of the sitemap for the same reason.
  robots: { index: false, follow: true },
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
  const { items, itemsById, edgesByItem, relicsByReward } = await getDataset()

  /**
   * Which components have no live source at all. Computed here, at build time, because it
   * is a fact about the drop tables rather than about the viewer — the client only decides
   * whether a blocked part still matters, which depends on what they already own.
   */
  const isVaulted = (itemId: string): boolean => {
    const relics = relicsByReward.get(itemId) ?? []
    if (relics.length === 0) return false
    if (relics.some((relic) => !relic.vaulted)) return false
    return !(edgesByItem.get(itemId) ?? []).some((edge) => !edge.sourceId.startsWith('relic:'))
  }

  const sets: SetSummary[] = items
    .filter((item) => item.components !== undefined && item.components.length > 0)
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      components: item.components ?? [],
      vaultedComponents: (item.components ?? [])
        .map((component) => component.itemId)
        .filter(isVaulted),
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
    <div className={PAGE}>
      <PageHeader kicker="Yours" title="Your collection" />
      <CollectionManager sets={sets} names={names} />
    </div>
  )
}
