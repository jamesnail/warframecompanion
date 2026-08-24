/**
 * How often a given reward rotation actually comes around.
 *
 * Endless missions do not cycle A, B, C. They cycle **A A B C**: the first two reward
 * intervals both draw from rotation A, the third from B, the fourth from C. So over four
 * intervals you get two shots at an A reward and exactly one each at B and C.
 *
 * Costing a Rotation C reward as though it arrived every interval understates the effort
 * fourfold — a 20-minute Survival is four rotations, not one. Roughly 31% of all edges in
 * the dataset (9001 of 28776) carry a true rotation, so this is not a corner case.
 *
 * The multiplier below is "intervals you must play per opportunity at this rotation".
 */
export const AABC_CYCLE = { A: 4 / 2, B: 4 / 1, C: 4 / 1 } as const

/**
 * Mission types that genuinely cycle rewards A A B C.
 *
 * Deliberately a allowlist, not a denylist: an unrecognised type gets a multiplier of 1,
 * which leaves its estimate exactly as it was. Overstating effort on content we have not
 * modelled would be a new error, not a fix.
 *
 * NOT included, and why:
 *  - Caches and Spy key rewards A/B/C but those are the 1st/2nd/3rd cache and the three
 *    vaults; you get all of them in a single run (see stages.ts).
 *  - Bounties award their stages' rotations within one bounty run.
 *  - Disruption runs A, B, C, C… rather than A A B C, so it is left alone pending a
 *    proper model.
 */
const ROTATING_MISSIONS = new Set([
  'Survival',
  'Defense',
  'Excavation',
  'Interception',
  'Defection',
  'Infested Salvage',
  'Sanctuary Onslaught',
  'Void Cascade',
  'Void Flood',
  'Void Armageddon',
  'Alchemy',
  'Ascension',
  'Shrine Defense',
])

/**
 * Intervals of play needed per opportunity at this rotation. 1 when the concept does not
 * apply, so callers can multiply unconditionally.
 */
export function rotationCycleCost(
  missionType: string | undefined,
  rotation: 'A' | 'B' | 'C' | null | undefined,
): number {
  if (rotation === null || rotation === undefined) return 1
  if (missionType === undefined || !ROTATING_MISSIONS.has(missionType)) return 1
  return AABC_CYCLE[rotation]
}
