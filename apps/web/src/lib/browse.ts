import type { DropEdge, Item, ItemCategory, Source, SourceKind } from '@provenance/core'

import { relicItemIdFor, sourceHref } from './source-route'

/**
 * The /browse row model and its filtering, kept pure so it can be unit-tested and so the
 * component stays presentational.
 *
 * A row is one EDGE — one item from one source — not one item. That is the grain the tool
 * actually reasons in: "every way to get it" is a list of edges, and a table of items with
 * a collapsed source count would answer a question nobody asks.
 */

export interface BrowseRow {
  itemId: string
  itemName: string
  category: ItemCategory
  tradable: boolean
  sourceId: string
  sourceName: string
  sourceKind: SourceKind
  /** Where the source name links. Resolved here rather than in the component so the
   *  relic-source-to-item-page rule lives in one tested place. */
  sourceHref: string
  detail: string
  chance: number
  quantity: [number, number]
  /**
   * This particular path is currently unavailable: the source is a Void Relic that is not
   * in any active drop table. A property of the PATH, not the item — a part can be reachable
   * through one live relic and four vaulted ones, and collapsing that to a per-item flag
   * would hide the one row that still works.
   */
  vaulted: boolean
  /** Lowercased item + source name, precomputed. Filtering runs over ~28k rows on every
   *  keystroke, and lowercasing inside the predicate made that the slow part. */
  haystack: string
}

export interface BrowseFilters {
  q: string
  categories: ItemCategory[]
  kinds: SourceKind[]
  /** 0..1. Rows below this are hidden. */
  minChance: number
  tradableOnly: boolean
  /** Hide paths that go through a vaulted relic. 455 of 582 prime parts are reachable only
   *  that way, so "what can I farm today" is a different question from "where is it from". */
  farmableOnly: boolean
}

export const EMPTY_FILTERS: BrowseFilters = {
  q: '',
  categories: [],
  kinds: [],
  minChance: 0,
  tradableOnly: false,
  farmableOnly: false,
}

export type SortColumn = 'item' | 'source' | 'category' | 'chance'
export type SortDirection = 'asc' | 'desc'

/**
 * A relic source is vaulted when its ITEM twin says so. The two are the same object under
 * different ids — `relic:axi-a1` and `axi-a1-relic` — and only the item carries the flag,
 * because vaulting is derived from whether anything currently drops it (DESIGN.md § 10.5).
 */
function isVaultedRelic(sourceId: string, itemsById: Map<string, Item>): boolean {
  const relicItemId = relicItemIdFor(sourceId)
  if (relicItemId === undefined) return false
  return itemsById.get(relicItemId)?.vaulted === true
}

export function buildRows(
  items: Item[],
  sources: Source[],
  edges: DropEdge[],
  labelStage: (missionType: string | undefined, rotation: DropEdge['rotation']) => string | undefined,
): BrowseRow[] {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const sourcesById = new Map(sources.map((source) => [source.id, source]))

  const rows: BrowseRow[] = []
  for (const edge of edges) {
    const item = itemsById.get(edge.itemId)
    const source = sourcesById.get(edge.sourceId)
    // Both resolve for every edge — the pipeline's orphan gate guarantees it — but a
    // client that trusted that and was wrong would crash the page rather than drop a row.
    if (item === undefined || source === undefined) continue

    const detail = [
      source.planet,
      source.missionType,
      labelStage(source.missionType, edge.rotation),
      edge.refinement === undefined
        ? undefined
        : edge.refinement.charAt(0).toUpperCase() + edge.refinement.slice(1),
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · ')

    rows.push({
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      tradable: item.tradable,
      sourceId: source.id,
      sourceName: source.name,
      sourceKind: source.kind,
      sourceHref: sourceHref(source.id, (id) => itemsById.has(id)),
      detail,
      chance: edge.chance,
      quantity: edge.quantity,
      vaulted: isVaultedRelic(source.id, itemsById),
      haystack: `${item.name} ${source.name}`.toLowerCase(),
    })
  }
  return rows
}

/**
 * Substring match, deliberately not fuzzy.
 *
 * The palette is fuzzy because you are recalling one name from 4.5k and a typo should still
 * find it. A table filter is the opposite: you are narrowing a set you can see, and fuzzy
 * matching there returns rows you did not ask for and cannot explain. Every term must
 * appear, so terms narrow rather than widen.
 */
export function filterRows(rows: BrowseRow[], filters: BrowseFilters): BrowseRow[] {
  const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean)
  const categories = filters.categories.length === 0 ? undefined : new Set(filters.categories)
  const kinds = filters.kinds.length === 0 ? undefined : new Set(filters.kinds)

  return rows.filter((row) => {
    if (categories !== undefined && !categories.has(row.category)) return false
    if (kinds !== undefined && !kinds.has(row.sourceKind)) return false
    if (filters.tradableOnly && !row.tradable) return false
    if (filters.farmableOnly && row.vaulted) return false
    if (row.chance < filters.minChance) return false
    for (const term of terms) {
      if (!row.haystack.includes(term)) return false
    }
    return true
  })
}

/**
 * Sorted copy. Ties break on item name so the order is total — otherwise two rows with the
 * same 25.33% swap places between renders and the table appears to shuffle on its own.
 */
export function sortRows(
  rows: BrowseRow[],
  column: SortColumn,
  direction: SortDirection,
): BrowseRow[] {
  const sign = direction === 'asc' ? 1 : -1
  const compare = (a: BrowseRow, b: BrowseRow): number => {
    switch (column) {
      case 'chance':
        return (a.chance - b.chance) * sign
      case 'source':
        return a.sourceName.localeCompare(b.sourceName) * sign
      case 'category':
        return a.category.localeCompare(b.category) * sign
      case 'item':
        return a.itemName.localeCompare(b.itemName) * sign
    }
  }
  return [...rows].sort((a, b) => compare(a, b) || a.itemName.localeCompare(b.itemName))
}

/** Which categories and kinds actually occur, so the filter UI never offers a dead option. */
export function facetsOf(rows: BrowseRow[]): {
  categories: ItemCategory[]
  kinds: SourceKind[]
} {
  const categories = new Set<ItemCategory>()
  const kinds = new Set<SourceKind>()
  for (const row of rows) {
    categories.add(row.category)
    kinds.add(row.sourceKind)
  }
  return {
    categories: [...categories].sort((a, b) => a.localeCompare(b)),
    kinds: [...kinds].sort((a, b) => a.localeCompare(b)),
  }
}
