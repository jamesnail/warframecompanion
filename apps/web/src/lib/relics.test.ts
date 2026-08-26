import { describe, expect, it } from 'vitest'

import type { RelicDetail } from '@provenance/core'

import {
  EMPTY_RELIC_FILTERS,
  buildRelicRows,
  countFarmable,
  filterRelics,
  matchedRewards,
  relicTiers,
  sortRelics,
} from './relics'

const NAMES: Record<string, string> = {
  'lith-a12-relic': 'Lith A12 Relic',
  'axi-b3-relic': 'Axi B3 Relic',
  'meso-c1-relic': 'Meso C1 Relic',
  'alternox-prime-blueprint': 'Alternox Prime Blueprint',
  'burston-prime-receiver': 'Burston Prime Receiver',
  'forma-blueprint': 'Forma Blueprint',
  'braton-prime-barrel': 'Braton Prime Barrel',
  'saryn-prime-chassis-blueprint': 'Saryn Prime Chassis Blueprint',
}
const nameOf = (id: string): string => NAMES[id] ?? id

const relic = (
  id: string,
  tier: RelicDetail['tier'],
  vaulted: boolean,
  rare: string,
  rest: string[],
): RelicDetail => ({
  id,
  tier,
  vaulted,
  rewards: [
    { itemId: rare, rarity: 'rare' },
    ...rest.map((itemId, i) => ({ itemId, rarity: i === 0 ? ('uncommon' as const) : ('common' as const) })),
  ],
})

const relics: RelicDetail[] = [
  relic('lith-a12-relic', 'Lith', false, 'alternox-prime-blueprint', ['burston-prime-receiver', 'forma-blueprint']),
  relic('axi-b3-relic', 'Axi', true, 'braton-prime-barrel', ['forma-blueprint']),
  relic('meso-c1-relic', 'Meso', true, 'saryn-prime-chassis-blueprint', ['forma-blueprint']),
]

const rows = buildRelicRows(relics, nameOf)

describe('buildRelicRows', () => {
  it('resolves the relic and its rewards to display names', () => {
    expect(rows[0]?.name).toBe('Lith A12 Relic')
    expect(rows[0]?.rewards.map((r) => r.name)).toContain('Burston Prime Receiver')
  })

  it('picks out the single rare, which is the reason to run it', () => {
    expect(rows[0]?.rare?.name).toBe('Alternox Prime Blueprint')
    expect(rows[0]?.rare?.rarity).toBe('rare')
  })

  it('builds a haystack covering the contents, not just the relic name', () => {
    expect(rows[0]?.haystack).toContain('burston prime receiver')
    expect(rows[0]?.haystack).toContain('lith a12 relic')
  })

  it('falls back to the id when a name is unknown', () => {
    const orphan = buildRelicRows([relic('neo-z9-relic', 'Neo', false, 'mystery-part', [])], nameOf)
    expect(orphan[0]?.rare?.name).toBe('mystery-part')
  })
})

