import type { Source } from '@provenance/core'

/**
 * Labels for where a drop comes from.
 *
 * This file used to also model how long a run takes, so paths could be ranked by expected
 * minutes. That model is gone: it came off the item page on owner feedback and was then
 * dropped from the project outright as a useless metric. Averaging a 90-second Capture
 * against a 20-minute Survival produces a number that reads as precision and answers a
 * question no player actually asks — they ask where a thing is likeliest, and that is what
 * the tables now say and all they say.
 */

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
