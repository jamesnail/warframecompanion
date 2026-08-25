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

export function parseRewardName(raw: string): { name: string; refinement?: Refinement } {
  const match = PREREFINED_RELIC.exec(raw.trim())
  const base = match?.[1]
  const level = match?.[2]
  if (base === undefined || level === undefined) return { name: raw }
  return { name: base, refinement: level.toLowerCase() as Refinement }
}

/** The canonical item id for a raw reward name. Use this, never `slug(name)` directly. */
export function itemIdFor(raw: string): string {
  return slug(parseRewardName(raw).name)
}
