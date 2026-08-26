import { z } from 'zod'

import type { Item, RivenType, RivenWeapon } from '@provenance/core'

import { slug } from './slug'
import type { RawWfcdItem } from './enrich'

/**
 * Riven dispositions and the weekly market floor.
 *
 * Two upstream facts, joined by weapon name:
 *
 *  - Disposition comes from `@wfcd/items`, which carries both the 1-5 dots the game draws
 *    (`disposition`) and the real multiplier it applies (`omegaAttenuation`, 0.5-1.55).
 *  - Price comes from Digital Extremes' own weekly riven trade statistics, mirrored by
 *    WFCD's status API. This is real observed trade data — median, min, max and sample size
 *    per weapon — and almost nothing surfaces it well.
 *
 * Both are fetched at BUILD time and committed as static JSON, like every other dataset
 * here. Nothing about rivens reaches the browser over the network at runtime, so this needs
 * no server route and no live market dependency (CLAUDE.md constraints 2 and 3).
 */

/**
 * The weekly trade file, shaped `{ [rivenType]: { [weaponName]: { rerolled?, unrolled? } } }`.
 *
 * Permissive on purpose: DE adds riven categories when it adds weapon classes, and an
 * unrecognised one should widen the dataset rather than fail the build.
 */
export const RawRivenStat = z.object({
  itemType: z.string(),
  compatibility: z.string().nullable(),
  rerolled: z.boolean(),
  avg: z.number(),
  stddev: z.number(),
  min: z.number(),
  max: z.number(),
  pop: z.number(),
  median: z.number(),
})
export type RawRivenStat = z.infer<typeof RawRivenStat>

export const RawRivenFile = z.record(
  z.string(),
  z.record(z.string(), z.record(z.string(), RawRivenStat)),
)
export type RawRivenFile = z.infer<typeof RawRivenFile>

/** "Rifle Riven Mod" -> "Rifle". The suffix is constant; the noun is the riven class. */
const RIVEN_TYPES: Record<string, RivenType> = {
  'Rifle Riven Mod': 'Rifle',
  'Shotgun Riven Mod': 'Shotgun',
  'Pistol Riven Mod': 'Pistol',
  'Melee Riven Mod': 'Melee',
  'Archgun Riven Mod': 'Archgun',
  'Kitgun Riven Mod': 'Kitgun',
  'Zaw Riven Mod': 'Zaw',
}

/**
 * The riven class a weapon's own type implies, for weapons that have a disposition but no
 * observed trades that week. WFCD's `type` is the weapon class, not the riven class, and the
 * two differ in naming for exactly two entries.
 */
const WEAPON_TYPE_TO_RIVEN: Record<string, RivenType> = {
  Rifle: 'Rifle',
  Shotgun: 'Shotgun',
  Pistol: 'Pistol',
  Melee: 'Melee',
  'Arch-Gun': 'Archgun',
  'Kitgun Component': 'Kitgun',
  'Zaw Component': 'Zaw',
}

/**
 * QUIRK — the trade file lists generic veiled rivens ("Veiled Rifle Riven Mod") beside real
 * weapons. They are an unidentified riven of that class, not a weapon, so they have no
 * disposition and would otherwise mint a weapon page for something that does not exist.
 */
function isVeiledPlaceholder(name: string): boolean {
  return /^Veiled\b/.test(name)
}

function toPrice(stat: RawRivenStat): { median: number; avg: number; min: number; max: number; stddev: number; pop: number } {
  return {
    median: Math.max(0, stat.median),
    avg: Math.max(0, stat.avg),
    min: Math.max(0, stat.min),
    max: Math.max(0, stat.max),
    stddev: Math.max(0, stat.stddev),
    pop: Math.max(0, Math.round(stat.pop)),
  }
}

export interface RivenBuild {
  weapons: RivenWeapon[]
  /** Priced names that matched no weapon with a disposition. Real ones exist — Zaw strikes
   *  are not published with dispositions — so this is reported and budgeted, not thrown. */
  unmatched: string[]
  /** Veiled placeholders dropped, counted so a change in their number is visible. */
  veiled: number
}

