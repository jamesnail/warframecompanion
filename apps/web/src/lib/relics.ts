import type { RelicDetail, RelicRarity, RelicTier } from '@provenance/core'

/**
 * The /relics row model and its filtering, kept pure so it can be unit-tested.
 *
 * A row is one RELIC, which is what makes this surface different from /browse: there a row
 * is one edge and a relic appears once per place it drops. Here the question is the other
 * way round — what is inside this thing, and can I still get it.
 */

export interface RelicReward {
  itemId: string
  name: string
  rarity: RelicRarity
  quantity: number | undefined
}

export interface RelicRow {
  id: string
  name: string
  tier: RelicTier
  vaulted: boolean
  /** Every relic in the dataset has exactly one rare reward — it is the reason to run it. */
  rare: RelicReward | undefined
  rewards: RelicReward[]
  /** Lowercased relic name plus every reward name, so a search finds a relic by its
   *  contents. That is the whole point: you look for the part, not the relic. */
  haystack: string
}

export interface RelicFilters {
  q: string
  tiers: RelicTier[]
  /** Hide relics no active source drops. 737 of 771 are vaulted, so this is not a niche. */
  farmableOnly: boolean
}

export const EMPTY_RELIC_FILTERS: RelicFilters = { q: '', tiers: [], farmableOnly: false }

export type RelicSortColumn = 'name' | 'tier' | 'rare'
export type SortDirection = 'asc' | 'desc'

export function buildRelicRows(
  relics: RelicDetail[],
  nameOf: (itemId: string) => string,
): RelicRow[] {
  return relics.map((relic) => {
    const rewards: RelicReward[] = relic.rewards.map((reward) => ({
      itemId: reward.itemId,
      name: nameOf(reward.itemId),
      rarity: reward.rarity,
      quantity: reward.quantity,
    }))
    const name = nameOf(relic.id)
    return {
      id: relic.id,
      name,
      tier: relic.tier,
      vaulted: relic.vaulted,
      rare: rewards.find((reward) => reward.rarity === 'rare'),
      rewards,
      haystack: `${name} ${rewards.map((reward) => reward.name).join(' ')}`.toLowerCase(),
    }
  })
}

/**
 * Every term must match ONE field — the relic's name, or a single reward's name.
 *
 * Not a combined haystack, which is how /browse works and is wrong here. A relic holds six
 * different things, so "braton prime barrel" over a pooled haystack is satisfied by a relic
 * containing Braton Prime *Receiver* and Boltor Prime *Barrel*, which does not contain what
 * was asked for. That returned 79 relics where the item page's own count said 39; requiring
 * the terms to land on the same field returns exactly 39.
 *
 * The cost is that a compound query like "lith forma" finds nothing, because no single field
 * holds both. That is the right trade: the tier filter is a separate control and expresses
 * it exactly, whereas a false positive here is silent and the reader cannot see it.
 */
export function filterRelics(rows: RelicRow[], filters: RelicFilters): RelicRow[] {
  const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean)
  const tiers = filters.tiers.length === 0 ? undefined : new Set(filters.tiers)
  const allIn = (field: string): boolean => terms.every((term) => field.includes(term))

  return rows.filter((row) => {
    if (tiers !== undefined && !tiers.has(row.tier)) return false
    if (filters.farmableOnly && row.vaulted) return false
    if (terms.length === 0) return true
    if (allIn(row.name.toLowerCase())) return true
    return row.rewards.some((reward) => allIn(reward.name.toLowerCase()))
  })
}

/**
 * Which rewards a search actually matched, so a row can explain why it is in the results.
 *
 * Without this, searching "forma" returns 400 relics with no indication which of the six
 * slots matched — the reader is left to open each one. Never returns the relic's own name
 * match, because that one is already obvious from the row.
 */
export function matchedRewards(row: RelicRow, query: string): RelicReward[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return row.rewards.filter((reward) => {
    const name = reward.name.toLowerCase()
    return terms.some((term) => name.includes(term))
  })
}

const TIER_ORDER: RelicTier[] = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem', 'Vanguard']

export function sortRelics(
  rows: RelicRow[],
  column: RelicSortColumn,
  direction: SortDirection,
): RelicRow[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let primary = 0
    switch (column) {
      case 'tier':
        primary = (TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)) * sign
        break
      case 'rare':
        // Sorting by the rare reward's NAME, not its chance: every rare sits at the same
        // odds for a given refinement, so a chance sort would be a no-op dressed as a choice.
        primary = (a.rare?.name ?? '').localeCompare(b.rare?.name ?? '') * sign
        break
      case 'name':
        primary = a.name.localeCompare(b.name) * sign
        break
    }
    // Ties break on name so the order is total and the list does not reshuffle.
    return primary || a.name.localeCompare(b.name)
  })
}

export function relicTiers(rows: RelicRow[]): RelicTier[] {
  const found = new Set(rows.map((row) => row.tier))
  return TIER_ORDER.filter((tier) => found.has(tier))
}

export function countFarmable(rows: RelicRow[]): number {
  return rows.filter((row) => !row.vaulted).length
}
