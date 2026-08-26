import { describe, expect, it } from 'vitest'

import type { Item } from '@provenance/core'

import { buildRivens, type RawRivenFile } from './rivens'
import type { RawWfcdItem } from './enrich'

const weapons: RawWfcdItem[] = [
  { name: 'Braton Prime', type: 'Rifle', disposition: 3, omegaAttenuation: 1.0 },
  { name: 'Acceltra', type: 'Rifle', disposition: 1, omegaAttenuation: 0.65 },
  { name: 'Hek', type: 'Shotgun', disposition: 5, omegaAttenuation: 1.55 },
  { name: 'Catchmoon', type: 'Kitgun Component', disposition: 1, omegaAttenuation: 0.75 },
  // Present in the same files but not a weapon: no omegaAttenuation, so no riven.
  { name: 'Serration', type: 'Mod' },
]

const stat = (over: Record<string, unknown>) => ({
  itemType: 'Rifle Riven Mod',
  compatibility: 'Braton Prime',
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
    'Braton Prime': {
      unrolled: stat({}),
      rerolled: stat({ rerolled: true, median: 250, avg: 300, pop: 5 }),
    },
    // The generic unidentified riven for the class — not a weapon.
    'Veiled Rifle Riven Mod': { unrolled: stat({ compatibility: 'Veiled Rifle Riven Mod' }) },
  },
  'Zaw Riven Mod': {
    // Priced, but upstream publishes no disposition for zaw strikes.
    Akaten: { unrolled: stat({ itemType: 'Zaw Riven Mod', compatibility: 'Akaten', median: 40 }) },
  },
  // A category we do not recognise must not fail the build.
  'Fishing Spear Riven Mod': { Lanzo: { unrolled: stat({ compatibility: 'Lanzo' }) } },
}

const items: Item[] = [
  { id: 'braton-prime', name: 'Braton Prime', category: 'Primary', tradable: false },
]

const built = buildRivens([{ rows: weapons }], prices, items)

describe('buildRivens', () => {
  it('includes only entries that carry a disposition multiplier', () => {
    expect(built.weapons.some((w) => w.name === 'Serration')).toBe(false)
    expect(built.weapons.some((w) => w.name === 'Braton Prime')).toBe(true)
  })

  it('keeps both the dots and the real multiplier', () => {
    const hek = built.weapons.find((w) => w.name === 'Hek')
    expect(hek?.dispositionStars).toBe(5)
    expect(hek?.disposition).toBe(1.55)
  })

  it('rounds the multiplier to the two decimals the game uses', () => {
    const rounded = buildRivens(
      [{ rows: [{ name: 'Acceltra', type: 'Rifle', omegaAttenuation: 0.64999998 }] }],
      {},
      [],
    )
    expect(rounded.weapons[0]?.disposition).toBe(0.65)
  })

  it('attaches unrolled and rerolled prices separately', () => {
    const braton = built.weapons.find((w) => w.name === 'Braton Prime')
    expect(braton?.unrolled?.median).toBe(90)
    expect(braton?.unrolled?.pop).toBe(12)
    expect(braton?.rerolled?.median).toBe(250)
  })

  it('keeps a weapon that has a disposition but no trades that week', () => {
    const hek = built.weapons.find((w) => w.name === 'Hek')
    expect(hek).toBeDefined()
    expect(hek?.unrolled).toBeUndefined()
    expect(hek?.rerolled).toBeUndefined()
  })

  // A veiled riven is an unidentified one of that class, not a weapon; minting a page for it
  // would invent a weapon that does not exist.
  it('drops veiled placeholders and counts them', () => {
    expect(built.weapons.some((w) => /^Veiled/.test(w.name))).toBe(false)
    expect(built.veiled).toBe(1)
  })

  it('keeps a priced weapon whose disposition upstream does not publish', () => {
    const akaten = built.weapons.find((w) => w.name === 'Akaten')
    expect(akaten?.rivenType).toBe('Zaw')
    expect(akaten?.unrolled?.median).toBe(40)
    expect(akaten?.disposition).toBeUndefined()
    expect(built.unmatched).toContain('Akaten')
  })

  it('ignores a riven category it does not recognise rather than failing', () => {
    expect(built.weapons.some((w) => w.name === 'Lanzo')).toBe(false)
  })

  it('maps a kitgun component onto the Kitgun riven class', () => {
    expect(built.weapons.find((w) => w.name === 'Catchmoon')?.rivenType).toBe('Kitgun')
  })

  it('links to the catalogue only where the drop data knows the weapon', () => {
    expect(built.weapons.find((w) => w.name === 'Braton Prime')?.itemId).toBe('braton-prime')
    // Bought from the market, never dropped, so there is no page to link to.
    expect(built.weapons.find((w) => w.name === 'Hek')?.itemId).toBeUndefined()
  })

  it('returns a stable, name-sorted order so rebuilds hash identically', () => {
    const names = built.weapons.map((w) => w.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('does not emit the same weapon twice', () => {
    const ids = built.weapons.map((w) => w.id)
    expect(ids.length).toBe(new Set(ids).size)
  })
})
