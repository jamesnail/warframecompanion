import type {
  CompiledQuery,
  DropEdge,
  Item,
  ItemCategory,
  QueryItem,
  QueryPath,
  Source,
  SourceKind,
} from '@provenance/core'

import { isPrimeName, tierFromSourceName } from './query-index'
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
  /** Query-language fields. Carried on the row so a predicate is a field read rather than a
   *  join back to the source table on every keystroke. */
  planet: string | undefined
  tier: string | undefined
  rotation: string | undefined
  /** Lowercased item + source name, precomputed. Filtering runs over ~28k rows on every
   *  keystroke, and lowercasing inside the predicate made that the slow part. */
  haystack: string
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
      planet: source.planet,
      tier: source.kind === 'relic' ? tierFromSourceName(source.name) : undefined,
      rotation: edge.rotation ?? undefined,
      haystack: `${item.name} ${source.name}`.toLowerCase(),
    })
  }
  return rows
}

/**
 * The path-grain projection of a row.
 *
 * The item facts a row does not carry — prime, set, mastery, market — are looked up rather
 * than duplicated onto the row, so the two grains cannot drift apart on what "prime" means.
 * The fallback exists only for a row whose item is missing from the index, which the orphan
 * gate makes impossible and which must still not throw inside a filter.
 */
export function pathOf(row: BrowseRow, item: QueryItem | undefined): QueryPath {
  return {
    itemName: row.itemName,
    haystack: row.haystack,
    category: row.category,
    tradable: row.tradable,
    hasMarket: item?.hasMarket ?? false,
    isPrime: item?.isPrime ?? isPrimeName(row.itemName),
    isSet: item?.isSet ?? false,
    masteryReq: item?.masteryReq,
    vaulted: row.vaulted,
    kind: row.sourceKind,
    planet: row.planet,
    tier: row.tier,
    rotation: row.rotation,
    chance: row.chance,
  }
}

/**
 * Rows matching a compiled query, at path grain.
 *
 * Bare words are substring matches here, deliberately not fuzzy: the palette is fuzzy because
 * you are recalling one name from 4.9k and a typo should still find it, whereas a table filter
 * narrows a set you can already see, where a fuzzy hit returns rows you did not ask for and
 * cannot explain. Terms narrow rather than widen — that is what makes AND the right default.
 */
export function filterRows(
  rows: BrowseRow[],
  compiled: CompiledQuery,
  itemsById: ReadonlyMap<string, QueryItem>,
): BrowseRow[] {
  if (compiled.size === 0) return rows
  return rows.filter((row) => compiled.matchPath(pathOf(row, itemsById.get(row.itemId))))
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
