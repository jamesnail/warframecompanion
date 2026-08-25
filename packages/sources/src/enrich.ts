import { z } from 'zod'

import type { Item, ItemCategory } from '@provenance/core'

import { slug } from './slug'

/**
 * Item metadata from WFCD's `warframe-items` project.
 *
 * The drop tables give us names and probabilities and nothing else, so before this every
 * category was inferred from a regex over the name. That left 52% of the catalogue in
 * "Other", never populated `masteryReq`, `components` or `imageName` at all, and defaulted
 * `tradable` to false for everything. A filter UI built on that would be filtering on
 * guesses.
 *
 * Fetched as JSON at build time rather than taken as a dependency. `@wfcd/items` unpacks to
 * 101 MB, which every CI run and every `pnpm install` would pay for; the per-category files
 * are ~36 MB and we only read a subset of the fields. It also keeps this consistent with how
 * the drop data itself is sourced, through the same retried, Zod-validated fetch path.
 */

/**
 * The category files to read, and what each one means in our vocabulary.
 *
 * `All.json` is deliberately absent — it is 62 MB and duplicates every one of these. `Node`
 * and `Enemy` are absent because they describe places and creatures, not items. `Relics` is
 * absent because relics are modelled from the drop data itself, where the reward tables and
 * refinement states live.
 */
export const WFCD_FILES: ReadonlyArray<{ file: string; category: ItemCategory }> = [
  { file: 'Warframes', category: 'Warframe' },
  { file: 'Primary', category: 'Primary' },
  { file: 'Secondary', category: 'Secondary' },
  { file: 'Melee', category: 'Melee' },
  { file: 'Archwing', category: 'Archwing' },
  { file: 'Arch-Gun', category: 'Archwing' },
  { file: 'Arch-Melee', category: 'Archwing' },
  { file: 'Sentinels', category: 'Companion' },
  { file: 'SentinelWeapons', category: 'Companion' },
  { file: 'Pets', category: 'Companion' },
  { file: 'Mods', category: 'Mod' },
  { file: 'Arcanes', category: 'Arcane' },
  { file: 'Resources', category: 'Resource' },
  { file: 'Fish', category: 'Resource' },
  { file: 'Skins', category: 'Cosmetic' },
  { file: 'Glyphs', category: 'Cosmetic' },
  { file: 'Sigils', category: 'Cosmetic' },
  { file: 'Gear', category: 'Other' },
  { file: 'Quests', category: 'Other' },
  { file: 'Railjack', category: 'Other' },
  { file: 'Misc', category: 'Other' },
] as const

/**
 * Only the fields we actually read. Everything else in these files — damage curves, patch
 * logs, wiki URLs — is ignored, so the schema stays permissive about the rest rather than
 * failing the build when WFCD adds a field.
 */
export const RawWfcdComponent = z.object({
  name: z.string(),
  uniqueName: z.string().optional(),
  itemCount: z.number().int().positive().optional(),
  tradable: z.boolean().optional(),
  imageName: z.string().optional(),
})

export const RawWfcdItem = z.object({
  name: z.string(),
  uniqueName: z.string().optional(),
  type: z.string().optional(),
  masteryReq: z.number().int().min(0).max(30).optional(),
  tradable: z.boolean().optional(),
  imageName: z.string().optional(),
  components: z.array(RawWfcdComponent).optional(),
})
export type RawWfcdItem = z.infer<typeof RawWfcdItem>

export interface Enrichment {
  category: ItemCategory
  uniqueName?: string
  imageName?: string
  tradable?: boolean
  masteryReq?: number
  components?: { itemId: string; count: number }[]
}

/**
 * Some Misc entries are more precisely described by their own `type` than by the file they
 * live in — Misc holds Archon shards and conservation tags next to genuine resources.
 */
const TYPE_OVERRIDES: Record<string, ItemCategory> = {
  Resource: 'Resource',
  'Fish Part': 'Resource',
  Captura: 'Cosmetic',
}

/**
 * A WFCD name can carry a UI sprite token: "<Shard_blue_simple> Azure Archon Shard". The
 * drop tables use the bare name, so both spellings are indexed.
 */
function stripSpriteToken(name: string): string {
  return name.replace(/^<[^>]*>\s*/, '').trim()
}

/** A component is a PART of its parent only if it is one of the parent's recipes. Shared
 *  build ingredients — Orokin Cell, Neurodes — live in the same array but are their own
 *  items, and prefixing them would invent "Braton Prime Orokin Cell". */
function isPartOfParent(component: z.infer<typeof RawWfcdComponent>): boolean {
  return component.uniqueName?.includes('/Recipes/') === true
}

function partCategory(partName: string): ItemCategory {
  return /blueprint$/i.test(partName.trim()) ? 'Blueprint' : 'Component'
}

