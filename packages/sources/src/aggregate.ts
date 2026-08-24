import type { DropEdge } from '@provenance/core'

/**
 * Collapse repeated reward rows into one edge per (item, source, rotation, stage).
 *
 * QUIRK: upstream lists an item once per reward SLOT, not once per table. "400 Endo"
 * appears six times in one Mercury cache rotation, each with its own chance. Emitting six
 * edges was wrong twice over:
 *
 *   - the real chance of seeing the item is the chance of hitting ANY of those slots,
 *     `1 - Π(1 - c)`, which is strictly higher than any single row. Showing one row's
 *     chance understated it — by a factor approaching the slot count for small chances.
 *   - the UI rendered the same mission six times in "Direct sources", and counted each as
 *     a separate source, so a node with six slots looked like six places to farm.
 *
 * Slots within a table are independent draws, hence the complement-of-product. Stage is
 * part of the key because a bounty's Stage 1 and Stage 2 really are separate
 * opportunities, not repeats of one.
 */
export function aggregateEdges(edges: DropEdge[]): DropEdge[] {
  const byKey = new Map<string, DropEdge>()

  for (const edge of edges) {
    const key = [edge.itemId, edge.sourceId, edge.rotation ?? '', edge.stage ?? ''].join('|')
    const existing = byKey.get(key)

    if (existing === undefined) {
      byKey.set(key, { ...edge })
      continue
    }

    // P(at least one slot hits) = 1 - (1-a)(1-b)
    existing.chance = 1 - (1 - existing.chance) * (1 - edge.chance)
    existing.quantity = [
      Math.min(existing.quantity[0], edge.quantity[0]),
      Math.max(existing.quantity[1], edge.quantity[1]),
    ]
    // A composed path is only as trustworthy as its least-trusted input.
    if (edge.provenance === 'wiki') existing.provenance = 'wiki'
  }

  return [...byKey.values()]
}
