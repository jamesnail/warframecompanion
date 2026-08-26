import { z } from 'zod'

import type { Item, RivenFamily, RivenType, RivenVariant } from '@provenance/core'

import { normalizeDisplayName } from './names'
import { slug } from './slug'
import type { RawWfcdItem } from './enrich'

/**
 * Riven families, their dispositions and the weekly market floor.
 *
 * Two upstream facts, joined:
 *
 *  - Disposition comes from `@wfcd/items`, which carries both the 1-5 dots the game draws
 *    (`disposition`) and the real multiplier it applies (`omegaAttenuation`, 0.5-1.55).
 *  - Price comes from Digital Extremes' own weekly riven trade statistics, mirrored by
 *    WFCD's status API.
 *
 * Both are fetched at BUILD time and committed as static JSON, so nothing about rivens
 * reaches the browser over the network at runtime (CLAUDE.md constraints 2 and 3).
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
 * Weapon classes that cannot take a riven at all.
 *
 * An allowlist would have been the obvious shape and is the wrong one: WFCD gives an
 * `omegaAttenuation` to plenty of things that take no riven, and reading it as "this is a
 * riven weapon" put Operator Amps and K-Drive parts in the table. An explicit denylist of
 * the four classes that genuinely cannot is smaller and fails safe — a weapon class added
 * upstream shows up rather than silently vanishing.
 */
const NOT_RIVENABLE = new Set(['Amp', 'K-Drive Component', 'Conservation Prey', 'Exalted Weapon'])

/** QUIRK — the trade file lists generic veiled rivens beside real weapons. They are an
 *  unidentified riven of that class, not a weapon. */
function isVeiledPlaceholder(name: string): boolean {
  return /^Veiled\b/.test(name)
}

