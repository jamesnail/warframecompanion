/**
 * Median minutes per mission archetype.
 *
 * HAND-CURATED ESTIMATE. No dataset carries mission durations, but ranking paths by raw
 * percentage is misleading — a 10% reward on a 20-minute Survival is not the 10% on a
 * 90-second Capture. Expected *minutes* is the only honest comparison (DESIGN.md § 5.2).
 *
 * Kept in one file so it is easy to tune. Must be labelled as an estimate wherever it
 * surfaces in the UI, and must be user-overridable.
 *
 * For endless missions the number is minutes per ROTATION, not per run.
 */
export const MISSION_DURATIONS_MIN: Readonly<Record<string, number>> = {
  Capture: 1.5,
  Exterminate: 3,
  Rescue: 4,
  Sabotage: 4,
  Spy: 4.5,
  Assassination: 5,
  Defense: 5,
  Survival: 5,
  Excavation: 5,
  Interception: 6,
  Disruption: 4,
  Defection: 6,
  Hijack: 5,
  Mobile_Defense: 4.5,
} as const

/** Fallback for archetypes not in the table. Deliberately pessimistic. */
export const DEFAULT_MISSION_DURATION_MIN = 5

export function missionDurationMinutes(missionType: string | undefined): number {
  if (missionType === undefined) return DEFAULT_MISSION_DURATION_MIN
  const key = missionType.replace(/\s+/g, '_')
  return MISSION_DURATIONS_MIN[key] ?? DEFAULT_MISSION_DURATION_MIN
}

/**
 * Median minutes to crack one relic in a Void Fissure.
 *
 * HAND-CURATED ESTIMATE, and a separate cost from farming the relic. Players overwhelmingly
 * crack relics on the fastest available fissure (a Capture, occasionally an Exterminate),
 * so this tracks that rather than the average across all fissure types.
 *
 * It exists because "runs to farm the relics" is only half the effort — the other half is
 * the fissure runs themselves, and omitting them understates a relic path.
 */
export const FISSURE_RUN_MINUTES = 3
