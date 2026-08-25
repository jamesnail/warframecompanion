import { describe, expect, it } from 'vitest'

import type { Item } from '@provenance/core'

import { buildEnrichmentIndex, enrichItems, lookupEnrichment, nameVariants } from './enrich'
import type { RawWfcdItem } from './enrich'

/**
 * The join between the drop tables (names and odds only) and WFCD's item metadata. Every
 * rule here exists because an exact name match misses something real, and each one is
 * pinned in both directions — what it must catch, and what it must not swallow.
 */

const bratonPrime: RawWfcdItem = {
  name: 'Braton Prime',
  uniqueName: '/Lotus/Weapons/Tenno/Rifle/BratonPrime',
  masteryReq: 8,
  tradable: false,
  imageName: 'BratonPrime.png',
  components: [
    {
      name: 'Barrel',
      uniqueName: '/Lotus/Types/Recipes/Weapons/WeaponParts/BratonPrimeBarrel',
      itemCount: 1,
      tradable: true,
      imageName: 'GenericGunPrimeBarrel.png',
    },
    {
      name: 'Blueprint',
      uniqueName: '/Lotus/Types/Recipes/Weapons/BratonPrimeBlueprint',
      itemCount: 1,
      tradable: true,
    },
    // A shared build ingredient, not a part of this weapon. It lives in the same array.
    {
      name: 'Orokin Cell',
      uniqueName: '/Lotus/Types/Items/MiscItems/OrokinCell',
      itemCount: 10,
      tradable: false,
    },
  ],
}

const index = buildEnrichmentIndex([
  { file: 'Primary', category: 'Primary', rows: [bratonPrime] },
  {
    file: 'Mods',
    category: 'Mod',
    rows: [{ name: 'Abating Link', uniqueName: '/Lotus/Powersuits/Trinity/LinkAugmentCard' }],
  },
  {
    file: 'Misc',
    category: 'Other',
    rows: [
      { name: '<Shard_blue_simple> Azure Archon Shard' },
      { name: 'Ferrite', type: 'Resource' },
    ],
  },
])

describe('buildEnrichmentIndex', () => {
  it('indexes a part under its composite name, which is what the drop tables use', () => {
    // Upstream says "Braton Prime Barrel"; WFCD nests a component called just "Barrel".
    expect(index.get('braton-prime-barrel')?.category).toBe('Component')
    expect(index.get('braton-prime-blueprint')?.category).toBe('Blueprint')
  })

  it('does NOT prefix shared build ingredients onto their parent', () => {
    // "Braton Prime Orokin Cell" is not a thing. Orokin Cell is its own item.
    expect(index.has('braton-prime-orokin-cell')).toBe(false)
  })

  it('carries a part its own tradable flag rather than the parent weapon flag', () => {
    // The weapon is untradable; its parts are tradable. Taking the parent's value would
    // mark every prime part in the game untradable.
    expect(index.get('braton-prime')?.tradable).toBe(false)
    expect(index.get('braton-prime-barrel')?.tradable).toBe(true)
  })

  it('keeps mastery and components on the parent', () => {
    const parent = index.get('braton-prime')
    expect(parent?.masteryReq).toBe(8)
    expect(parent?.components).toEqual([
      { itemId: 'braton-prime-barrel', count: 1 },
      { itemId: 'braton-prime-blueprint', count: 1 },
    ])
  })

  it('indexes a sprite-prefixed name under its bare form too', () => {
    // WFCD writes "<Shard_blue_simple> Azure Archon Shard"; drop tables use the bare name.
    expect(index.has('azure-archon-shard')).toBe(true)
  })

  it('lets an entry type override the file it lives in', () => {
    // Misc holds genuine resources next to conservation tags and captura scenes.
    expect(index.get('ferrite')?.category).toBe('Resource')
  })
})

describe('nameVariants', () => {
  it('strips a trailing parenthetical, for augment mods', () => {
    expect(nameVariants('Abating Link (Trinity)')).toContain('Abating Link')
  })

  it('strips a trailing Blueprint, for part rewards', () => {
    expect(nameVariants('Aeolak Barrel Blueprint')).toContain('Aeolak Barrel')
  })

  it('always tries the unmodified name first', () => {
    expect(nameVariants('Forma Blueprint')[0]).toBe('Forma Blueprint')
  })

  it('leaves an ordinary name with a single variant', () => {
    expect(nameVariants('Orokin Cell')).toEqual(['Orokin Cell'])
  })
})

describe('lookupEnrichment', () => {
  it('finds an augment mod through the parenthetical rule', () => {
    expect(lookupEnrichment('Abating Link (Trinity)', index)?.category).toBe('Mod')
  })

  it('prefers an exact match over a stripped one', () => {
    // "Braton Prime Blueprint" is its own indexed part. It must not fall through to
    // "Braton Prime" and inherit the whole weapon's category and mastery rank.
    const hit = lookupEnrichment('Braton Prime Blueprint', index)
    expect(hit?.category).toBe('Blueprint')
    expect(hit?.masteryReq).toBeUndefined()
  })

  it('returns undefined rather than guessing', () => {
    expect(lookupEnrichment('1,500 Credits Cache', index)).toBeUndefined()
  })
})

describe('enrichItems', () => {
  const items: Item[] = [
    { id: 'braton-prime-barrel', name: 'Braton Prime Barrel', category: 'Other', tradable: false },
    { id: 'lith-a1-relic', name: 'Lith A1 Relic', category: 'Relic', tradable: false },
    { id: 'credits', name: '1,500 Credits Cache', category: 'Other', tradable: false },
  ]

  it('replaces a guessed category with a known one', () => {
    const { items: out } = enrichItems(items, index)
    expect(out.find((i) => i.id === 'braton-prime-barrel')?.category).toBe('Component')
  })

  it('leaves relics alone — their data is derived from the drop tables', () => {
    const { items: out } = enrichItems(items, index)
    expect(out.find((i) => i.id === 'lith-a1-relic')?.category).toBe('Relic')
  })

  it('excludes relics from the match accounting', () => {
    const { matched, unmatched } = enrichItems(items, index)
    expect(matched).toBe(1)
    expect(unmatched).toEqual(['1,500 Credits Cache'])
  })

  it('leaves an unmatched item exactly as it was', () => {
    const { items: out } = enrichItems(items, index)
    expect(out.find((i) => i.name === '1,500 Credits Cache')).toEqual(items[2])
  })
})