function toPrice(stat: RawRivenStat): {
  median: number
  avg: number
  min: number
  max: number
  stddev: number
  pop: number
} {
  return {
    median: Math.max(0, stat.median),
    avg: Math.max(0, stat.avg),
    min: Math.max(0, stat.min),
    max: Math.max(0, stat.max),
    stddev: Math.max(0, stat.stddev),
    pop: Math.max(0, Math.round(stat.pop)),
  }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Which family a weapon's riven belongs to.
 *
 * The candidate families are the names the trade file actually lists, because those ARE the
 * riven mods that exist. A weapon joins the family whose name appears in its own as a whole
 * word — "Cernos Prime" and "Rakta Cernos" both join "Cernos" — and the LONGEST match wins,
 * which is what keeps "Mutalist Cernos" a family of its own rather than folding it into
 * Cernos. Hyphens count as boundaries so "Mk1-Braton" joins Braton.
 *
 * Longest-first is load-bearing, not an optimisation: matching "Cernos" before checking
 * "Mutalist Cernos" would silently merge two separately traded rivens.
 */
export function familyMatcher(familyNames: string[]): (weaponName: string) => string | undefined {
  const ordered = [...familyNames].sort((a, b) => b.length - a.length || a.localeCompare(b))
  const patterns = ordered.map((name) => ({
    name,
    exact: name.toLowerCase(),
    boundary: new RegExp(`(^|[\\s-])${escapeRegExp(name.toLowerCase())}($|[\\s-])`),
  }))

  return (weaponName: string): string | undefined => {
    const lower = weaponName.toLowerCase()
    for (const pattern of patterns) {
      if (lower === pattern.exact || pattern.boundary.test(lower)) return pattern.name
    }
    return undefined
  }
}

export interface RivenBuild {
  families: RivenFamily[]
  /** Traded names that matched no weapon carrying a disposition. Real ones exist — Zaw
   *  strikes and companion weapons are named differently upstream — so they still ship as
   *  single-weapon families rather than being dropped. */
  unmatched: string[]
  /** Weapons excluded because their class takes no riven, counted so a change is visible. */
  excluded: number
  veiled: number
}

/**
 * Build the riven table, grouped into families.
 *
 * A weapon that matches no traded family still gets a family of its own: the trade file is
 * one week of data, so a riven nobody happened to trade must not delete the weapon from the
 * site. It simply has no price.
 */
export function buildRivens(
  weaponFiles: ReadonlyArray<{ rows: RawWfcdItem[] }>,
  prices: RawRivenFile,
  items: Item[],
): RivenBuild {
  const itemIds = new Set(items.map((item) => item.id))

  // ---- price side: the families that demonstrably exist -------------------
  const priced = new Map<
    string,
    { type: RivenType; unrolled?: RawRivenStat; rerolled?: RawRivenStat }
  >()
  let veiled = 0

  for (const [rawType, entries] of Object.entries(prices)) {
    const rivenType = RIVEN_TYPES[rawType]
    if (rivenType === undefined) continue
    for (const [name, rolls] of Object.entries(entries)) {
      if (isVeiledPlaceholder(name)) {
        veiled++
        continue
      }
      priced.set(normalizeDisplayName(name), {
        type: rivenType,
        ...(rolls.unrolled === undefined ? {} : { unrolled: rolls.unrolled }),
        ...(rolls.rerolled === undefined ? {} : { rerolled: rolls.rerolled }),
      })
    }
  }

  const matchFamily = familyMatcher([...priced.keys()])

  // ---- disposition side ---------------------------------------------------
  interface Weapon {
    name: string
    type: string | undefined
    stars?: number
    omega: number
  }
  const weapons = new Map<string, Weapon>()
  let excluded = 0

  for (const { rows } of weaponFiles) {
    for (const row of rows) {
      const omega = row.omegaAttenuation
      if (omega === undefined) continue
      if (row.type !== undefined && NOT_RIVENABLE.has(row.type)) {
        excluded++
        continue
      }
      const name = normalizeDisplayName(row.name)
      const key = name.toLowerCase()
      if (weapons.has(key)) continue
      weapons.set(key, {
        name,
        type: row.type,
        ...(row.disposition === undefined ? {} : { stars: row.disposition }),
        omega,
      })
    }
  }

  // ---- group --------------------------------------------------------------
  const grouped = new Map<string, { type: RivenType | undefined; members: RivenVariant[] }>()
  const unmatched: string[] = []

  const variantOf = (weapon: Weapon): RivenVariant => {
    const id = slug(weapon.name)
    return {
      id,
      name: weapon.name,
      ...(weapon.stars === undefined ? {} : { dispositionStars: weapon.stars }),
      disposition: Number(weapon.omega.toFixed(2)),
      // Linked only where the drop data knows this weapon; most are bought, never dropped.
      ...(itemIds.has(id) ? { itemId: id } : {}),
    }
  }

  for (const weapon of weapons.values()) {
    const familyName = matchFamily(weapon.name) ?? weapon.name
    const entry = grouped.get(familyName) ?? { type: priced.get(familyName)?.type, members: [] }
    entry.members.push(variantOf(weapon))
    grouped.set(familyName, entry)
  }

  // A traded family whose weapons upstream names differently still ships, priced, alone.
  for (const [familyName, price] of priced) {
    if (grouped.has(familyName)) continue
    unmatched.push(familyName)
    grouped.set(familyName, {
      type: price.type,
      members: [{ id: slug(familyName), name: familyName }],
    })
  }

  const families: RivenFamily[] = []
  for (const [familyName, entry] of grouped) {
    const price = priced.get(familyName)
    // Fall back to the family head's own weapon class only when the trade file is silent.
    const rivenType = entry.type ?? rivenTypeFromWeapon(weapons.get(familyName.toLowerCase())?.type)
    if (rivenType === undefined) continue

    // Head first, then alphabetical: the family is named after one of its members and that
    // is the one whose riven is traded.
    const members = [...entry.members].sort((a, b) => {
      if (a.name === familyName) return -1
      if (b.name === familyName) return 1
      return a.name.localeCompare(b.name)
    })

    families.push({
      id: slug(familyName),
      name: familyName,
      rivenType,
      ...(price?.unrolled === undefined ? {} : { unrolled: toPrice(price.unrolled) }),
      ...(price?.rerolled === undefined ? {} : { rerolled: toPrice(price.rerolled) }),
      weapons: members,
    })
  }

  families.sort((a, b) => a.name.localeCompare(b.name))
  return { families, unmatched, excluded, veiled }
}

/** Last resort for an untraded family: WFCD's weapon class, mapped to a riven class. Bows,
 *  snipers and launchers all take Rifle rivens, which is why this is not one-to-one. */
function rivenTypeFromWeapon(type: string | undefined): RivenType | undefined {
  switch (type) {
    case 'Rifle':
    case 'Bow':
    case 'Sniper':
    case 'Launcher':
      return 'Rifle'
    case 'Shotgun':
      return 'Shotgun'
    case 'Pistol':
    case 'Dual Pistols':
    case 'Throwing':
      return 'Pistol'
    case 'Melee':
      return 'Melee'
    case 'Arch-Gun':
    case 'Arch-Melee':
      return 'Archgun'
    case 'Kitgun Component':
      return 'Kitgun'
    case 'Zaw Component':
      return 'Zaw'
    default:
      return undefined
  }
}
