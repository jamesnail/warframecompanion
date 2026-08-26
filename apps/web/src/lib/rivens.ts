import type { RivenFamily, RivenType } from '@provenance/core'

/**
 * Filtering and sorting for the riven table, kept pure so the numbers are testable.
 *
 * A row is a FAMILY, not a weapon: one riven mod fits every variant it covers, so listing
 * Cernos, Cernos Prime and Rakta Cernos as three rows would show the same tradeable mod
 * three times and imply two prices that do not exist.
 */

export type RivenSortColumn = 'name' | 'type' | 'disposition' | 'unrolled' | 'rerolled' | 'trades'
export type SortDirection = 'asc' | 'desc'

export interface RivenFilters {
  q: string
  types: RivenType[]
  /**
   * Minimum observed trades. The honesty control: the most expensive medians in the dataset
   * come from a single trade, which is an anecdote wearing a statistic's clothes.
   */
  minTrades: number
  pricedOnly: boolean
  /** Only families whose riven covers more than one weapon. */
  multiOnly: boolean
}

export const EMPTY_RIVEN_FILTERS: RivenFilters = {
  q: '',
  types: [],
  minTrades: 0,
  pricedOnly: false,
  multiOnly: false,
}

/** Trades below this are shown with a caveat rather than as a price. */
export const THIN_SAMPLE = 3

export function isThin(pop: number | undefined): boolean {
  return pop !== undefined && pop < THIN_SAMPLE
}

/** The best trade count the family has, across both roll states. */
export function tradesOf(family: RivenFamily): number {
  return Math.max(family.unrolled?.pop ?? 0, family.rerolled?.pop ?? 0)
}

/**
 * The disposition range across a family's weapons.
 *
 * Variants do NOT share a disposition — Cernos sits at 1.30 while Cernos Prime and Rakta
 * Cernos sit at 1.25 — so a single number would be a lie about at least one of them. When
 * every member agrees, low and high are equal and the UI shows one figure.
 */
export function dispositionRange(family: RivenFamily): { low: number; high: number } | undefined {
  const values = family.weapons
    .map((weapon) => weapon.disposition)
    .filter((value): value is number => value !== undefined)
  if (values.length === 0) return undefined
  return { low: Math.min(...values), high: Math.max(...values) }
}

export function filterRivens(families: RivenFamily[], filters: RivenFilters): RivenFamily[] {
  const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean)
  const types = filters.types.length === 0 ? undefined : new Set(filters.types)

  return families.filter((family) => {
    if (types !== undefined && !types.has(family.rivenType)) return false
    if (filters.pricedOnly && family.unrolled === undefined && family.rerolled === undefined) {
      return false
    }
    if (filters.multiOnly && family.weapons.length < 2) return false
    if (filters.minTrades > 0 && tradesOf(family) < filters.minTrades) return false
    if (terms.length === 0) return true

    // Matched against the family name OR any covered weapon, so searching "rakta cernos"
    // finds the Cernos riven — which is the mod that actually fits it.
    const fields = [family.name, ...family.weapons.map((weapon) => weapon.name)]
    return fields.some((field) => {
      const lower = field.toLowerCase()
      return terms.every((term) => lower.includes(term))
    })
  })
}

/** Which covered weapons a query matched, so a row can show why it is in the results. */
export function matchedWeapons(family: RivenFamily, query: string): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return family.weapons
    .filter((weapon) => {
      const lower = weapon.name.toLowerCase()
      return terms.every((term) => lower.includes(term))
    })
    .map((weapon) => weapon.name)
}

/**
 * Sorted copy. Missing values always sort last regardless of direction: a family nobody
 * traded has no price, which is not the same as a price of zero.
 */
export function sortRivens(
  families: RivenFamily[],
  column: RivenSortColumn,
  direction: SortDirection,
): RivenFamily[] {
  const sign = direction === 'asc' ? 1 : -1

  const value = (family: RivenFamily): number | undefined => {
    switch (column) {
      case 'disposition':
        return dispositionRange(family)?.high
      case 'unrolled':
        return family.unrolled?.median
      case 'rerolled':
        return family.rerolled?.median
      case 'trades': {
        const trades = tradesOf(family)
        return trades === 0 ? undefined : trades
      }
      default:
        return undefined
    }
  }

  return [...families].sort((a, b) => {
    if (column === 'name') return a.name.localeCompare(b.name) * sign
    if (column === 'type') {
      return a.rivenType.localeCompare(b.rivenType) * sign || a.name.localeCompare(b.name)
    }
    const left = value(a)
    const right = value(b)
    if (left === undefined && right === undefined) return a.name.localeCompare(b.name)
    if (left === undefined) return 1
    if (right === undefined) return -1
    return (left - right) * sign || a.name.localeCompare(b.name)
  })
}

export function rivenFacets(families: RivenFamily[]): RivenType[] {
  return [...new Set(families.map((family) => family.rivenType))].sort((a, b) => a.localeCompare(b))
}
