import { Suspense } from 'react'
import type { Metadata } from 'next'
import { isSet, type DropChain } from '@provenance/core'

import { FarmPlanner } from '@/components/FarmPlanner'
import { PAGE, PageHeader } from '@/components/Primitives'
import { buildBestChain } from '@/lib/chain-build'
import { buildNodeIndex } from '@/lib/node-index'
import { getDataset } from '@/lib/data'
import type { TrackedSet } from '@/lib/farm'

export const metadata: Metadata = {
  title: 'Farm now',
  description:
    'What to run next, ranked: the sets you have started, the parts still missing, and the single mission or open fissure that advances the most of them.',
  // Whatever the viewer has ticked, and nothing else — there is no stable content to index.
  // Same reasoning as /collection, and kept out of the sitemap for the same reason.
  robots: { index: false, follow: true },
}

/**
 * The plan.
 *
 * Prerendered shell, client island (constraint 4). Three things meet here and only one of
 * them is a build-time fact:
 *
 *  - the drop chains, computed here from the committed dataset, and identical to the ones
 *    each item page shows, because both call `buildBestChain`;
 *  - the collection, which is in the viewer's IndexedDB and never leaves it;
 *  - the open fissures, which are live.
 *
 * Chains ship for every component of every set — about 1,200 short records. That is more
 * than this page needs for any one viewer, but which parts a viewer is missing is not known
 * at build time, and shipping the alternative (the 3.8 MB edge table, so the browser could
 * resolve the graph itself) to answer a question about eleven parts would be absurd.
 */
export default async function FarmPage() {
  const dataset = await getDataset()
  const { items, itemsById, sourcesById, edgesByItem, relicsByReward, relicsById, sources, nodes } =
    dataset

  const sets: TrackedSet[] = items
    .filter(isSet)
    .map((item) => ({
      id: item.id,
      name: item.name,
      parts: item.parts ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // One chain per distinct part. No part is currently shared between two sets — the
  // parts/ingredients split made fan-in exactly 1, where the old whole-recipe key had Orokin
  // Cell standing in for 177 of them — so this dedupe buys nothing today. Kept because the
  // key is the part and correctness must not depend on that measurement holding.
  const graph = { itemsById, sourcesById, edgesByItem, relicsByReward, relicsById }
  const chains: Record<string, DropChain> = {}
  for (const set of sets) {
    for (const component of set.parts) {
      if (chains[component.itemId] !== undefined) continue
      chains[component.itemId] = buildBestChain(graph, component.itemId)
    }
  }

  return (
    <div className={PAGE}>
      <PageHeader kicker="Yours" title="Farm now" />
      {/* The planner reads a search param for squad size, and anything reading search params
          needs a boundary or the page cannot be statically prerendered — the same trap
          /browse and /relics document. Unlike an item page there is no cost to it here:
          every word below the header is viewer-specific and noindex anyway. */}
      <Suspense fallback={<p className="label mt-8">Loading…</p>}>
        <FarmPlanner sets={sets} chains={chains} nodes={buildNodeIndex(nodes, sources)} />
      </Suspense>
    </div>
  )
}
