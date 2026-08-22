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
