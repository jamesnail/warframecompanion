import {
  RelicTier,
  isSet,
  pathSourceIds,
  type DropEdge,
  type Item,
  type MarketPrice,
  type QueryItem,
  type Source,
} from '@provenance/core'

import { relicItemIdFor } from './source-route'

/**
 * Builds the item-grain projection the query language evaluates against.
 *
 * Why items and not edges: all 50 prime Warframes have ZERO drop edges of their own. An
 * assembled set is not dropped, its parts are — so `is:prime cat:warframe` evaluated over the
 * edge table returns nothing, which is the question the whole feature exists to answer.
 * 1,046 of 4,875 items have no edge, and the number is exactly 737 vaulted relics plus 309
 * assembled sets.
 *
 * Built once per dataset load. Every path fact is pre-rolled into a Set so a key is a
 * membership test rather than a scan, which is what keeps evaluation under half a millisecond
 * over the full corpus.
 */

/** DE names primes exactly, and always on a word boundary: "Braton Prime", never "Primed". */
const PRIME = / Prime\b/

export function isPrimeName(name: string): boolean {
  return PRIME.test(name)
}

interface PathFacts {
  kind: string
  planet: string | undefined
  tier: string | undefined
  rotation: string | undefined
  chance: number
  vaulted: boolean
  sourceId: string
  sourceName: string
}

const TIERS = new Set<string>(RelicTier.options)

/**
 * A relic source's tier, read off the front of its name — "Axi A1 Relic" is Axi.
 *
 * The alternative is loading the 294 KB relic chunk into /browse purely to look up one word,
 * on a page that already pulls 5 MB. Measured before relying on it: the first word of the name
 * equals the tier on 771 of 771 relic sources, exactly. Validated against RelicTier rather
 * than trusted, so a naming change upstream yields `undefined` — the tier key then matches
 * nothing, which is visible — instead of a plausible-looking wrong value.
 */
export function tierFromSourceName(name: string): string | undefined {
  const first = name.split(' ')[0]
  return first !== undefined && TIERS.has(first) ? first : undefined
}

export type PriceIndex = ReadonlyMap<string, MarketPrice>

export function buildQueryItems(
  items: Item[],
  sources: Source[],
  edges: DropEdge[],
  prices: PriceIndex = new Map(),
): QueryItem[] {
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const sourcesById = new Map(sources.map((source) => [source.id, source]))

  const factsByItemId = new Map<string, PathFacts[]>()
  for (const edge of edges) {
    const source = sourcesById.get(edge.sourceId)
    if (source === undefined) continue

    const relicItemId = relicItemIdFor(source.id)
    const facts: PathFacts = {
      kind: source.kind,
      planet: source.planet,
      tier: relicItemId === undefined ? undefined : tierFromSourceName(source.name),
      rotation: edge.rotation ?? undefined,
      chance: edge.chance,
      vaulted: relicItemId !== undefined && itemsById.get(relicItemId)?.vaulted === true,
      sourceId: source.id,
      sourceName: source.name,
    }

    const existing = factsByItemId.get(edge.itemId)
    if (existing === undefined) factsByItemId.set(edge.itemId, [facts])
    else existing.push(facts)
  }

  return items.map((item) => {
    // A set is never dropped, so its paths are its parts' paths. `pathSourceIds` is the one
    // place that decides which items those are, and it excludes ingredients — inheriting
    // Orokin Cell's 121 edges made `from:enemy` match every prime Warframe in the game.
    const facts: { fact: PathFacts; via: string | undefined }[] = []
    for (const sourceItemId of pathSourceIds(item)) {
      const via = sourceItemId === item.id ? undefined : itemsById.get(sourceItemId)?.name
      for (const fact of factsByItemId.get(sourceItemId) ?? []) facts.push({ fact, via })
    }

    const kinds = new Set<string>()
    const planets = new Set<string>()
    const tiers = new Set<string>()
    const rotations = new Set<string>()
    const sourceNames: string[] = []
    let bestChance = 0
    let best: QueryItem['best']
    let allVaulted = facts.length > 0

    for (const { fact, via } of facts) {
      kinds.add(fact.kind.toLowerCase())
      if (fact.planet !== undefined) planets.add(fact.planet.toLowerCase())
      if (fact.tier !== undefined) tiers.add(fact.tier.toLowerCase())
      if (fact.rotation !== undefined) rotations.add(fact.rotation.toLowerCase())
      sourceNames.push(fact.sourceName)
      // Strictly greater, so the first path wins a tie and the row is stable between builds.
      if (fact.chance > bestChance || best === undefined) {
        bestChance = fact.chance
        best = { sourceId: fact.sourceId, sourceName: fact.sourceName, via }
      }
      if (!fact.vaulted) allVaulted = false
    }

    return {
      id: item.id,
      name: item.name,
      haystack: item.name.toLowerCase(),
      category: item.category,
      tradable: item.tradable,
      hasMarket: item.marketSlug !== undefined,
      isPrime: isPrimeName(item.name),
      isSet: isSet(item),
      masteryReq: item.masteryReq,
      // A relic carries the flag itself; anything else is vaulted only when EVERY path to it
      // runs through a vaulted relic. One live path is all you need.
      vaulted: item.category === 'Relic' ? item.vaulted === true : allVaulted,
      kinds,
      planets,
      tiers,
      rotations,
      sourceText: sourceNames.join(' ').toLowerCase(),
      bestChance,
      paths: facts.length,
      best,
      // The cheapest live ask: what you would pay. Absent when the chunk was not loaded on
      // this surface, which `queryNeedsPaths` is what prevents from being mistaken for
      // "nobody is selling this".
      price: prices.get(item.id)?.sellLow,
    }
  })
}

/**
 * The item-only projection: everything answerable without the drop-edge chunk.
 *
 * What the palette starts with. `cat:`, `mr:`, `is:prime`, `is:set`, `is:tradable` and
 * `has:market` are all properties of the item itself, so a 4,875-entry index over the 1.1 MB
 * item chunk answers them with no further network at all. The path sets are empty rather than
 * wrong, and `queryNeedsPaths` is what stops a path query being asked of this index.
 */
export function buildItemOnlyIndex(items: Item[], prices: PriceIndex = new Map()): QueryItem[] {
  const empty: ReadonlySet<string> = new Set()
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    haystack: item.name.toLowerCase(),
    category: item.category,
    tradable: item.tradable,
    hasMarket: item.marketSlug !== undefined,
    isPrime: isPrimeName(item.name),
    isSet: isSet(item),
    masteryReq: item.masteryReq,
    vaulted: item.category === 'Relic' && item.vaulted === true,
    kinds: empty,
    planets: empty,
    tiers: empty,
    rotations: empty,
    sourceText: '',
    bestChance: 0,
    paths: 0,
    best: undefined,
    price: prices.get(item.id)?.sellLow,
  }))
}

/** Keyed for the row adapter, which needs the item facts a row does not carry. */
export function indexById(items: QueryItem[]): Map<string, QueryItem> {
  return new Map(items.map((item) => [item.id, item]))
}