/**
 * Build the riven table.
 *
 * A weapon is included when it has a disposition OR an observed trade. Those are two
 * different kinds of useful: disposition without price is a weapon nobody traded this week,
 * and price without disposition is a modular part whose dots upstream does not publish.
 * Dropping either would silently narrow the answer to "what can I look up".
 */
export function buildRivens(
  weaponFiles: ReadonlyArray<{ rows: RawWfcdItem[] }>,
  prices: RawRivenFile,
  items: Item[],
): RivenBuild {
  const itemIds = new Set(items.map((item) => item.id))

  // Disposition side. Only entries that actually carry the multiplier are weapons for this
  // purpose — the same files hold mods, skins and blueprints, none of which take a riven.
  const byName = new Map<string, { name: string; type: RivenType | undefined; stars?: number; omega: number }>()
  for (const { rows } of weaponFiles) {
    for (const row of rows) {
      const omega = row.omegaAttenuation
      if (omega === undefined) continue
      const key = row.name.toLowerCase()
      if (byName.has(key)) continue
      byName.set(key, {
        name: row.name,
        type: row.type === undefined ? undefined : WEAPON_TYPE_TO_RIVEN[row.type],
        ...(row.disposition === undefined ? {} : { stars: row.disposition }),
        omega,
      })
    }
  }

  const priced = new Map<string, { type: RivenType; unrolled?: RawRivenStat; rerolled?: RawRivenStat }>()
  const unmatched: string[] = []
  let veiled = 0

  for (const [rawType, entries] of Object.entries(prices)) {
    const rivenType = RIVEN_TYPES[rawType]
    if (rivenType === undefined) continue
    for (const [name, rolls] of Object.entries(entries)) {
      if (isVeiledPlaceholder(name)) {
        veiled++
        continue
      }
      priced.set(name.toLowerCase(), {
        type: rivenType,
        ...(rolls.unrolled === undefined ? {} : { unrolled: rolls.unrolled }),
        ...(rolls.rerolled === undefined ? {} : { rerolled: rolls.rerolled }),
      })
    }
  }

  const weapons: RivenWeapon[] = []
  const seen = new Set<string>()

  const push = (name: string, type: RivenType, extra: Partial<RivenWeapon>): void => {
    const id = slug(name)
    if (id === '' || seen.has(id)) return
    seen.add(id)
    weapons.push({
      id,
      name,
      rivenType: type,
      // Link to the catalogue only where the drop data actually knows this weapon. Most
      // non-Prime weapons are bought, never dropped, so they have no page to link to.
      ...(itemIds.has(id) ? { itemId: id } : {}),
      ...extra,
    })
  }

  for (const [key, weapon] of byName) {
    const price = priced.get(key)
    const type = price?.type ?? weapon.type
    if (type === undefined) continue
    push(weapon.name, type, {
      ...(weapon.stars === undefined ? {} : { dispositionStars: weapon.stars }),
      disposition: Number(weapon.omega.toFixed(2)),
      ...(price?.unrolled === undefined ? {} : { unrolled: toPrice(price.unrolled) }),
      ...(price?.rerolled === undefined ? {} : { rerolled: toPrice(price.rerolled) }),
    })
  }

  // Priced weapons with no disposition entry — kept, because a price is still an answer.
  for (const [key, price] of priced) {
    if (byName.has(key)) continue
    const display = price.unrolled?.compatibility ?? price.rerolled?.compatibility
    if (display === null || display === undefined) continue
    unmatched.push(display)
    push(display, price.type, {
      ...(price.unrolled === undefined ? {} : { unrolled: toPrice(price.unrolled) }),
      ...(price.rerolled === undefined ? {} : { rerolled: toPrice(price.rerolled) }),
    })
  }

  weapons.sort((a, b) => a.name.localeCompare(b.name))
  return { weapons, unmatched, veiled }
}
