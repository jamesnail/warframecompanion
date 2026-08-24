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
