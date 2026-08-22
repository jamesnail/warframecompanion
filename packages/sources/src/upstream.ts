import { z } from 'zod'

/**
 * Zod schemas for the WFCD upstream payloads, as they actually are — not as they ought
 * to be. Every payload is parsed through these before use so that schema drift fails the
 * build loudly instead of silently shipping a partial dataset (CLAUDE.md § Errors).
 *
 * Verified against WFCD/warframe-drop-data on 2026-08-22: 24 planets / 435 nodes /
 * 3086 relic entries.
 */

/** `chance` arrives as a PERCENT (50 means 50%), always a number in the current data.
 *  The tolerant union is kept because upstream has historically emitted malformed
 *  strings like "nce: 15.00" (DESIGN.md § 10.2); normalizeChance is the one place
 *  that gets to interpret it. */
const RawChance = z.union([z.number(), z.string()])

export const RawReward = z.object({
  _id: z.string().optional(),
  itemName: z.string(),
  rarity: z.string().optional(),
  chance: RawChance,
})
export type RawReward = z.infer<typeof RawReward>

export const RawNode = z.object({
  gameMode: z.string(),
  isEvent: z.boolean().optional(),
  /** Endless missions key rewards by rotation; everything else is a flat array. */
  rewards: z.union([
    z.array(RawReward),
    z.record(z.string(), z.array(RawReward)),
  ]),
})
export type RawNode = z.infer<typeof RawNode>

export const RawMissionRewards = z.object({
  missionRewards: z.record(z.string(), z.record(z.string(), RawNode)),
})

export const RawRelic = z.object({
  tier: z.string(),
  /** QUIRK: exactly one entry upstream (a Requiem Intact row) ships with no relicName
   *  at all. Optional here so one malformed row cannot wedge the pipeline forever;
   *  parseRelics skips nameless relics and the caller gates on how many were skipped. */
  relicName: z.string().optional(),
  state: z.string(),
  rewards: z.array(RawReward),
  _id: z.string().optional(),
})
export type RawRelic = z.infer<typeof RawRelic>

export const RawRelics = z.object({ relics: z.array(RawRelic) })

export const RawInfo = z.object({
  /** MD5 of DE's source page. The upstream change signal (DESIGN.md § 3). */
  hash: z.string(),
  timestamp: z.number(),
  modified: z.number().optional(),
})
export type RawInfo = z.infer<typeof RawInfo>

/**
 * Percent -> float in 0..1, tolerating the malformed string forms upstream has shipped.
 * Throws rather than defaulting to zero: a silently-zeroed drop chance is worse than a
 * failed build, because it renders as "impossible" instead of "unknown".
 */
export function normalizeChance(raw: number | string): number {
  const value =
    typeof raw === 'number' ? raw : Number.parseFloat(raw.replace(/[^0-9.]/g, ''))

  if (!Number.isFinite(value)) {
    throw new Error(`Unparseable drop chance: ${JSON.stringify(raw)}`)
  }
  if (value < 0 || value > 100) {
    throw new Error(`Drop chance outside 0..100: ${String(value)}`)
  }
  return value / 100
}

/* ------------------------------------------------------------------------------------
 * Secondary drop tables. Each of these uses a slightly different shape and a slightly
 * different name for the same field, so they are declared separately rather than forced
 * into one schema — the differences are real and pretending otherwise loses data.
 * ---------------------------------------------------------------------------------- */

/** QUIRK: the reward item's key is `itemName` in most tables, `item` in resourceByAvatar
 *  and syndicates, and `modName` in mod tables. */
export const RawNamedReward = z.object({
  _id: z.string().optional(),
  itemName: z.string().optional(),
  item: z.string().optional(),
  modName: z.string().optional(),
  rarity: z.string().optional(),
  /** QUIRK: a handful of enemy-table rewards carry chance: null — the drop is real but
   *  its rate is unknown upstream. Nullable here so one unknown rate cannot fail the
   *  build; callers skip them and gate on how many were skipped. Emitting 0 instead
   *  would render as 'impossible', which is a different and worse lie. */
  chance: RawChance.nullable(),
  rotation: z.string().optional(),
  stage: z.string().optional(),
})
export type RawNamedReward = z.infer<typeof RawNamedReward>

/** Resolve whichever key this table happened to use. */
export function rewardName(reward: RawNamedReward): string | undefined {
  return reward.itemName ?? reward.item ?? reward.modName
}

const RotatedRewards = z.union([
  z.array(RawNamedReward),
  z.record(z.string(), z.array(RawNamedReward)),
])

/** Cetus / Solaris / Deimos / Zariman / Entrati Lab / Hex all share this shape. */
export const RawBountyTier = z.object({
  bountyLevel: z.string(),
  rewards: RotatedRewards,
})
export type RawBountyTier = z.infer<typeof RawBountyTier>

export const RawKeyReward = z.object({
  keyName: z.string(),
  rewards: RotatedRewards,
})
export type RawKeyReward = z.infer<typeof RawKeyReward>

export const RawTransient = z.object({
  objectiveName: z.string(),
  rewards: z.array(RawNamedReward),
})
export type RawTransient = z.infer<typeof RawTransient>

/**
 * Enemy tables carry TWO probabilities: the chance the enemy drops from this table at
 * all, and the chance of a given entry within it. They must be composed, not conflated.
 *
 * QUIRK: the gate arrives as a string ("100.00"), and enemyModTables ships it twice —
 * once as `enemyModDropChance` and once as the misspelled `ememyModDropChance`, with
 * identical values. This is the duplicated-chance-field hazard from DESIGN.md § 10.2.
 */
export const RawEnemyTable = z.object({
  enemyName: z.string().optional(),
  /** resourceByAvatar names the same concept `source`. */
  source: z.string().optional(),
  enemyModDropChance: RawChance.optional(),
  ememyModDropChance: RawChance.optional(),
  enemyItemDropChance: RawChance.optional(),
  items: z.array(RawNamedReward).optional(),
  mods: z.array(RawNamedReward).optional(),
  blueprints: z.array(RawNamedReward).optional(),
})
export type RawEnemyTable = z.infer<typeof RawEnemyTable>

export const RawSyndicateItem = z.object({
  item: z.string(),
  chance: RawChance,
  rarity: z.string().optional(),
  place: z.string().optional(),
  standing: z.number().optional(),
})
export type RawSyndicateItem = z.infer<typeof RawSyndicateItem>

/**
 * QUIRK: a few resource containers report a chance ABOVE 100% — "Rare Corpus Storage
 * Container / Cubic Diodes = 227.64". That is not a probability; it is an expected yield
 * of ~2.3 units per container, because the resource is stackable.
 *
 * Clamping to 100% would silently discard the multiplier, and throwing would fail the
 * build on correct data. Instead the drop becomes guaranteed with a quantity range, which
 * is what the number actually means and what DropEdge.quantity exists to carry.
 */
export function normalizeReward(raw: number | string): {
  chance: number
  quantity: [number, number]
} {
  const value =
    typeof raw === 'number' ? raw : Number.parseFloat(raw.replace(/[^0-9.]/g, ''))

  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Unparseable drop chance: ${JSON.stringify(raw)}`)
  }

  if (value > 100) {
    const multiple = value / 100
    return { chance: 1, quantity: [Math.floor(multiple), Math.ceil(multiple)] }
  }

  return { chance: value / 100, quantity: [1, 1] }
}
