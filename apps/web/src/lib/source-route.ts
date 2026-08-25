import type { SourceKind } from '@provenance/core'

/**
 * Where a source id points on this site, and how a source route maps back to an id.
 *
 * Two facts make this non-trivial enough to deserve its own tested module:
 *
 *  1. A source id is namespaced and the rest may contain slashes —
 *     "mission:earth/cambria". The route is therefore /source/<kind>/<...rest>, a catch-all,
 *     and the id has to survive the round trip exactly or every link 404s.
 *
 *  2. Relics are items AND sources. `relic:axi-a1` and the item `axi-a1-relic` are the same
 *     object, and /item/axi-a1-relic already renders its contents at every refinement level.
 *     Generating a second page for it would split the relic across two URLs that each know
 *     half the story, so relic sources link to the item page instead.
 */

const SEPARATOR = ':'

/** The relic ITEM id for a relic SOURCE id, or undefined if this is not a relic source.
 *  The two slugs differ by a suffix because the source is named "Axi A1" upstream while the
 *  item is named "Axi A1 Relic"; both come from the same minting chokepoint, so the shape is
 *  stable, but the caller still checks the item exists rather than trusting it. */
export function relicItemIdFor(sourceId: string): string | undefined {
  const { kind, rest } = splitSourceId(sourceId)
  return kind === 'relic' ? `${rest}-relic` : undefined
}

export function splitSourceId(sourceId: string): { kind: string; rest: string } {
  const at = sourceId.indexOf(SEPARATOR)
  // An unnamespaced id is not something the pipeline emits, but returning "other" beats
  // throwing inside a render and blanking a page over one malformed row.
  if (at === -1) return { kind: 'other', rest: sourceId }
  return { kind: sourceId.slice(0, at), rest: sourceId.slice(at + 1) }
}

/** The catch-all route segments for a source id. */
export function sourceRouteParams(sourceId: string): { kind: string; slug: string[] } {
  const { kind, rest } = splitSourceId(sourceId)
  return { kind, slug: rest.split('/') }
}

/** The inverse of sourceRouteParams. Must round-trip exactly. */
export function sourceIdFromRoute(kind: string, slug: string[]): string {
  return `${kind}${SEPARATOR}${slug.join('/')}`
}

/**
 * The href for a source, given a way to ask whether an item id exists.
 *
 * The predicate is a parameter rather than an import because this runs in two places with
 * two different datasets in hand: the server pages hold the whole item table, and /browse
 * holds whatever chunk it has loaded.
 */
export function sourceHref(sourceId: string, hasItem: (itemId: string) => boolean): string {
  const relicItemId = relicItemIdFor(sourceId)
  if (relicItemId !== undefined && hasItem(relicItemId)) return `/item/${relicItemId}`
  const { kind, slug } = sourceRouteParams(sourceId)
  return `/source/${kind}/${slug.map(encodeURIComponent).join('/')}`
}

/** Whether this source needs a page of its own — i.e. whether sourceHref would point at one.
 *  generateStaticParams and sourceHref must agree, so both are derived from this. */
export function needsSourcePage(sourceId: string, hasItem: (itemId: string) => boolean): boolean {
  const relicItemId = relicItemIdFor(sourceId)
  return relicItemId === undefined || !hasItem(relicItemId)
}

/** Sentence-case name for a source kind, for breadcrumbs and headings. */
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  mission: 'Mission',
  relic: 'Relic',
  enemy: 'Enemy',
  bounty: 'Bounty',
  syndicate: 'Syndicate',
  sortie: 'Sortie',
  transient: 'Objective',
  cache: 'Cache',
  other: 'Source',
}

/** Plural of the same, spelled out. Appending "s" produced "Bountys" and "Enemys" on the
 *  index headings — the copy rules call things what players call them, and that is not it. */
export const SOURCE_KIND_PLURAL: Record<SourceKind, string> = {
  mission: 'Missions',
  relic: 'Relics',
  enemy: 'Enemies',
  bounty: 'Bounties',
  syndicate: 'Syndicates',
  sortie: 'Sorties',
  transient: 'Objectives',
  cache: 'Caches',
  other: 'Sources',
}
