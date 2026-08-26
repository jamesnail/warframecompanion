import { describe, expect, it } from 'vitest'

import type { Item } from '@provenance/core'

import { buildRivens, familyMatcher, type RawRivenFile } from './rivens'
import type { RawWfcdItem } from './enrich'

const weapons: RawWfcdItem[] = [
  { name: 'Cernos', type: 'Bow', disposition: 4, omegaAttenuation: 1.3 },
  { name: 'Cernos Prime', type: 'Bow', disposition: 4, omegaAttenuation: 1.25 },
  { name: 'Rakta Cernos', type: 'Bow', disposition: 4, omegaAttenuation: 1.25 },
  { name: 'Mutalist Cernos', type: 'Rifle', disposition: 5, omegaAttenuation: 1.35 },
  { name: 'Mk1-Braton', type: 'Rifle', disposition: 5, omegaAttenuation: 1.35 },
  { name: 'Braton', type: 'Rifle', disposition: 5, omegaAttenuation: 1.35 },
  // Classes that take no riven at all.
  { name: 'Mote Amp', type: 'Amp', omegaAttenuation: 1.0 },
  { name: 'Exalted Blade', type: 'Exalted Weapon', omegaAttenuation: 1.0 },
  // Not a weapon: no omegaAttenuation.
  { name: 'Serration', type: 'Mod' },
  // Upstream mis-casing must be fixed on the way in.
  { name: 'Lavan Apoc Mk Ii', type: 'Arch-Gun', disposition: 3, omegaAttenuation: 1.0 },
]

const stat = (over: Record<string, unknown>) => ({
  itemType: 'Rifle Riven Mod',
  compatibility: 'Cernos',
  rerolled: false,
  avg: 120,
  stddev: 40,
  min: 20,
  max: 400,
  pop: 12,
  median: 90,
  ...over,
})

const prices: RawRivenFile = {
  'Rifle Riven Mod': {
    Cernos: { unrolled: stat({}), rerolled: stat({ rerolled: true, median: 250, pop: 5 }) },
    'Mutalist Cernos': { unrolled: stat({ compatibility: 'Mutalist Cernos', median: 40 }) },
    Braton: { unrolled: stat({ compatibility: 'Braton', median: 15 }) },
    'Veiled Rifle Riven Mod': { unrolled: stat({ compatibility: 'Veiled Rifle Riven Mod' }) },
  },
  'Zaw Riven Mod': {
    // Traded, but upstream names no weapon this way.
    Akaten: { unrolled: stat({ itemType: 'Zaw Riven Mod', compatibility: 'Akaten', median: 40 }) },
  },
}

const items: Item[] = [{ id: 'cernos-prime', name: 'Cernos Prime', category: 'Primary', tradable: false }]

const built = buildRivens([{ rows: weapons }], prices, items)
const family = (name: string) => built.families.find((f) => f.name === name)

describe('familyMatcher', () => {
  const match = familyMatcher(['Cernos', 'Mutalist Cernos', 'Braton'])

  it('folds variants into the family whose riven they share', () => {
    expect(match('Cernos Prime')).toBe('Cernos')
    expect(match('Rakta Cernos')).toBe('Cernos')
  })

  // The rule the whole grouping turns on.
  it('prefers the LONGEST family, so a separately traded variant stays its own', () => {
    expect(match('Mutalist Cernos')).toBe('Mutalist Cernos')
  })

  it('treats a hyphen as a word boundary', () => {
    expect(match('Mk1-Braton')).toBe('Braton')
  })

  it('does not match a family name inside a longer word', () => {
    expect(match('Cernosaurus')).toBeUndefined()
  })

  it('returns nothing when no family fits', () => {
    expect(match('Soma')).toBeUndefined()
  })
})

describe('buildRivens', () => {
  it('groups Cernos, Cernos Prime and Rakta Cernos under one riven', () => {
    expect(family('Cernos')?.weapons.map((w) => w.name)).toEqual([
      'Cernos',
      'Cernos Prime',
      'Rakta Cernos',
    ])
  })

  it('keeps the family head first', () => {
    expect(family('Cernos')?.weapons[0]?.name).toBe('Cernos')
  })

  it('keeps Mutalist Cernos separate, because its riven is traded separately', () => {
    expect(family('Mutalist Cernos')?.weapons.map((w) => w.name)).toEqual(['Mutalist Cernos'])
  })

  // Disposition is per weapon even though the mod is per family.
  it('keeps each variant its own disposition', () => {
    const members = family('Cernos')?.weapons ?? []
    expect(members.map((w) => w.disposition)).toEqual([1.3, 1.25, 1.25])
  })

  it('puts the price on the family, not on each weapon', () => {
    const cernos = family('Cernos')
    expect(cernos?.unrolled?.median).toBe(90)
    expect(cernos?.rerolled?.median).toBe(250)
    expect(cernos?.weapons[1]).not.toHaveProperty('unrolled')
  })

  it('takes the riven class from the trade file, so a Bow correctly reads Rifle', () => {
    expect(family('Cernos')?.rivenType).toBe('Rifle')
  })

  it('excludes classes that cannot take a riven', () => {
    expect(family('Mote Amp')).toBeUndefined()
    expect(family('Exalted Blade')).toBeUndefined()
    expect(built.excluded).toBe(2)
  })

  it('ignores entries with no disposition multiplier at all', () => {
    expect(built.families.some((f) => f.name === 'Serration')).toBe(false)
  })

  it('drops veiled placeholders and counts them', () => {
    expect(built.families.some((f) => /^Veiled/.test(f.name))).toBe(false)
    expect(built.veiled).toBe(1)
  })

  // One week of trades must not delete a weapon from the site.
  it('still ships a traded family whose weapons upstream names differently', () => {
    expect(family('Akaten')?.unrolled?.median).toBe(40)
    expect(built.unmatched).toContain('Akaten')
  })

  it('normalises upstream roman-numeral casing', () => {
    expect(built.families.some((f) => f.name === 'Lavan Apoc Mk II')).toBe(true)
    expect(built.families.some((f) => f.name === 'Lavan Apoc Mk Ii')).toBe(false)
  })

  it('links a variant to the catalogue only where the drop data knows it', () => {
    const members = family('Cernos')?.weapons ?? []
    expect(members.find((w) => w.name === 'Cernos Prime')?.itemId).toBe('cernos-prime')
    expect(members.find((w) => w.name === 'Cernos')?.itemId).toBeUndefined()
  })

  it('returns a stable, name-sorted order so rebuilds hash identically', () => {
    const names = built.families.map((f) => f.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('never emits an empty family', () => {
    expect(built.families.every((f) => f.weapons.length > 0)).toBe(true)
  })
})
