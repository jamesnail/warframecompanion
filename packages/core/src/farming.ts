import type { ItemCategory } from './types'

/**
 * How an item type is actually farmed — which is not always what its drop table says.
 *
 * The drop chain ("run this, crack that, get this") is the right answer for a prime part and
 * the wrong one for most other things, because it ranks routes by the probability of one
 * drop and nothing else. Two failures made that concrete:
 *
 *  - **Endo.** Ranked by chance, /item/endo led with "kill a Rare Corpus Storage Container,
 *    100%". A container that always holds 80 Endo wins a chance ranking outright. Nobody
 *    farms Endo that way; they run Arbitrations or dissolve Ayatan sculptures, neither of
 *    which is a row in any drop table.
 *  - **Resources.** A resource is not farmed as an end-of-mission reward at all. It comes
 *    off enemies and containers, continuously, and what matters is units per run — 350
 *    Plastids at 4% beats 10 at 20% — not the odds of seeing one.
 *
 * So the strategy is chosen per item, and it decides two things: how routes are RANKED, and
 * what the page says about them. This is curated judgement, not derived data, and it is
 * marked as such in the UI (DESIGN.md § 16).
 */

export type FarmStrategy =
  /** Relic-gated. The drop chain is correct here and stays — it is the signature element. */
  | 'relic-chain'
  /** Farmed continuously off enemies and containers. Rank by yield per run, not by chance. */
  | 'resource'
  /** A currency with a real route that is not a drop-table row. Curated advice leads. */
  | 'currency'
  /** Dropped by specific enemies. Chance ranking is right; the enemy is the answer. */
  | 'mod'
  /** Built, not dropped. The recipe is the answer and the components are the farm. */
  | 'assembled'
  /** Everything else: a direct drop, ranked by chance. */
  | 'direct'

/**
 * Items whose category does not predict how they are farmed.
 *
 * Kept deliberately short. Each entry is here because the derived answer is actively
 * misleading, not merely incomplete — a longer list would be a sign the strategy rules above
 * are wrong rather than that more overrides are needed. Every id is validated against the
 * real item table at build time.
 */
export const FARM_OVERRIDES: Record<string, FarmStrategy> = {
  endo: 'currency',
  kuva: 'currency',
  'steel-essence': 'currency',
  'vitus-essence': 'currency',
  'riven-sliver': 'currency',
  aya: 'currency',
  'void-traces': 'currency',
  credits: 'currency',
  // Categorised `Other` upstream, farmed exactly like every other resource.
  ferrite: 'resource',
  neurodes: 'resource',
}

const BY_CATEGORY: Partial<Record<ItemCategory, FarmStrategy>> = {
  Resource: 'resource',
  Mod: 'mod',
  Arcane: 'mod',
}

/**
 * Which strategy an item takes.
 *
 * `hasRelicPath` wins over everything except an explicit override: a prime part is a
 * Component by category, and its category tells you nothing useful about how to get it.
 */
export function farmStrategy(
  item: { id: string; category: ItemCategory; parts?: readonly unknown[] | undefined },
  hasRelicPath: boolean,
): FarmStrategy {
  const override = FARM_OVERRIDES[item.id]
  if (override !== undefined) return override
  if (hasRelicPath) return 'relic-chain'
  // Parts rather than the whole recipe: a thing whose recipe is nothing but resources is
  // crafted, not assembled, and telling the reader to farm its pieces names no pieces.
  if (item.parts !== undefined && item.parts.length > 0) return 'assembled'
  return BY_CATEGORY[item.category] ?? 'direct'
}

/** True where routes should be ranked by expected units per run rather than by the chance of
 *  seeing one. Quantity only matters where an item stacks, which is exactly these. */
export function ranksByYield(strategy: FarmStrategy): boolean {
  return strategy === 'resource' || strategy === 'currency'
}
