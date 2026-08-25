import type { DropEdge, Item, ItemCategory, Rotation, Source } from '@provenance/core'

/**
 * The row model for a source page: what this thing drops, grouped the way the game groups it.
 *
 * The forward view of the same graph /item reads backwards (DESIGN.md § 7). Kept pure and
 * separate from the page for the usual reason — the grouping rules encode two upstream
 * quirks, and a rule with a quirk in it wants a test, not a JSX diff.
 */

export interface DropRow {
  itemId: string
  itemName: string
  category: ItemCategory
  chance: number
  quantity: [number, number]
  /** Bounty stage, syndicate rank and price. Absent where the group title already says it. */
  detail: string | undefined
}

export interface DropGroup {
  /** Stable key for React, and for the in-page anchor. */
  key: string
  title: string
  rows: DropRow[]
}

const ROTATION_ORDER: Rotation[] = ['A', 'B', 'C']

/**
 * QUIRK — a syndicate offering's `stage` repeats the syndicate's own name:
 * "Red Veil, Respected · 1,000 standing". The page heading already says Red Veil, so the
 * prefix is stripped rather than shown twice on every one of 188 rows.
 */
function trimDetail(stage: string | undefined, sourceName: string): string | undefined {
  if (stage === undefined) return undefined
  const prefix = `${sourceName}, `
  return stage.startsWith(prefix) ? stage.slice(prefix.length) : stage
}

export function groupDrops(
  source: Source,
  edges: DropEdge[],
  itemsById: Map<string, Item>,
  labelStage: (missionType: string | undefined, rotation: DropEdge['rotation']) => string | undefined,
): DropGroup[] {
  const toRow = (edge: DropEdge): DropRow | undefined => {
    const item = itemsById.get(edge.itemId)
    // The pipeline's orphan gate makes this unreachable; dropping the row beats throwing
    // inside a statically generated page and failing the whole build over one bad edge.
    if (item === undefined) return undefined
    return {
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      chance: edge.chance,
      quantity: edge.quantity,
      detail: trimDetail(edge.stage, source.name),
    }
  }

  // Highest chance first, matching /item and the owner's call on the direct-sources table.
  // Ties break on name so the order is total and the page is byte-identical between builds.
  const byChance = (a: DropRow, b: DropRow): number =>
    b.chance - a.chance || a.itemName.localeCompare(b.itemName)

  // No source in the dataset mixes rotation-bearing and rotation-free edges, so this is a
  // property of the source rather than of each row, and the split is unambiguous.
  const rotational = edges.some((edge) => edge.rotation != null)

  if (!rotational) {
    const rows = edges.map(toRow).filter((row): row is DropRow => row !== undefined).sort(byChance)
    return rows.length === 0 ? [] : [{ key: 'all', title: 'Drops', rows }]
  }

  const groups: DropGroup[] = []
  for (const rotation of ROTATION_ORDER) {
    const rows = edges
      .filter((edge) => edge.rotation === rotation)
      .map(toRow)
      .filter((row): row is DropRow => row !== undefined)
      .sort(byChance)
    if (rows.length === 0) continue
    groups.push({
      key: rotation,
      // stageLabel, not a hardcoded "Rotation": for Sabotage and Spy, A/B/C are the three
      // caches and the three vaults, and calling those rotations describes the mission wrongly.
      title: labelStage(source.missionType, rotation) ?? `Rotation ${rotation}`,
      rows,
    })
  }
  return groups
}
