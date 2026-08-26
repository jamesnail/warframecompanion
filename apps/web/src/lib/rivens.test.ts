import { describe, expect, it } from 'vitest'

import type { RivenPrice, RivenWeapon } from '@provenance/core'

import {
  EMPTY_RIVEN_FILTERS,
  filterRivens,
  isThin,
  rivenFacets,
  sortRivens,
  tradesOf,
} from './rivens'

const price = (median: number, pop: number): RivenPrice => ({
  median,
  avg: median,
  min: median,
  max: median,
  stddev: 0,
  pop,
})

const weapons: RivenWeapon[] = [
  {
    id: 'braton-prime',
    name: 'Braton Prime',
    rivenType: 'Rifle',
    dispositionStars: 4,
    disposition: 1.25,
    unrolled: price(90, 12),
    rerolled: price(250, 5),
  },
  // The dataset's real hazard: a huge median drawn from one trade.
  {
    id: 'arca-scisco',
    name: 'Arca Scisco',
    rivenType: 'Pistol',
    dispositionStars: 5,
    disposition: 1.45,
    rerolled: price(15000, 1),
  },
  // Has a disposition, nobody traded it.
  { id: 'hek', name: 'Hek', rivenType: 'Shotgun', dispositionStars: 5, disposition: 1.55 },
  {
    id: 'dual-skana',
    name: 'Dual Skana',
    rivenType: 'Melee',
    dispositionStars: 5,
    disposition: 1.5,
    rerolled: price(5, 40),
  },
]

describe('tradesOf', () => {
  it('takes the better sample of the two roll states', () => {
    expect(tradesOf(weapons[0] as RivenWeapon)).toBe(12)
  })

  it('is zero for a weapon nobody traded', () => {
    expect(tradesOf(weapons[2] as RivenWeapon)).toBe(0)
  })
})

describe('isThin', () => {
  it('flags a sample of one or two', () => {
    expect(isThin(1)).toBe(true)
    expect(isThin(2)).toBe(true)
  })

  it('does not flag a real sample or a missing one', () => {
    expect(isThin(3)).toBe(false)
    expect(isThin(undefined)).toBe(false)
  })
})

describe('filterRivens', () => {
  it('returns everything by default', () => {
    expect(filterRivens(weapons, EMPTY_RIVEN_FILTERS)).toHaveLength(4)
  })

  it('matches on name, case-insensitively, every term', () => {
    expect(filterRivens(weapons, { ...EMPTY_RIVEN_FILTERS, q: 'BRATON' })).toHaveLength(1)
    expect(filterRivens(weapons, { ...EMPTY_RIVEN_FILTERS, q: 'braton prime' })).toHaveLength(1)
    expect(filterRivens(weapons, { ...EMPTY_RIVEN_FILTERS, q: 'braton hek' })).toHaveLength(0)
  })

  it('filters by riven type', () => {
    expect(filterRivens(weapons, { ...EMPTY_RIVEN_FILTERS, types: ['Rifle'] })).toHaveLength(1)
    expect(filterRivens(weapons, { ...EMPTY_RIVEN_FILTERS, types: [] })).toHaveLength(4)
  })

  it('hides weapons with no observed trades', () => {
    const out = filterRivens(weapons, { ...EMPTY_RIVEN_FILTERS, pricedOnly: true })
    expect(out.map((w) => w.name)).not.toContain('Hek')
    expect(out).toHaveLength(3)
  })

  // The whole point of the control: a 15,000p median off one sale should be removable.
  it('drops thin samples when a minimum is set', () => {
    const out = filterRivens(weapons, { ...EMPTY_RIVEN_FILTERS, minTrades: 3 })
    expect(out.map((w) => w.name).sort()).toEqual(['Braton Prime', 'Dual Skana'])
  })
})

describe('sortRivens', () => {
  it('sorts by disposition, best first', () => {
    expect(sortRivens(weapons, 'disposition', 'desc')[0]?.name).toBe('Hek')
  })

  it('sorts by rerolled price in both directions', () => {
    expect(sortRivens(weapons, 'rerolled', 'desc')[0]?.name).toBe('Arca Scisco')
    expect(sortRivens(weapons, 'rerolled', 'asc')[0]?.name).toBe('Dual Skana')
  })

  // A weapon with no trades has no price; treating that as zero would rank every untraded
  // weapon as "cheapest", which answers a question nobody asked.
  it('sorts missing values last in BOTH directions', () => {
    expect(sortRivens(weapons, 'rerolled', 'asc').at(-1)?.name).toBe('Hek')
    expect(sortRivens(weapons, 'rerolled', 'desc').at(-1)?.name).toBe('Hek')
    expect(sortRivens(weapons, 'unrolled', 'asc').at(-1)?.name).not.toBe('Braton Prime')
  })

  it('sorts by trade count', () => {
    expect(sortRivens(weapons, 'trades', 'desc')[0]?.name).toBe('Dual Skana')
  })

  it('sorts by name and by type', () => {
    expect(sortRivens(weapons, 'name', 'asc')[0]?.name).toBe('Arca Scisco')
    expect(sortRivens(weapons, 'type', 'asc')[0]?.rivenType).toBe('Melee')
  })

  it('does not mutate its input', () => {
    const before = weapons.map((w) => w.name)
    sortRivens(weapons, 'rerolled', 'asc')
    expect(weapons.map((w) => w.name)).toEqual(before)
  })

  it('breaks ties deterministically', () => {
    const tied: RivenWeapon[] = ['Zeta', 'Alpha', 'Mu'].map((name) => ({
      id: name.toLowerCase(),
      name,
      rivenType: 'Rifle',
      disposition: 1,
    }))
    expect(sortRivens(tied, 'disposition', 'desc').map((w) => w.name)).toEqual(['Alpha', 'Mu', 'Zeta'])
  })
})

describe('rivenFacets', () => {
  it('offers only the types present', () => {
    expect(rivenFacets(weapons)).toEqual(['Melee', 'Pistol', 'Rifle', 'Shotgun'])
  })
})
