import {
  bestChain,
  bestEdge,
  bestRefinementFor,
  type DropChain,
  type DropEdge,
  type Item,
  type RelicDetail,
  type Source,
} from '@provenance/core'

import { sourceHref } from './source-route'

/**
 * Resolve the drop graph into whole routes.
 *
 * The ranking rules live in `@provenance/core` and are pure; this is the part that has to
 * touch the graph, so it lives here rather than being pushed into core alongside them.
 *
 * Shared by the item page and /farm on purpose. Two implementations of "the best way to get
 * this" would drift, and the whole premise of /farm is that it ranks using the same numbers
 * the item page shows — a plan that disagrees with the page it links to is worse than no
 * plan.
 */

export interface ChainGraph {
  itemsById: Map<string, Item>
  sourcesById: Map<string, Source>
  edgesByItem: Map<string, DropEdge[]>
  relicsByReward: Map<string, RelicDetail[]>
  relicsById: Map<string, RelicDetail>
}

/**
 * A relic is both an item and a source, so the edges that yield a relic include the relic
 * itself yielding its own contents. Following those would build a chain that tells the
 * reader to farm the relic by cracking the relic.
 */
function isRelicSource(sourceId: string): boolean {
  return sourceId.startsWith('relic:')
}

export function buildBestChain(graph: ChainGraph, itemId: string): DropChain {
  const item = graph.itemsById.get(itemId)
  const itemName = item?.name ?? itemId
  const hasItem = (id: string): boolean => graph.itemsById.has(id)

  const candidates: Parameters<typeof bestChain>[2][number][] = []

  // ---- direct drops ---------------------------------------------------------------
  // Syndicate offerings are excluded: a 100% standing purchase is a guaranteed buy, not a
  // farm, and costing it in "expected runs" would rank it above every real route at 1 run.
  const direct = (graph.edgesByItem.get(itemId) ?? []).filter((edge) => {
    if (isRelicSource(edge.sourceId)) return false
    return graph.sourcesById.get(edge.sourceId)?.kind !== 'syndicate'
  })
  const topDirect = bestEdge(direct)
  if (topDirect !== undefined) {
    const source = graph.sourcesById.get(topDirect.edge.sourceId)
    candidates.push({
      relic: undefined,
      source: {
        id: topDirect.edge.sourceId,
        name: source?.name ?? topDirect.edge.sourceId,
        kind: source?.kind ?? 'mission',
        chance: topDirect.chance,
        href: sourceHref(topDirect.edge.sourceId, hasItem),
      },
    })
  }

  // ---- relic-gated routes ---------------------------------------------------------
  for (const relic of graph.relicsByReward.get(itemId) ?? []) {
    const reward = relic.rewards.find((r) => r.itemId === itemId)
    if (reward === undefined) continue

    const relicEdges = (graph.edgesByItem.get(relic.id) ?? []).filter(
      (edge) => !isRelicSource(edge.sourceId),
    )
    const topSource = bestEdge(relicEdges)
    if (topSource === undefined) continue

    const source = graph.sourcesById.get(topSource.edge.sourceId)
    const refinement = bestRefinementFor(reward.rarity)

    candidates.push({
      relic: {
        id: relic.id,
        // The item table carries the display name ("Axi A1 Relic"); the raw slug is neither
        // the game's name for it nor what the relic's own page is titled.
        name: graph.itemsById.get(relic.id)?.name ?? relic.id,
        tier: relic.tier,
        rarity: reward.rarity,
        vaulted: relic.vaulted,
        refinement: refinement.refinement,
        chance: refinement.chance,
      },
      source: {
        id: topSource.edge.sourceId,
        name: source?.name ?? topSource.edge.sourceId,
        kind: source?.kind ?? 'mission',
        chance: topSource.chance,
        href: sourceHref(topSource.edge.sourceId, hasItem),
      },
    })
  }

  return bestChain(itemId, itemName, candidates)
}
