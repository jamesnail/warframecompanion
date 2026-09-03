import { describe, expect, it } from 'vitest'
import {
  REFINEMENT_TABLE,
  atLeastOnce,
  bestRefinementFor,
  chancesByRefinement,
  composeThroughRelic,
  relicsNeeded,
  expectedRuns,
  expectedYield,
  perRunChance,
  refinementRowTotal,
  runsForConfidence,
  runsForRelicPath,
  shareChance,
} from './probability'
import { stageLabel } from './stages'

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

describe('runsForRelicPath', () => {
  it('reduces to 1/(relic × reward) when solo', () => {
    // Apollo drops Axi P10 at 14.29%; a common reward at Radiant is 16.67%.
    // 1 / (0.1429 × 0.1667) = 41.98
    expect(runsForRelicPath(0.1429, 0.1667, 1)).toBeCloseTo(41.98, 1)
  })

  it('shows the radshare gap, which is the whole point', () => {
    // Four players each open their own relic, squad takes the best.
    //   per round = 1 - (1 - 0.1667)^4 = 0.5178
    //   rounds    = 1 / 0.5178          = 1.931
    //   runs/relic= 1 / 0.1429          = 6.998
    //   total     = 1.931 × 6.998       = 13.52
    expect(runsForRelicPath(0.1429, 0.1667, 4)).toBeCloseTo(13.52, 1)
    // Roughly a third of the solo effort.
    const solo = runsForRelicPath(0.1429, 0.1667, 1)
    expect(runsForRelicPath(0.1429, 0.1667, 4)).toBeLessThan(solo / 3)
  })

  it('is Infinity when either hop is impossible', () => {
    expect(runsForRelicPath(0, 0.1667, 4)).toBe(Number.POSITIVE_INFINITY)
    expect(runsForRelicPath(0.1429, 0, 4)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('stageLabel', () => {
  it('calls rotations rotations', () => {
    expect(stageLabel('Survival', 'C')).toBe('Rotation C')
    expect(stageLabel('Defense', 'A')).toBe('Rotation A')
  })

  it('does not call a cache or a vault a rotation', () => {
    // Upstream keys these A/B/C too, but they are the 1st/2nd/3rd cache and the three
    // Spy vaults — calling them rotations misdescribes how the mission works.
    expect(stageLabel('Caches', 'C')).toBe('Cache C')
    expect(stageLabel('Spy', 'B')).toBe('Vault B')
  })

  it('is absent when there is no stage at all', () => {
    expect(stageLabel('Capture', null)).toBeUndefined()
    expect(stageLabel('Capture', undefined)).toBeUndefined()
  })
})

describe('bestRefinementFor', () => {
  it('picks Intact for commons, not Radiant', () => {
    // The counter-intuitive one, and the reason this function exists: refining trades
    // common odds away. 25.33% intact against 16.67% radiant.
    const best = bestRefinementFor('common')
    expect(best.refinement).toBe('intact')
    expect(best.chance).toBeCloseTo(0.2533, 6)
    expect(best.chance).toBeGreaterThan(REFINEMENT_TABLE.radiant.common)
  })

  it('picks Radiant for uncommon and rare', () => {
    expect(bestRefinementFor('uncommon')).toMatchObject({ refinement: 'radiant' })
    expect(bestRefinementFor('rare')).toMatchObject({ refinement: 'radiant' })
    // Radiant is a 5x improvement on a rare — 2% to 10%.
    expect(bestRefinementFor('rare').chance).toBeCloseTo(0.1, 6)
  })
})

describe('relicsNeeded', () => {
  it('is the reciprocal of the per-relic chance when solo', () => {
    // A common at Intact: 1 / 0.2533 = 3.95 relics.
    expect(relicsNeeded(0.2533, 1)).toBeCloseTo(3.95, 2)
    // A rare at Radiant: 1 / 0.10 = 10 relics.
    expect(relicsNeeded(0.1, 1)).toBeCloseTo(10, 6)
  })

  it('falls sharply in a share', () => {
    // Rare at Radiant across four players: 1 / (1 - 0.9^4) = 1 / 0.3439 = 2.91
    expect(relicsNeeded(0.1, 4)).toBeCloseTo(2.91, 2)
  })

  it('shows radiant-ing a common is a downgrade', () => {
    // 4 relics at Intact versus 6 at Radiant — the mistake the old UI recommended.
    expect(relicsNeeded(REFINEMENT_TABLE.intact.common, 1)).toBeLessThan(
      relicsNeeded(REFINEMENT_TABLE.radiant.common, 1),
    )
  })
})

describe('float exactness at one trial', () => {
  it('atLeastOnce(p, 1) is exactly p', () => {
    // 1 - (1 - 0.1)^1 is 0.09999999999999998 in binary floating point. The 2-ulp error
    // propagated into relicsNeeded and a UI Math.ceil turned "10 relics" into "11".
    expect(atLeastOnce(0.1, 1)).toBe(0.1)
    expect(atLeastOnce(0.2, 1)).toBe(0.2)
  })

  it('relicsNeeded is exact for the rates the UI actually shows', () => {
    // Radiant rare 10% -> 10 relics; Radiant uncommon 20% -> 5. Both must survive Math.ceil.
    expect(Math.ceil(relicsNeeded(0.1, 1))).toBe(10)
    expect(Math.ceil(relicsNeeded(0.2, 1))).toBe(5)
    expect(Math.ceil(relicsNeeded(REFINEMENT_TABLE.radiant.rare, 1))).toBe(10)
    expect(Math.ceil(relicsNeeded(REFINEMENT_TABLE.radiant.uncommon, 1))).toBe(5)
  })
})

describe('chancesByRefinement', () => {
  it('returns all four levels in upgrade order', () => {
    expect(chancesByRefinement('rare').map((r) => r.refinement)).toEqual([
      'intact',
      'exceptional',
      'flawless',
      'radiant',
    ])
  })

  // Hand-checked against REFINEMENT_TABLE: refining a RARE is a straight upgrade...
  it('rises monotonically for rare rewards', () => {
    expect(chancesByRefinement('rare').map((r) => r.chance)).toEqual([0.02, 0.04, 0.06, 0.1])
  })

  // ...while refining for a COMMON actively makes it worse. This is the direction that
  // surprises people, and the reason the UI shows the whole row rather than the best cell.
  it('falls monotonically for common rewards', () => {
    expect(chancesByRefinement('common').map((r) => r.chance)).toEqual([
      0.2533, 0.2333, 0.2, 0.1667,
    ])
  })

  it('agrees with bestRefinementFor on which level wins', () => {
    for (const rarity of ['common', 'uncommon', 'rare'] as const) {
      const row = chancesByRefinement(rarity)
      const top = row.reduce((a, b) => (b.chance > a.chance ? b : a))
      expect(top.refinement).toBe(bestRefinementFor(rarity).refinement)
      expect(top.chance).toBe(bestRefinementFor(rarity).chance)
    }
  })
})

describe('expectedYield', () => {
  const edge = (chance: number, quantity: [number, number], eventsPerRun?: number) =>
    eventsPerRun === undefined ? { chance, quantity } : { chance, quantity, eventsPerRun }

  it('is units, not odds — the whole point of having it', () => {
    // 350 Plastids at 4% beats 10 at 20%, which a chance ranking gets backwards.
    expect(expectedYield(edge(0.04, [350, 350]))).toBeCloseTo(14, 10)
    expect(expectedYield(edge(0.2, [10, 10]))).toBeCloseTo(2, 10)
  })

  it('takes the mean of DE own min/max stack', () => {
    expect(expectedYield(edge(0.5, [10, 30]))).toBeCloseTo(10, 10)
  })

  it('multiplies by events rather than capping at one, unlike perRunChance', () => {
    // Four cache rolls at 100% for 80 Endo is 320 Endo a run. The complement form used by
    // perRunChance would answer 1 here, which is right for "did I get any" and wrong for
    // "how much".
    expect(expectedYield(edge(1, [80, 80], 4))).toBe(320)
    expect(perRunChance(edge(1, [80, 80], 4))).toBe(1)
  })

  it('is zero for an impossible drop rather than NaN', () => {
    expect(expectedYield(edge(0, [100, 100]))).toBe(0)
  })

  it('treats a single-unit edge as its plain chance', () => {
    expect(expectedYield(edge(0.25, [1, 1]))).toBeCloseTo(0.25, 10)
  })
})
