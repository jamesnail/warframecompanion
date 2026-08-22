import { missionDurationMinutes } from '@provenance/core'
import type { Source } from '@provenance/core'

/**
 * How long one "run" of a source takes, in minutes — or undefined where the question has
 * no honest answer.
 *
 * An enemy is not a run: you do not queue "one Corrupted Heavy Gunner", you kill however
 * many spawn while doing something else. Inventing a duration for those would let them be
 * ranked against missions as though the comparison meant something. Returning undefined
 * keeps them rankable by chance while excluding them from time estimates.
 */
export function runMinutes(source: Source | undefined): number | undefined {
  if (source === undefined) return undefined

  switch (source.kind) {
    case 'mission':
      return missionDurationMinutes(source.missionType)
    case 'bounty':
      // A bounty is several stages; longer than a single mission node.
      return 8
    case 'sortie':
      // Three missions, and it is once per day regardless.
      return 15
    case 'transient':
      return 5
    default:
      // enemy, syndicate, relic, cache, other — no meaningful per-run duration.
      return undefined
  }
}

/** Human label for where a drop comes from, when it is not a plain mission node. */
export function kindLabel(source: Source | undefined): string | undefined {
  switch (source?.kind) {
    case 'bounty':
      return 'Bounty'
    case 'enemy':
      return 'Enemy'
    case 'sortie':
      return 'Sortie'
    case 'transient':
      return 'Objective'
    case 'syndicate':
      return 'Syndicate'
    default:
      return undefined
  }
}
