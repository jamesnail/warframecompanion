import type { Rotation } from './types'

/**
 * QUIRK — upstream keys several different concepts as "A" / "B" / "C".
 *
 * For endless missions those really are reward rotations. For Sabotage cache missions they
 * are the first, second and third cache; for Spy they are the three data vaults. Rendering
 * all of them as "Rotation C" tells the player something false about how the mission works.
 *
 * The key is the mission type, so the mapping lives here rather than at the call site.
 */

/** Mission types where A/B/C means something other than a reward rotation. */
const STAGE_NOUN: Record<string, string> = {
  Caches: 'Cache',
  Spy: 'Vault',
}

/** Mission types where A/B/C is genuinely a reward rotation. Anything not listed here and
 *  not in STAGE_NOUN falls back to "Rotation", which is the common case. */
export function stageLabel(
  missionType: string | undefined,
  rotation: Rotation | null | undefined,
): string | undefined {
  if (rotation === null || rotation === undefined) return undefined
  const noun = missionType === undefined ? 'Rotation' : (STAGE_NOUN[missionType] ?? 'Rotation')
  return `${noun} ${rotation}`
}
