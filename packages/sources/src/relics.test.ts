import { describe, expect, it } from 'vitest'
import { deriveRarity, parseRelics, parseRefinement, parseTier, tryDeriveRarity } from './relics'
import { normalizeChance } from './upstream'
import { relicDisplayName, relicItemId } from './slug'

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

  // Superseded 2026-08-25. 9.5% used to be special-cased to "rare" for Requiem ETERNA's
  // sake, which was wrong twice over: ETERNA's eight slots are all 9.5%, so none of them is
  // a rare tier, and the special case let a relic with no 3/2/1 structure through the
  // parser. ETERNA is now excluded on shape and 9.5% is simply off-table.
  it('does not special-case ETERNA-style flat odds', () => {
    expect(() => deriveRarity('intact', 0.095)).toThrow(/does not match any intact rarity tier/)
    expect(tryDeriveRarity('intact', 0.095)).toBeUndefined()
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

describe('relicDisplayName', () => {
  it('reverses relicItemId back into the game\u2019s own name', () => {
    expect(relicDisplayName(relicItemId('Axi', 'A1'), 'Axi')).toBe('Axi A1 Relic')
    expect(relicDisplayName(relicItemId('Lith', 'B4'), 'Lith')).toBe('Lith B4 Relic')
    expect(relicDisplayName(relicItemId('Meso', 'V13'), 'Meso')).toBe('Meso V13 Relic')
  })

  it('matters because a vaulted relic has no other source of a name', () => {
    // 729 of 793 relic pages were headed "axi-a1-relic" before this existed: only relics
    // currently in rotation are named by whatever drops them.
    expect(relicDisplayName('axi-a1-relic', 'Axi')).not.toMatch(/-/)
  })

  it('does not strip a tier name that recurs inside the code', () => {
    // "Lith L1" — the leading tier prefix must be removed once, not everywhere.
    expect(relicDisplayName(relicItemId('Lith', 'L1'), 'Lith')).toBe('Lith L1 Relic')
  })
})


/**
 * Which relics get modelled is decided by SHAPE, not tier. The previous allowlist of
 * Lith/Meso/Neo/Axi excluded Requiem and Vanguard on the belief that they used eight
 * equally-weighted slots. Only ETERNA does; the rest are ordinary 3/2/1 tables, and
 * excluding Vanguard silently dropped four relics' worth of prime-part sources.
 */
describe('parseRelics structural inclusion', () => {
  const standard = (tier: string, relicName: string) => ({
    tier,
    relicName,
    state: 'Intact',
    rewards: [
      { itemName: 'Common A', chance: 25.33, rarity: 'Uncommon' },
      { itemName: 'Common B', chance: 25.33, rarity: 'Uncommon' },
      { itemName: 'Common C', chance: 25.33, rarity: 'Uncommon' },
      { itemName: 'Uncommon A', chance: 11, rarity: 'Uncommon' },
      { itemName: 'Uncommon B', chance: 11, rarity: 'Uncommon' },
      { itemName: 'Rare A', chance: 2, rarity: 'Rare' },
    ],
  })

  it('accepts Requiem and Vanguard when their shape is standard', () => {
    const { relics, nonStandard } = parseRelics([
      standard('Requiem', 'I'),
      standard('Vanguard', 'C1'),
      standard('Lith', 'A1'),
    ] as never)

    expect(nonStandard).toBe(0)
    expect(relics.map((relic) => relic.id).sort()).toEqual([
      'lith-a1-relic',
      'requiem-i-relic',
      'vanguard-c1-relic',
    ])
  })

  it('derives 3/2/1 rarities for an included Requiem relic', () => {
    const [relic] = parseRelics([standard('Requiem', 'I')] as never).relics
    const tally = { common: 0, uncommon: 0, rare: 0 }
    for (const reward of relic?.rewards ?? []) tally[reward.rarity]++
    expect(tally).toEqual({ common: 3, uncommon: 2, rare: 1 })
  })

  it('excludes ETERNA, whose eight flat slots are not a 3/2/1 table', () => {
    const eterna = {
      tier: 'Requiem',
      relicName: 'ETERNA',
      state: 'Intact',
      rewards: Array.from({ length: 8 }, (_, i) => ({
        itemName: `Requiem Mod ${String(i)}`,
        chance: 9.5,
        rarity: 'Rare',
      })),
    }
    const { relics, nonStandard, nonStandardNames } = parseRelics([eterna] as never)
    expect(relics).toHaveLength(0)
    expect(nonStandard).toBe(1)
    expect(nonStandardNames).toEqual(['Requiem ETERNA'])
  })

  // On-table chances in the wrong proportions must fail too — the count is what the
  // refinement math depends on, not merely that each chance is recognisable.
  it('excludes a relic whose slots are on-table but not 3/2/1', () => {
    const lopsided = {
      tier: 'Lith',
      relicName: 'X1',
      state: 'Intact',
      rewards: [
        { itemName: 'A', chance: 25.33, rarity: 'Uncommon' },
        { itemName: 'B', chance: 25.33, rarity: 'Uncommon' },
        { itemName: 'C', chance: 11, rarity: 'Uncommon' },
        { itemName: 'D', chance: 2, rarity: 'Rare' },
      ],
    }
    expect(parseRelics([lopsided] as never).nonStandard).toBe(1)
  })
})
