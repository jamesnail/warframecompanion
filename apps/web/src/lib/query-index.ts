import { RelicTier, type DropEdge, type Item, type QueryItem, type Source } from '@provenance/core'

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

/**
 * A component contributes its sources to the set it builds ONLY if it is exclusive to that
 * set — `buildsInto` naming at most one thing.
 *
 * Without this, Ash Prime inherits Orokin Cell's 121 edges and reports itself as dropping from
 * missions, bounties, transients and enemies, so `from:enemy` matches every prime Warframe in
 * the game. This is the third time this exact shape has bitten the project — hazard 17 capped
 * the "Part of" backlink for it, hazard 37 put 177 sets on the farm plan — so it is a rule
 * rather than a third special case. Measured: Ash Prime resolves to `relic` alone, all 50
 * prime Warframes resolve, 311 of 313 sets resolve, and 34 shared components are excluded,
 * every one of them a generic resource.
 */
function isExclusiveComponent(componentId: string, itemsById: Map<string, Item>): boolean {
  return (itemsById.get(componentId)?.buildsInto?.length ?? 0) <= 1
}

interface PathFacts {
  kind: string
  planet: string | undefined
  tier: string | undefined
  rotation: string | undefined
  chance: number
  vaulted: boolean
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

export function buildQueryItems(items: Item[], sources: Source[], edges: DropEdge[]): QueryItem[] {
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
      sourceName: source.name,
    }

    const existing = factsByItemId.get(edge.itemId)
    if (existing === undefined) factsByItemId.set(edge.itemId, [facts])
    else existing.push(facts)
  }

  return items.map((item) => {
    const own = factsByItemId.get(item.id) ?? []
    const inherited: PathFacts[] = []
    for (const component of item.components ?? []) {
      if (!isExclusiveComponent(component.itemId, itemsById)) continue
      inherited.push(...(factsByItemId.get(component.itemId) ?? []))
    }
    const facts = own.length > 0 || inherited.length > 0 ? [...own, ...inherited] : []

    const kinds = new Set<string>()
    const planets = new Set<string>()
    const tiers = new Set<string>()
    const rotations = new Set<string>()
    const sourceNames: string[] = []
    let bestChance = 0
    let allVaulted = facts.length > 0

    for (const fact of facts) {
      kinds.add(fact.kind.toLowerCase())
      if (fact.planet !== undefined) planets.add(fact.planet.toLowerCase())
      if (fact.tier !== undefined) tiers.add(fact.tier.toLowerCase())
      if (fact.rotation !== undefined) rotations.add(fact.rotation.toLowerCase())
      sourceNames.push(fact.sourceName)
      if (fact.chance > bestChance) bestChance = fact.chance
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
      isSet: (item.components?.length ?? 0) > 0,
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
export function buildItemOnlyIndex(items: Item[]): QueryItem[] {
  const empty: ReadonlySet<string> = new Set()
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    haystack: item.name.toLowerCase(),
    category: item.category,
    tradable: item.tradable,
    hasMarket: item.marketSlug !== undefined,
    isPrime: isPrimeName(item.name),
    isSet: (item.components?.length ?? 0) > 0,
    masteryReq: item.masteryReq,
    vaulted: item.category === 'Relic' && item.vaulted === true,
    kinds: empty,
    planets: empty,
    tiers: empty,
    rotations: empty,
    sourceText: '',
    bestChance: 0,
  }))
}

/** Keyed for the row adapter, which needs the item facts a row does not carry. */
export function indexById(items: QueryItem[]): Map<string, QueryItem> {
  return new Map(items.map((item) => [item.id, item]))
}
