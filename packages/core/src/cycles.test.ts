import { describe, expect, it } from 'vitest'

import { WORLD_CYCLES, allPhasesAt, cyclePeriod, phaseAt, type WorldCycle } from './cycles'

function cycle(id: string): WorldCycle {
  const found = WORLD_CYCLES.find((c) => c.id === id)
  if (found === undefined) throw new Error(`no cycle ${id}`)
  return found
}

const cetus = cycle('cetus')
const cambion = cycle('cambion')
const vallis = cycle('vallis')
const duviri = cycle('duviri')

// Hand-computed from the constants, not read back off the implementation.
const CETUS_DAY = 100 * 60 * 1000 - 1126 // 5,998,874
const CETUS_NIGHT = 50 * 60 * 1000 // 3,000,000
const CETUS_PERIOD = CETUS_DAY + CETUS_NIGHT // 8,998,874

describe('cyclePeriod', () => {
  it('sums the phases', () => {
    expect(cyclePeriod(cetus)).toBe(8_998_874)
    expect(cyclePeriod(vallis)).toBe(1_600_000)
    expect(cyclePeriod(duviri)).toBe(36_000_000)
  })
})

describe('phaseAt', () => {
  it('starts phase[0] exactly at the epoch, with its full duration left', () => {
    const at = phaseAt(cetus, cetus.epoch)
    expect(at.phase.name).toBe('Day')
    expect(at.index).toBe(0)
    expect(at.remainingMs).toBe(CETUS_DAY)
    expect(at.next.name).toBe('Night')
  })

  it('holds the phase until its final millisecond', () => {
    const at = phaseAt(cetus, cetus.epoch + CETUS_DAY - 1)
    expect(at.phase.name).toBe('Day')
    expect(at.remainingMs).toBe(1)
  })

  it('switches on the boundary rather than one millisecond late', () => {
    const at = phaseAt(cetus, cetus.epoch + CETUS_DAY)
    expect(at.phase.name).toBe('Night')
    expect(at.remainingMs).toBe(CETUS_NIGHT)
  })

  it('wraps to phase[0] after a full period', () => {
    const at = phaseAt(cetus, cetus.epoch + CETUS_PERIOD)
    expect(at.phase.name).toBe('Day')
    expect(at.remainingMs).toBe(CETUS_DAY)
  })

  it('reports the last phase for times before the epoch', () => {
    // JS `%` returns a negative remainder here; an unnormalised modulo would pick a
    // negative index and throw, or silently report the wrong phase.
    const at = phaseAt(cetus, cetus.epoch - 1)
    expect(at.phase.name).toBe('Night')
    expect(at.remainingMs).toBe(1)
  })

  it('is stable thousands of cycles out', () => {
    const at = phaseAt(cetus, cetus.epoch + CETUS_PERIOD * 2400 + CETUS_DAY + 1000)
    expect(at.phase.name).toBe('Night')
    expect(at.remainingMs).toBe(CETUS_NIGHT - 1000)
  })

  it('walks every Duviri mood in order', () => {
    const moods = ['Joy', 'Anger', 'Envy', 'Sorrow', 'Fear']
    for (let i = 0; i < moods.length; i++) {
      const at = phaseAt(duviri, duviri.epoch + i * 120 * 60 * 1000 + 5000)
      expect(at.phase.name).toBe(moods[i])
      expect(at.index).toBe(i)
    }
    // and back to the start
    expect(phaseAt(duviri, duviri.epoch + 5 * 120 * 60 * 1000 + 5000).phase.name).toBe('Joy')
  })

  it('gives Orb Vallis a short warm and a long cold', () => {
    expect(phaseAt(vallis, vallis.epoch).phase.name).toBe('Warm')
    expect(phaseAt(vallis, vallis.epoch).remainingMs).toBe(400_000)
    expect(phaseAt(vallis, vallis.epoch + 400_000).phase.name).toBe('Cold')
    expect(phaseAt(vallis, vallis.epoch + 400_000).remainingMs).toBe(1_200_000)
  })

  it('locks Cambion Drift to the Plains', () => {
    // Fass runs with Day and Vome with Night. Same epoch, same lengths — asserted across a
    // spread of instants rather than one, so a divergent epoch could not slip through.
    for (const offset of [0, 1_000_000, CETUS_DAY, CETUS_DAY + 1, CETUS_PERIOD * 37 + 12_345]) {
      const plains = phaseAt(cetus, cetus.epoch + offset)
      const drift = phaseAt(cambion, cetus.epoch + offset)
      expect(drift.index).toBe(plains.index)
      expect(drift.remainingMs).toBe(plains.remainingMs)
    }
  })

  it('never reports more time left than the phase is long', () => {
    for (const c of WORLD_CYCLES) {
      for (const offset of [0, 1, 999, 123_456, 7_200_000, 8_998_873]) {
        const at = phaseAt(c, c.epoch + offset)
        expect(at.remainingMs).toBeGreaterThan(0)
        expect(at.remainingMs).toBeLessThanOrEqual(at.phase.durationMs)
      }
    }
  })
})

describe('provenance', () => {
  /**
   * The epochs are transcribed from the wiki, so this pins the one moment they were checked
   * against DE's own data. If someone "tidies" the -1126 into a round 150 minutes, or edits
   * an epoch, this fails — the whole point of the odd constant is that it is measured.
   *
   * DE published a bounty rotation expiring at 1787826155686 (2026-08-27T10:22:35.686Z) via
   * oracle.browse.wf/bounty-cycle. Bounties turn over on the same 150-minute boundary as the
   * Cetus cycle, so the cycle's own boundary must land on the same instant.
   */
  it('predicts the bounty boundary DE published on 2026-08-27', () => {
    const observedAt = Date.parse('2026-08-27T08:53:40.249Z')
    const dePublishedExpiry = 1_787_826_155_686

    const at = phaseAt(cetus, observedAt)
    // End of the current full rotation: the rest of Day, then all of Night.
    const rotationEnd =
      at.index === 0 ? at.endsAt + CETUS_NIGHT : at.endsAt

    expect(at.phase.name).toBe('Day')
    expect(Math.abs(rotationEnd - dePublishedExpiry)).toBeLessThan(15_000)
  })
})

describe('allPhasesAt', () => {
  it('returns one position per declared cycle, in order', () => {
    const all = allPhasesAt(Date.now())
    expect(all.map((p) => p.cycle.id)).toEqual(['cetus', 'cambion', 'vallis', 'duviri'])
  })

  it('excludes Zariman, whose published epoch is a phase out', () => {
    // Not an oversight — see the note in cycles.ts. Zariman comes from the live feed.
    expect(WORLD_CYCLES.some((c) => c.id === 'zariman')).toBe(false)
  })
})