/**
 * Build the lookup from item id to metadata.
 *
 * Both top-level items and their parts are indexed. Parts matter because the drop tables
 * are mostly parts: upstream says "Braton Prime Barrel" where WFCD nests a component called
 * simply "Barrel" under "Braton Prime", so the composite name is what has to be indexed.
 *
 * First writer wins, and the file order above is therefore meaningful: a name appearing in
 * two files keeps the more specific category.
 */
export function buildEnrichmentIndex(
  files: ReadonlyArray<{ file: string; category: ItemCategory; rows: RawWfcdItem[] }>,
): Map<string, Enrichment> {
  const index = new Map<string, Enrichment>()
  const put = (key: string, value: Enrichment): void => {
    if (key !== '' && !index.has(key)) index.set(key, value)
  }

  for (const { category, rows } of files) {
    for (const row of rows) {
      const clean = stripSpriteToken(row.name)
      const resolved = (row.type === undefined ? undefined : TYPE_OVERRIDES[row.type]) ?? category

      const parts = (row.components ?? []).filter(isPartOfParent)
      const components = parts.map((part) => ({
        itemId: slug(`${clean} ${part.name}`),
        count: part.itemCount ?? 1,
      }))

      const self: Enrichment = {
        category: resolved,
        ...(row.uniqueName === undefined ? {} : { uniqueName: row.uniqueName }),
        ...(row.imageName === undefined ? {} : { imageName: row.imageName }),
        ...(row.tradable === undefined ? {} : { tradable: row.tradable }),
        ...(row.masteryReq === undefined ? {} : { masteryReq: row.masteryReq }),
        ...(components.length === 0 ? {} : { components }),
      }

      put(slug(row.name), self)
      put(slug(clean), self)

      for (const part of parts) {
        put(slug(`${clean} ${part.name}`), {
          category: partCategory(part.name),
          ...(part.uniqueName === undefined ? {} : { uniqueName: part.uniqueName }),
          ...(part.imageName === undefined ? {} : { imageName: part.imageName }),
          ...(part.tradable === undefined ? {} : { tradable: part.tradable }),
        })
      }
    }
  }

  return index
}

/**
 * The name spellings to try, in order of preference.
 *
 * Two upstream habits stop an exact match, and both are cheap to undo. Warframe augment
 * mods are listed as "Abating Link (Trinity)" where the mod itself is just "Abating Link",
 * and part rewards are listed as "Aeolak Barrel Blueprint" where the part is "Aeolak
 * Barrel". Together these two rules took the match rate from 75.5% to 96.4%.
 */
export function nameVariants(name: string): string[] {
  const variants = [name]

  const withoutSuffix = name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (withoutSuffix !== name && withoutSuffix !== '') variants.push(withoutSuffix)

  for (const base of [...variants]) {
    const withoutBlueprint = base.replace(/\s+Blueprint$/i, '').trim()
    if (withoutBlueprint !== base && withoutBlueprint !== '') variants.push(withoutBlueprint)
  }

  return variants
}

export function lookupEnrichment(
  name: string,
  index: Map<string, Enrichment>,
): Enrichment | undefined {
  for (const variant of nameVariants(name)) {
    const hit = index.get(slug(variant))
    if (hit !== undefined) return hit
  }
  return undefined
}

export interface EnrichResult {
  items: Item[]
  matched: number
  /** Names that found no metadata. Real ones exist (credit caches, boosters), so this is
   *  reported and budgeted rather than treated as an error. */
  unmatched: string[]
}

/**
 * Apply metadata to the item table.
 *
 * Relics are skipped deliberately. Their category, name and vaulted status are derived from
 * the drop data itself, which knows the current reward tables and refinement states; WFCD's
 * relic entries would only disagree.
 */
export function enrichItems(items: Item[], index: Map<string, Enrichment>): EnrichResult {
  let matched = 0
  const unmatched: string[] = []

  const enriched = items.map((item) => {
    if (item.category === 'Relic') return item

    const hit = lookupEnrichment(item.name, index)
    if (hit === undefined) {
      unmatched.push(item.name)
      return item
    }

    matched++
    return {
      ...item,
      category: hit.category,
      ...(hit.uniqueName === undefined ? {} : { uniqueName: hit.uniqueName }),
      ...(hit.imageName === undefined ? {} : { imageName: hit.imageName }),
      ...(hit.masteryReq === undefined ? {} : { masteryReq: hit.masteryReq }),
      ...(hit.components === undefined ? {} : { components: hit.components }),
      // Only ever raised, never lowered. `tradable` defaults to false in buildItems, and a
      // missing WFCD flag is unknown rather than a denial.
      tradable: hit.tradable ?? item.tradable,
    }
  })

  return { items: enriched, matched, unmatched }
}