describe('filterRelics', () => {
  it('returns everything by default', () => {
    expect(filterRelics(rows, EMPTY_RELIC_FILTERS)).toHaveLength(3)
  })

  // The point of the surface: you search for the PART, not the relic.
  it('finds a relic by something inside it', () => {
    const found = filterRelics(rows, { ...EMPTY_RELIC_FILTERS, q: 'burston' })
    expect(found.map((r) => r.id)).toEqual(['lith-a12-relic'])
  })

  it('finds a relic by its own name too', () => {
    expect(filterRelics(rows, { ...EMPTY_RELIC_FILTERS, q: 'axi b3' })).toHaveLength(1)
  })

  it('requires every term to land on the SAME field', () => {
    // Both terms are inside one reward name.
    expect(filterRelics(rows, { ...EMPTY_RELIC_FILTERS, q: 'burston receiver' })).toHaveLength(1)
    expect(filterRelics(rows, { ...EMPTY_RELIC_FILTERS, q: 'burston braton' })).toHaveLength(0)
  })

  /**
   * The bug an end-to-end cross-check caught: pooling all six reward names into one haystack
   * made "braton prime barrel" match a relic holding Braton Prime RECEIVER and a different
   * prime BARREL. 79 relics where the item page said 39.
   */
  it('does not match terms across two different rewards', () => {
    const decoy = buildRelicRows(
      [relic('neo-x1-relic', 'Neo', false, 'burston-prime-receiver', ['braton-prime-barrel'])],
      nameOf,
    )
    // "burston barrel" is satisfied only by pooling the two rewards, so it must NOT match.
    expect(filterRelics(decoy, { ...EMPTY_RELIC_FILTERS, q: 'burston barrel' })).toHaveLength(0)
    // Each on its own still finds it.
    expect(filterRelics(decoy, { ...EMPTY_RELIC_FILTERS, q: 'burston' })).toHaveLength(1)
    expect(filterRelics(decoy, { ...EMPTY_RELIC_FILTERS, q: 'barrel' })).toHaveLength(1)
  })

  it('trades away compound queries on purpose; the tier chip covers that', () => {
    expect(filterRelics(rows, { ...EMPTY_RELIC_FILTERS, q: 'lith forma' })).toHaveLength(0)
    expect(
      filterRelics(rows, { ...EMPTY_RELIC_FILTERS, q: 'forma', tiers: ['Lith'] }),
    ).toHaveLength(1)
  })

  it('filters by tier', () => {
    expect(filterRelics(rows, { ...EMPTY_RELIC_FILTERS, tiers: ['Lith'] })).toHaveLength(1)
    expect(filterRelics(rows, { ...EMPTY_RELIC_FILTERS, tiers: ['Lith', 'Axi'] })).toHaveLength(2)
  })

  it('hides vaulted relics when asked', () => {
    const out = filterRelics(rows, { ...EMPTY_RELIC_FILTERS, farmableOnly: true })
    expect(out.map((r) => r.id)).toEqual(['lith-a12-relic'])
  })

  it('combines filters as AND', () => {
    expect(
      filterRelics(rows, { ...EMPTY_RELIC_FILTERS, farmableOnly: true, tiers: ['Axi'] }),
    ).toHaveLength(0)
  })
})

describe('matchedRewards', () => {
  // Searching "forma" returns hundreds of relics; without this the reader cannot tell which
  // of the six slots matched and has to open every one.
  it('names the rewards a query actually hit', () => {
    expect(matchedRewards(rows[0] as never, 'forma').map((r) => r.name)).toEqual(['Forma Blueprint'])
  })

  it('returns nothing for an empty query', () => {
    expect(matchedRewards(rows[0] as never, '')).toEqual([])
  })

  it('matches several slots when the query is broad', () => {
    expect(matchedRewards(rows[0] as never, 'prime').map((r) => r.name)).toEqual([
      'Alternox Prime Blueprint',
      'Burston Prime Receiver',
    ])
  })
})

describe('sortRelics', () => {
  it('sorts by name in both directions', () => {
    expect(sortRelics(rows, 'name', 'asc')[0]?.name).toBe('Axi B3 Relic')
    expect(sortRelics(rows, 'name', 'desc')[0]?.name).toBe('Meso C1 Relic')
  })

  it('sorts tiers in game order, not alphabetically', () => {
    expect(sortRelics(rows, 'tier', 'asc').map((r) => r.tier)).toEqual(['Lith', 'Meso', 'Axi'])
  })

  it('sorts by the rare reward name', () => {
    expect(sortRelics(rows, 'rare', 'asc')[0]?.rare?.name).toBe('Alternox Prime Blueprint')
  })

  it('does not mutate its input', () => {
    const before = rows.map((r) => r.id)
    sortRelics(rows, 'tier', 'desc')
    expect(rows.map((r) => r.id)).toEqual(before)
  })

  it('is a total order, so the list does not reshuffle between renders', () => {
    const forward = sortRelics(rows, 'tier', 'asc').map((r) => r.id)
    const reversed = sortRelics([...rows].reverse(), 'tier', 'asc').map((r) => r.id)
    expect(forward).toEqual(reversed)
  })
})

describe('facets', () => {
  it('lists tiers present, in game order', () => {
    expect(relicTiers(rows)).toEqual(['Lith', 'Meso', 'Axi'])
  })

  it('counts what is still farmable', () => {
    expect(countFarmable(rows)).toBe(1)
  })
})
