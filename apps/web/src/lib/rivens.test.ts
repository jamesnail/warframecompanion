import { describe, expect, it } from 'vitest'

import type { RivenFamily, RivenPrice } from '@provenance/core'

import {
  EMPTY_RIVEN_FILTERS,
  dispositionRange,
  filterRivens,
  isThin,
  matchedWeapons,
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

const families: RivenFamily[] = [
  {
    id: 'cernos',
    name: 'Cernos',
    rivenType: 'Rifle',
    unrolled: price(90, 12),
    rerolled: price(250, 5),
    weapons: [
      { id: 'cernos', name: 'Cernos', disposition: 1.3, dispositionStars: 4 },
      { id: 'cernos-prime', name: 'Cernos Prime', disposition: 1.25, dispositionStars: 4, itemId: 'cernos-prime' },
      { id: 'rakta-cernos', name: 'Rakta Cernos', disposition: 1.25, dispositionStars: 4 },
    ],
  },
  {
    id: 'mutalist-cernos',
    name: 'Mutalist Cernos',
    rivenType: 'Rifle',
    unrolled: price(15, 1),
    weapons: [{ id: 'mutalist-cernos', name: 'Mutalist Cernos', disposition: 1.35, dispositionStars: 5 }],
  },
  {
    id: 'hek',
    name: 'Hek',
    rivenType: 'Shotgun',
    weapons: [{ id: 'hek', name: 'Hek', disposition: 1.2, dispositionStars: 4 }],
  },
  {
    id: 'dual-skana',
    name: 'Dual Skana',
    rivenType: 'Melee',
    rerolled: price(5, 40),
    weapons: [{ id: 'dual-skana', name: 'Dual Skana', disposition: 1.5, dispositionStars: 5 }],
  },
]

const byName = (name: string) => families.find((f) => f.name === name) as RivenFamily

describe('dispositionRange', () => {
  // Variants do not share a disposition, so one number would misstate at least one of them.
  it('spans the members when they differ', () => {
    expect(dispositionRange(byName('Cernos'))).toEqual({ low: 1.25, high: 1.3 })
  })

  it('collapses to a single value when they agree', () => {
    expect(dispositionRange(byName('Hek'))).toEqual({ low: 1.2, high: 1.2 })
  })

  it('is undefined when upstream published none', () => {
    expect(
      dispositionRange({ id: 'x', name: 'X', rivenType: 'Rifle', weapons: [{ id: 'x', name: 'X' }] }),
    ).toBeUndefined()
  })
})

describe('tradesOf / isThin', () => {
  it('takes the better sample of the two roll states', () => {
    expect(tradesOf(byName('Cernos'))).toBe(12)
  })

  it('is zero for a family nobody traded', () => {
    expect(tradesOf(byName('Hek'))).toBe(0)
  })

  it('flags a sample of one or two', () => {
    expect(isThin(1)).toBe(true)
    expect(isThin(3)).toBe(false)
    expect(isThin(undefined)).toBe(false)
  })
})

describe('filterRivens', () => {
  it('returns everything by default', () => {
    expect(filterRivens(families, EMPTY_RIVEN_FILTERS)).toHaveLength(4)
  })

  // The point of the family model: the mod that fits Rakta Cernos is the CERNOS riven.
  it('finds a family by a variant it covers', () => {
    const found = filterRivens(families, { ...EMPTY_RIVEN_FILTERS, q: 'rakta cernos' })
    expect(found.map((f) => f.name)).toEqual(['Cernos'])
  })

  it('does not match terms across two different weapons', () => {
    // "rakta prime" would match by pooling Rakta Cernos and Cernos Prime. It must not.
    expect(filterRivens(families, { ...EMPTY_RIVEN_FILTERS, q: 'rakta prime' })).toHaveLength(0)
  })

  it('still finds a family by its own name', () => {
    expect(filterRivens(families, { ...EMPTY_RIVEN_FILTERS, q: 'mutalist' })).toHaveLength(1)
  })

  it('filters by riven type', () => {
    expect(filterRivens(families, { ...EMPTY_RIVEN_FILTERS, types: ['Shotgun'] })).toHaveLength(1)
  })

  it('hides families nobody traded', () => {
    const out = filterRivens(families, { ...EMPTY_RIVEN_FILTERS, pricedOnly: true })
    expect(out.map((f) => f.name)).not.toContain('Hek')
  })

  it('drops thin samples when a minimum is set', () => {
    const out = filterRivens(families, { ...EMPTY_RIVEN_FILTERS, minTrades: 3 })
    expect(out.map((f) => f.name).sort()).toEqual(['Cernos', 'Dual Skana'])
  })

  it('can show only rivens that cover more than one weapon', () => {
    const out = filterRivens(families, { ...EMPTY_RIVEN_FILTERS, multiOnly: true })
    expect(out.map((f) => f.name)).toEqual(['Cernos'])
  })
})

describe('matchedWeapons', () => {
  it('names the covered weapons a query hit', () => {
    expect(matchedWeapons(byName('Cernos'), 'rakta')).toEqual(['Rakta Cernos'])
  })

  it('returns nothing for an empty query', () => {
    expect(matchedWeapons(byName('Cernos'), '')).toEqual([])
  })
})

describe('sortRivens', () => {
  it('sorts by the family best disposition', () => {
    expect(sortRivens(families, 'disposition', 'desc')[0]?.name).toBe('Dual Skana')
  })

  it('sorts by rerolled price in both directions', () => {
    expect(sortRivens(families, 'rerolled', 'desc')[0]?.name).toBe('Cernos')
    expect(sortRivens(families, 'rerolled', 'asc')[0]?.name).toBe('Dual Skana')
  })

  // No price is not a price of zero. Two families here lack a rerolled price, so the
  // invariant is that both land at the end whichever way the sort runs — not that a
  // particular one is last, which only holds by tiebreak.
  it('sorts missing values last in BOTH directions', () => {
    const unpriced = ['Hek', 'Mutalist Cernos']
    for (const dir of ['asc', 'desc'] as const) {
      const tail = sortRivens(families, 'rerolled', dir)
        .slice(-2)
        .map((f) => f.name)
        .sort()
      expect(tail).toEqual(unpriced)
    }
  })

  it('does not mutate its input', () => {
    const before = families.map((f) => f.name)
    sortRivens(families, 'rerolled', 'asc')
    expect(families.map((f) => f.name)).toEqual(before)
  })

  it('breaks ties deterministically', () => {
    const tied: RivenFamily[] = ['Zeta', 'Alpha', 'Mu'].map((name) => ({
      id: name.toLowerCase(),
      name,
      rivenType: 'Rifle',
      weapons: [{ id: name.toLowerCase(), name, disposition: 1 }],
    }))
    expect(sortRivens(tied, 'disposition', 'desc').map((f) => f.name)).toEqual(['Alpha', 'Mu', 'Zeta'])
  })
})

describe('rivenFacets', () => {
  it('offers only the types present', () => {
    expect(rivenFacets(families)).toEqual(['Melee', 'Rifle', 'Shotgun'])
  })
})
