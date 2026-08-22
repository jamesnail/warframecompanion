import type { DropEdge, Refinement, RelicRarity } from './types'

/**
 * Drop-graph math (DESIGN.md § 5). Pure, isomorphic, no I/O.
 *
 * Every function here takes and returns probabilities as floats in 0..1. Percentages are a
 * presentation concern and are formatted at the UI boundary, never carried through the math.
 */

/**
 * The relic reward table, fixed by rarity tier and refinement level.
 *
 * This is a VALIDATION FIXTURE, not the runtime source of truth. The pipeline reads the real
 * values out of the drop data; if the parsed values drift from these, DE changed something and
 * the build must fail loudly rather than silently ship different math (DESIGN.md § 5.2).
 *
 * Each row is per-slot: a relic holds 3 common slots, 2 uncommon, 1 rare, so a row sums to
 * 3c + 2u + r ≈ 100%.
 */
export const REFINEMENT_TABLE: Record<Refinement, Record<RelicRarity, number>> = {
  intact: { common: 0.2533, uncommon: 0.11, rare: 0.02 },
  exceptional: { common: 0.2333, uncommon: 0.13, rare: 0.04 },
  flawless: { common: 0.2, uncommon: 0.17, rare: 0.06 },
  radiant: { common: 0.1667, uncommon: 0.2, rare: 0.1 },
} as const

/** Slot counts per relic, by rarity. Used to check a refinement row sums to 100%. */
export const SLOTS_PER_RELIC: Record<RelicRarity, number> = {
  common: 3,
  uncommon: 2,
  rare: 1,
} as const

/**
 * Total probability mass of one refinement row. Should be 1.0 ± 0.001.
 * The pipeline's sanity gate uses this against parsed data (CLAUDE.md § pipeline).
 */
export function refinementRowTotal(row: Record<RelicRarity, number>): number {
  return (
    row.common * SLOTS_PER_RELIC.common +
    row.uncommon * SLOTS_PER_RELIC.uncommon +
    row.rare * SLOTS_PER_RELIC.rare
  )
}

/**
 * P(at least one drop per run) for a direct edge.
 *
 * `eventsPerRun` accounts for a run yielding several eligible events — three caches, four
 * rotation rounds. Each event is an independent trial, so this is the complement of missing
 * every one. Note this is deliberately NOT `chance * eventsPerRun`: that overcounts and can
 * exceed 1 once chance and event count are both high.
 */
export function perRunChance(edge: Pick<DropEdge, 'chance' | 'eventsPerRun'>): number {
  const events = edge.eventsPerRun ?? 1
  if (edge.chance <= 0) return 0
  if (edge.chance >= 1) return 1
  return 1 - Math.pow(1 - edge.chance, events)
}

/**
 * Expected number of runs to see the first drop — the mean of a geometric distribution.
 * Returns Infinity for p = 0 so callers must handle "unobtainable" explicitly rather than
 * silently dividing by zero.
 */
export function expectedRuns(p: number): number {
  if (p <= 0) return Number.POSITIVE_INFINITY
  return 1 / p
}

/**
 * Smallest n where P(at least one drop in n runs) >= confidence.
 *
 * Players intuit "runs until it's basically guaranteed" far better than the mean, and the gap
 * between this and expectedRuns() is the actual lesson about RNG. Show both, always.
 */
export function runsForConfidence(p: number, confidence = 0.95): number {
  if (p <= 0) return Number.POSITIVE_INFINITY
  if (p >= 1) return 1
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - p))
}

/** P(at least one success across n independent trials at probability p). */
export function atLeastOnce(p: number, n: number): number {
  if (n <= 0) return 0
  if (p <= 0) return 0
  if (p >= 1) return 1
  return 1 - Math.pow(1 - p, n)
}

/**
 * Radiant sharing: n players each crack a relic, the squad takes the best reward.
 *
 * For a rare at Radiant this turns 10% solo into 34.4% at four players — the single most
 * useful number this site can show, and the reason share count is a first-class control
 * rather than a footnote (DESIGN.md § 5.2).
 */
export function shareChance(pPerPlayer: number, players: number): number {
  return atLeastOnce(pPerPlayer, players)
}

/**
 * Compose a relic-gated path: run a source that drops relic R, then crack R.
 *
 * The two hops are independent, so the composed probability is their product. This is resolved
 * once at build time into `derived` edges — the client never traverses the graph (DESIGN.md § 5.4).
 */
export function composeThroughRelic(pRelicFromSource: number, pItemFromRelic: number): number {
  return pRelicFromSource * pItemFromRelic
}
