import { describe, expect, it } from 'vitest'

import { itemIdFor, parseRewardName, relicDisplayName, slug } from './slug'

/**
 * parseRewardName exists because upstream encodes a drop's REFINEMENT in the reward's
 * name. Getting this wrong is not cosmetic: it mints a duplicate relic item that has drop
 * sources but no contents, and takes those sources away from the real relic's page.
 */
describe('parseRewardName', () => {
  it('splits a pre-refined relic into its base name and refinement', () => {
    expect(parseRewardName('Lith A12 Relic (Radiant)')).toEqual({
      name: 'Lith A12 Relic',
      refinement: 'radiant',
    })
  })

  it('handles every refinement level, case-insensitively', () => {
    for (const [raw, expected] of [
      ['Axi A21 Relic (Intact)', 'intact'],
      ['Meso V13 Relic (exceptional)', 'exceptional'],
      ['Neo C7 Relic (FLAWLESS)', 'flawless'],
      ['Lith G14 Relic (Radiant)', 'radiant'],
    ] as const) {
      expect(parseRewardName(raw).refinement).toBe(expected)
    }
  })

  it('leaves an ordinary reward name completely alone', () => {
    expect(parseRewardName('Braton Prime Barrel')).toEqual({ name: 'Braton Prime Barrel' })
    expect(parseRewardName('Lith A12 Relic')).toEqual({ name: 'Lith A12 Relic' })
  })

  // The parenthesis is not a licence to strip any suffix. "(Steel Path)" and "(Hard)" are
  // real parts of a source's identity and several rewards genuinely carry brackets.
  it('does not strip parentheses that are not a refinement', () => {
    expect(parseRewardName('Endless: Tier 1 (Hard)').name).toBe('Endless: Tier 1 (Hard)')
    expect(parseRewardName('Forma Blueprint (Radiant Nonsense)').name).toBe(
      'Forma Blueprint (Radiant Nonsense)',
    )
  })

  // "(Radiant)" only means a refinement on something that is actually a relic.
  it('ignores a refinement suffix on a non-relic', () => {
    expect(parseRewardName('Orokin Cell (Radiant)')).toEqual({ name: 'Orokin Cell (Radiant)' })
  })

  it('collapses the variant onto the base relic id', () => {
    expect(itemIdFor('Lith A12 Relic (Radiant)')).toBe(itemIdFor('Lith A12 Relic'))
    expect(itemIdFor('Lith A12 Relic (Radiant)')).toBe('lith-a12-relic')
  })
})

describe('slug and relicDisplayName round-trip', () => {
  it('turns a relic id back into its display name', () => {
    expect(relicDisplayName('axi-a21-relic', 'Axi')).toBe('Axi A21 Relic')
  })

  it('slugs are stable public identity, so punctuation is normalised', () => {
    expect(slug("Kasio's Rest")).toBe('kasios-rest')
    expect(slug('Ash & Smoke')).toBe('ash-and-smoke')
  })
})
