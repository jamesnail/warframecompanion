import type { RivenType, RivenWeapon } from '@provenance/core'

/**
 * Filtering and sorting for the riven table, kept pure so the numbers are testable and the
 * component stays presentational.
 *
 * The dataset is 687 weapons, not 28,000 edges, so this does not need virtualizing and does
 * not get a haystack — a lowercase compare over 687 short names is not the slow part of
 * anything.
 */

export type RivenSortColumn = 'name' | 'type' | 'disposition' | 'unrolled' | 'rerolled' | 'trades'
export type SortDirection = 'asc' | 'desc'

export interface RivenFilters {
  q: string
  types: RivenType[]
  /**
   * Minimum observed trades. This is the honesty control, not a nicety: the five most
   * expensive rerolled medians in the dataset all come from a SINGLE trade — Arca Scisco
   * reads 15,000 platinum on a population of one — and a median drawn from one sale is a
   * anecdote wearing a statistic's clothes.
   */
  minTrades: number
  /** Hide weapons nobody traded that week. */
  pricedOnly: boolean
}

export const EMPTY_RIVEN_FILTERS: RivenFilters = {
  q: '',
  types: [],
  minTrades: 0,
  pricedOnly: false,
}

/** Trades below this are shown with a caveat rather than as a price. */
export const THIN_SAMPLE = 3

export function isThin(pop: number | undefined): boolean {
  return pop !== undefined && pop < THIN_SAMPLE
}

/** The best trade count the weapon has, across both roll states. */
export function tradesOf(weapon: RivenWeapon): number {
  return Math.max(weapon.unrolled?.pop ?? 0, weapon.rerolled?.pop ?? 0)
}

export function filterRivens(weapons: RivenWeapon[], filters: RivenFilters): RivenWeapon[] {
  const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean)
  const types = filters.types.length === 0 ? undefined : new Set(filters.types)

  return weapons.filter((weapon) => {
    if (types !== undefined && !types.has(weapon.rivenType)) return false
    if (filters.pricedOnly && weapon.unrolled === undefined && weapon.rerolled === undefined) {
      return false
    }
    // Applied to the weapon's best sample, so raising it hides thin data rather than hiding
    // a weapon that has one solid price and one thin one.
    if (filters.minTrades > 0 && tradesOf(weapon) < filters.minTrades) return false
    const name = weapon.name.toLowerCase()
    for (const term of terms) {
      if (!name.includes(term)) return false
    }
    return true
  })
}

/**
 * Sorted copy.
 *
 * Missing values always sort last regardless of direction. A weapon with no observed trades
 * has no price, which is not the same as a price of zero — letting it sort as zero would put
 * every untraded weapon at the top of "cheapest first" and answer a question nobody asked.
 */
export function sortRivens(
  weapons: RivenWeapon[],
  column: RivenSortColumn,
  direction: SortDirection,
): RivenWeapon[] {
  const sign = direction === 'asc' ? 1 : -1

  const value = (weapon: RivenWeapon): number | undefined => {
    switch (column) {
      case 'disposition':
        return weapon.disposition
      case 'unrolled':
        return weapon.unrolled?.median
      case 'rerolled':
        return weapon.rerolled?.median
      case 'trades': {
        const trades = tradesOf(weapon)
        return trades === 0 ? undefined : trades
      }
      default:
        return undefined
    }
  }

  return [...weapons].sort((a, b) => {
    if (column === 'name') return a.name.localeCompare(b.name) * sign
    if (column === 'type') {
      const byType = a.rivenType.localeCompare(b.rivenType) * sign
      return byType || a.name.localeCompare(b.name)
    }

    const left = value(a)
    const right = value(b)
    if (left === undefined && right === undefined) return a.name.localeCompare(b.name)
    if (left === undefined) return 1
    if (right === undefined) return -1
    // Ties break on name so the order is total and the table does not reshuffle.
    return (left - right) * sign || a.name.localeCompare(b.name)
  })
}

export function rivenFacets(weapons: RivenWeapon[]): RivenType[] {
  return [...new Set(weapons.map((weapon) => weapon.rivenType))].sort((a, b) => a.localeCompare(b))
}
