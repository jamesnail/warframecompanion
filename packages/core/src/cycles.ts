/**
 * Open-world cycles.
 *
 * Cetus day/night, Orb Vallis warm/cold, Cambion Drift Fass/Vome and Duviri's spiral are not
 * published in DE's world state feed at all. They do not need to be: each one is a fixed
 * rotation of fixed-length phases, so a single known instant plus the phase lengths locates
 * the cycle for any time, forever, with no network call. That is how the Warframe wiki's
 * front page does it (`Template:CycleClock` + `MediaWiki:Gadget-CycleClock.js`), and the
 * constants below are that template's, transcribed from its source.
 *
 * This is the one part of the world state page that cannot go stale, cannot fail to load and
 * costs nothing: it is arithmetic on the reader's own clock.
 *
 * PROVENANCE AND VERIFICATION
 *
 * The Cetus epoch is confirmed, not assumed. DE's own bounty rotation runs on the same
 * 150-minute boundary, and on 2026-08-27 the epoch below predicted that boundary to within
 * **3.3 seconds** of the expiry DE published (via `oracle.browse.wf/bounty-cycle`). Because
 * the epoch is roughly 2,400 cycles in the past, any error in the phase lengths would be
 * multiplied by 2,400 — so agreeing to 3.3s also bounds the period error to about 1.4ms per
 * cycle. A long baseline is what makes these constants checkable at all.
 *
 * That is also why the odd `- 1126` on the long phases is kept rather than rounded to a neat
 * 150 minutes. The true period is not exactly 150 minutes. Had it been, the wiki's value
 * would drift ~45 minutes over the elapsed 2,400 cycles; it drifts ~3 seconds.
 *
 * Vallis and Duviri come from the same template and the same mechanism, but no independent
 * feed publishes their state, so they are *not* separately verified — they rest on the wiki
 * being right. Their phase lengths (1600s and 5x2h) are long-standing community constants.
 *
 * Zariman is deliberately ABSENT from this file. The wiki lists an epoch for it, and that
 * epoch is wrong: on 2026-08-27 it computed Corpus while DE published Grineer — inverted,
 * with the period itself correct. The wiki's own gadget does not trust it either and fetches
 * the live faction instead, which is what this app does too (see `lib/client/world-state`).
 * An epoch that is one phase out is worse than no epoch, because it is confidently wrong.
 */

export interface CyclePhase {
  /** As players say it: "Night", "Fass", "Sorrow". Never a friendlier synonym. */
  name: string
  durationMs: number
}

export interface WorldCycle {
  id: string
  /** The place, as players say it: "Plains of Eidolon", not "Earth". */
  location: string
  /** Milliseconds since the Unix epoch at which `phases[0]` began. */
  epoch: number
  phases: CyclePhase[]
}

export interface CyclePosition {
  cycle: WorldCycle
  phase: CyclePhase
  index: number
  next: CyclePhase
  /** Milliseconds until the current phase ends. */
  remainingMs: number
  /** Absolute timestamp at which the current phase ends. */
  endsAt: number
}

const MIN = 60 * 1000

/**
 * The `- 1126` is the wiki's measured correction, not a typo. See the note above: it is what
 * keeps the prediction within seconds of DE's own boundary after thousands of cycles.
 */
const LONG_PHASE = 100 * MIN - 1126

export const WORLD_CYCLES: readonly WorldCycle[] = [
  {
    id: 'cetus',
    location: 'Plains of Eidolon',
    epoch: 1766129867176,
    phases: [
      { name: 'Day', durationMs: LONG_PHASE },
      { name: 'Night', durationMs: 50 * MIN },
    ],
  },
  {
    // Same epoch and same phase lengths as Cetus — the Drift is locked to the Plains, so
    // Fass runs with Day and Vome with Night. That is not a coincidence to tidy away.
    id: 'cambion',
    location: 'Cambion Drift',
    epoch: 1766129867176,
    phases: [
      { name: 'Fass', durationMs: LONG_PHASE },
      { name: 'Vome', durationMs: 50 * MIN },
    ],
  },
  {
    id: 'vallis',
    location: 'Orb Vallis',
    epoch: 1766128805676,
    phases: [
      // Warm is the short one. Players wait for it, so it is the phase worth counting down to.
      { name: 'Warm', durationMs: 6 * MIN + 40 * 1000 },
      { name: 'Cold', durationMs: 20 * MIN },
    ],
  },
  {
    id: 'duviri',
    location: 'Duviri',
    epoch: 1766138452676,
    phases: [
      { name: 'Joy', durationMs: 120 * MIN },
      { name: 'Anger', durationMs: 120 * MIN },
      { name: 'Envy', durationMs: 120 * MIN },
      { name: 'Sorrow', durationMs: 120 * MIN },
      { name: 'Fear', durationMs: 120 * MIN },
    ],
  },
]

/** Total length of one full rotation. */
export function cyclePeriod(cycle: WorldCycle): number {
  return cycle.phases.reduce((total, phase) => total + phase.durationMs, 0)
}

/**
 * Where a cycle stands at `now`.
 *
 * Two details that are easy to get wrong:
 *
 * - JavaScript's `%` keeps the sign of the dividend, so an epoch in the future — or a reader
 *   whose clock is behind one — would select a negative phase. The modulo is normalised.
 * - The phase is chosen with `delta < sum`, so the instant a phase's last millisecond elapses
 *   the next phase is reported with its full duration remaining. The wiki's gadget uses
 *   `sum >= delta` and reports the outgoing phase with 0 left for that one millisecond.
 */
export function phaseAt(cycle: WorldCycle, now: number): CyclePosition {
  const period = cyclePeriod(cycle)
  const delta = (((now - cycle.epoch) % period) + period) % period

  let sum = 0
  for (let index = 0; index < cycle.phases.length; index++) {
    const phase = cycle.phases[index]
    if (phase === undefined) break
    sum += phase.durationMs
    if (delta < sum) {
      const remainingMs = sum - delta
      const next = cycle.phases[(index + 1) % cycle.phases.length]
      return {
        cycle,
        phase,
        index,
        // Every cycle has at least one phase, so the wrap-around always resolves; the
        // fallback exists only because the index signature cannot know that.
        next: next ?? phase,
        remainingMs,
        endsAt: now + remainingMs,
      }
    }
  }

  // Unreachable: delta is always < period, and sum reaches period. Kept total rather than
  // throwing, because a world state widget must never be the thing that breaks the page.
  const phase = cycle.phases[0]
  if (phase === undefined) throw new Error(`cycle ${cycle.id} has no phases`)
  return { cycle, phase, index: 0, next: phase, remainingMs: 0, endsAt: now }
}

/** Every cycle at once, in the order they are declared. */
export function allPhasesAt(now: number): CyclePosition[] {
  return WORLD_CYCLES.map((cycle) => phaseAt(cycle, now))
}
