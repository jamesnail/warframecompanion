import type { Refinement } from '@provenance/core'

/**
 * Slugs are the stable public identity of every item and source — they appear in URLs
 * that must keep working across daily rebuilds, so this function's output is effectively
 * an API. Change it and every bookmarked link breaks.
 */
export function slug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function missionSourceId(planet: string, node: string): string {
  return `mission:${slug(planet)}/${slug(node)}`
}

export function relicSourceId(tier: string, name: string): string {
  return `relic:${slug(tier)}-${slug(name)}`
}

export function relicItemId(tier: string, name: string): string {
  return `${slug(tier)}-${slug(name)}-relic`
}

/**
 * The inverse of relicItemId, for display: "axi-a1-relic" -> "Axi A1 Relic".
 *
 * Relics reach the item table by two routes. Ones currently in rotation arrive named by
 * whatever drops them ("Axi A21 Relic"), but vaulted relics have no such source, and
 * previously fell back to using their own slug as their display name — so 729 of 793
 * relic pages were headed "axi-a1-relic". The id is structured, so the name is derivable
 * without carrying an extra field through the model.
 */
export function relicDisplayName(id: string, tier: string): string {
  const code = id
    .replace(/-relic$/, '')
    .replace(new RegExp(`^${slug(tier)}-`), '')
    .toUpperCase()
  return `${tier} ${code} Relic`
}

/**
 * Split a raw upstream reward name into the item it actually refers to and, where the
 * source hands out a pre-refined relic, the refinement it arrives at.
 *
 * Elite Sanctuary Onslaught and several bounties pay in Radiant relics, and upstream
 * expresses that in the NAME: "Lith A12 Relic (Radiant)". Slugging that whole string
 * minted a second item — 29 of them — each with drop sources but no relic contents, absent
 * from every prime part's relic list, and stealing sources from the real relic's page.
 *
 * The refinement belongs on the edge (DropEdge.refinement), so every reward name goes
 * through here before it becomes an id.
 */
const PREREFINED_RELIC = /^(.+\bRelic)\s*\((Intact|Exceptional|Flawless|Radiant)\)\s*$/i

/**
 * Upstream also encodes HOW MANY in the name: "100X Plastids", "10X Corrupted Holokey".
 * Slugging the whole string fragmented 279 reward names into 164 real things — six separate
 * "Plastids" pages, not one of them reachable by searching "Plastids", which defeats the
 * reverse lookup this site exists to perform. The count belongs in the edge's own
 * quantity field, which until now was hardcoded to [1, 1].
 */
const QUANTITY_X = /^(\d[\d,]*)\s*[xX]\s+(.+)$/

/**
 * A leading number WITHOUT the "X" is only sometimes a count, so it is opt-in per noun
 * rather than stripped on sight. Stripping blindly invents facts:
 *
 *   "100 Endo"               -> 100 Endo.          A count.
 *   "15,000 Credits"         -> 15,000 credits.    A count.
 *   "1,500 Credits Cache"    -> ONE cache paying 1,500 credits, NOT 1,500 caches.
 *   "3 Day Affinity Booster" -> the booster's NAME. No "Day Affinity Booster" exists.
 *
 * Currencies are a small, stable set. Everything else keeps its number and stays whole,
 * so an unrecognised name fails safe rather than losing a word.
 */
const BARE_QUANTITY = /^(\d[\d,]*)\s+(.+)$/
const COUNTABLE_BARE = new Set(['endo', 'credits'])

function readCount(digits: string): number | undefined {
  const value = Number.parseInt(digits.replace(/,/g, ''), 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export interface ParsedRewardName {
  name: string
  /** Units per drop, where the name said so. Composes with the edge's own quantity. */
  quantity?: number
  /** Set where the source hands out a pre-refined relic. */
  refinement?: Refinement
}

export function parseRewardName(raw: string): ParsedRewardName {
  let name = raw.trim()
  let quantity: number | undefined

  const explicit = QUANTITY_X.exec(name)
  const bare = explicit === null ? BARE_QUANTITY.exec(name) : null

  if (explicit?.[1] !== undefined && explicit[2] !== undefined) {
    quantity = readCount(explicit[1])
    if (quantity !== undefined) name = explicit[2].trim()
  } else if (bare?.[1] !== undefined && bare[2] !== undefined) {
    const noun = bare[2].trim()
    if (COUNTABLE_BARE.has(noun.toLowerCase())) {
      quantity = readCount(bare[1])
      if (quantity !== undefined) name = noun
    }
  }

  // Refinement is matched against what is LEFT, so a hypothetical "2X Lith A12 Relic
  // (Radiant)" still resolves to the plain relic instead of falling between both rules.
  const refined = PREREFINED_RELIC.exec(name)
  const base = refined?.[1]
  const level = refined?.[2]
  if (base !== undefined && level !== undefined) {
    return {
      name: base,
      ...(quantity === undefined ? {} : { quantity }),
      refinement: level.toLowerCase() as Refinement,
    }
  }

  return { name, ...(quantity === undefined ? {} : { quantity }) }
}

/** The canonical item id for a raw reward name. Use this, never `slug(name)` directly. */
export function itemIdFor(raw: string): string {
  return slug(parseRewardName(raw).name)
}
