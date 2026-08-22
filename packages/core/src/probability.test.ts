import { describe, expect, it } from 'vitest'
import {
  REFINEMENT_TABLE,
  atLeastOnce,
  composeThroughRelic,
  expectedRuns,
  perRunChance,
  refinementRowTotal,
  runsForConfidence,
  shareChance,
} from './probability'

/**
 * Expected values below are hand-computed and the working is shown, per CLAUDE.md's
 * definition of done. If one of these fails, check the arithmetic in the comment before
 * assuming the test is stale.
 */

describe('refinement table', () => {
  it('every row sums to 100% within the pipeline gate tolerance', () => {
    // 3 common + 2 uncommon + 1 rare slot per relic.
    // intact:  3(0.2533) + 2(0.1100) + 0.02 = 0.7599 + 0.2200 + 0.02 = 0.9999
    // radiant: 3(0.1667) + 2(0.2000) + 0.10 = 0.5001 + 0.4000 + 0.10 = 1.0001
    for (const [refinement, row] of Object.entries(REFINEMENT_TABLE)) {
      expect(refinementRowTotal(row), refinement).toBeCloseTo(1, 3)
    }
  })

  it('rare odds rise and common odds fall as refinement increases', () => {
    expect(REFINEMENT_TABLE.intact.rare).toBe(0.02)
    expect(REFINEMENT_TABLE.radiant.rare).toBe(0.1)
    expect(REFINEMENT_TABLE.radiant.common).toBeLessThan(REFINEMENT_TABLE.intact.common)
  })
})

describe('perRunChance', () => {
  it('is the raw chance when a run yields a single event', () => {
    expect(perRunChance({ chance: 0.125 })).toBe(0.125)
  })

  it('compounds across multiple events without ever exceeding 1', () => {
    // 1 - (1 - 0.1)^4 = 1 - 0.9^4 = 1 - 0.6561 = 0.3439
    expect(perRunChance({ chance: 0.1, eventsPerRun: 4 })).toBeCloseTo(0.3439, 6)
    // The naive chance * events would give 2.0 here, which is not a probability.
    expect(perRunChance({ chance: 0.5, eventsPerRun: 4 })).toBeCloseTo(0.9375, 6)
    expect(perRunChance({ chance: 0.5, eventsPerRun: 4 })).toBeLessThanOrEqual(1)
  })

  it('handles the degenerate ends', () => {
    expect(perRunChance({ chance: 0, eventsPerRun: 10 })).toBe(0)
    expect(perRunChance({ chance: 1, eventsPerRun: 3 })).toBe(1)
  })
})

describe('expectedRuns', () => {
  it('is the reciprocal for a plain geometric wait', () => {
    // A rare at intact: 1 / 0.02 = 50
    expect(expectedRuns(0.02)).toBe(50)
    expect(expectedRuns(0.1)).toBeCloseTo(10, 10)
  })

  it('is Infinity at zero so callers must handle unobtainable explicitly', () => {
    expect(expectedRuns(0)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('runsForConfidence', () => {
  it('matches the hand-computed 95% threshold for a 2% drop', () => {
    // n = ceil( ln(0.05) / ln(0.98) ) = ceil( -2.995732 / -0.020203 ) = ceil(148.28) = 149
    // check: 1 - 0.98^148 = 0.94976 (short), 1 - 0.98^149 = 0.95075 (clears)
    expect(runsForConfidence(0.02)).toBe(149)
    expect(atLeastOnce(0.02, 148)).toBeLessThan(0.95)
    expect(atLeastOnce(0.02, 149)).toBeGreaterThanOrEqual(0.95)
  })

  it('shows the gap against the mean that players misjudge', () => {
    // Mean is 50 runs, but 95% confidence needs 149 — roughly 3x.
    expect(runsForConfidence(0.02)).toBeGreaterThan(expectedRuns(0.02) * 2.9)
  })

  it('needs a single run once the drop is guaranteed', () => {
    expect(runsForConfidence(1)).toBe(1)
  })
})

describe('shareChance', () => {
  it('reproduces the headline radshare number from the design doc', () => {
    // A rare at Radiant is 10% solo. Four players: 1 - 0.9^4 = 0.3439 -> 34.4%
    expect(shareChance(0.1, 1)).toBeCloseTo(0.1, 10)
    expect(shareChance(0.1, 4)).toBeCloseTo(0.3439, 6)
  })

  it('returns zero for an empty squad', () => {
    expect(shareChance(0.1, 0)).toBe(0)
  })
})

describe('composeThroughRelic', () => {
  it('multiplies the two independent hops', () => {
    // Hepit drops Lith B4 at 12.5%; the rare inside at Radiant is 10%.
    // 0.125 * 0.10 = 0.0125 -> 1.25% per Hepit run, i.e. 80 runs expected.
    const p = composeThroughRelic(0.125, 0.1)
    expect(p).toBeCloseTo(0.0125, 10)
    expect(expectedRuns(p)).toBeCloseTo(80, 6)
  })
})
