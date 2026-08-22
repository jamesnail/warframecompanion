import { describe, expect, it } from 'vitest'
import { deriveRarity, parseRefinement, parseTier } from './relics'
import { normalizeChance } from './upstream'

/**
 * These lock in the workaround for the upstream defect described in relics.ts: the
 * `rarity` field is unusable, so rarity is derived from (state, chance).
 */

describe('deriveRarity', () => {
  it('maps each refinement row to the 3/2/1 structure', () => {
    expect(deriveRarity('intact', 0.2533)).toBe('common')
    expect(deriveRarity('intact', 0.11)).toBe('uncommon')
    expect(deriveRarity('intact', 0.02)).toBe('rare')

    expect(deriveRarity('radiant', 0.1667)).toBe('common')
    expect(deriveRarity('radiant', 0.2)).toBe('uncommon')
    expect(deriveRarity('radiant', 0.1)).toBe('rare')
  })

  it('resolves the 20% collision using the state', () => {
    // This is why chance alone is not a sufficient key: 20% is a COMMON slot on a
    // Flawless relic but an UNCOMMON slot on a Radiant one.
    expect(deriveRarity('flawless', 0.2)).toBe('common')
    expect(deriveRarity('radiant', 0.2)).toBe('uncommon')
  })

  it('treats the off-table Requiem rate as rare', () => {
    expect(deriveRarity('intact', 0.095)).toBe('rare')
  })

  it('rejects a chance that matches no tier, rather than guessing', () => {
    // A silent fallback here would ship wrong probabilities; DE changing the reward
    // table must fail the build instead.
    expect(() => deriveRarity('intact', 0.42)).toThrow(/does not match any intact rarity tier/)
  })
})

describe('parseTier', () => {
  it('accepts the tiers present in the live data, including Vanguard', () => {
    expect(parseTier('Lith')).toBe('Lith')
    expect(parseTier('Requiem')).toBe('Requiem')
    expect(parseTier('Vanguard')).toBe('Vanguard')
  })

  it('rejects an unknown tier', () => {
    expect(() => parseTier('Ultra')).toThrow(/Unknown relic tier/)
  })
})

describe('parseRefinement', () => {
  it('is case-insensitive over the four states', () => {
    expect(parseRefinement('Intact')).toBe('intact')
    expect(parseRefinement('RADIANT')).toBe('radiant')
  })

  it('rejects anything else', () => {
    expect(() => parseRefinement('Pristine')).toThrow(/Unknown relic refinement state/)
  })
})

describe('normalizeChance', () => {
  it('converts percent to a 0..1 float', () => {
    expect(normalizeChance(25.33)).toBeCloseTo(0.2533, 10)
    expect(normalizeChance(100)).toBe(1)
    expect(normalizeChance(0)).toBe(0)
  })

  it('salvages the malformed string form upstream has shipped', () => {
    // DESIGN.md 10.2 — chances have arrived as strings like "nce: 15.00".
    expect(normalizeChance('nce: 15.00')).toBeCloseTo(0.15, 10)
  })

  it('throws rather than defaulting to zero', () => {
    // A zeroed chance renders as "impossible", which is worse than a failed build.
    expect(() => normalizeChance('not a number')).toThrow(/Unparseable drop chance/)
    expect(() => normalizeChance(140)).toThrow(/outside 0\.\.100/)
  })
})
