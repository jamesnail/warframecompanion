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
