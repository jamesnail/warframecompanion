import { describe, expect, it } from 'vitest'

import { itemIdFor, parseRewardName, relicDisplayName, slug } from './slug'
import { scaleQuantity } from './upstream'

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

describe('parseRewardName quantity', () => {
  it('lifts an explicit NX count out of the name', () => {
    expect(parseRewardName('100X Plastids')).toEqual({ name: 'Plastids', quantity: 100 })
    expect(parseRewardName('10X Corrupted Holokey')).toEqual({
      name: 'Corrupted Holokey',
      quantity: 10,
    })
  })

  it('handles thousands separators and a lowercase x', () => {
    expect(parseRewardName('1,200x Kuva')).toEqual({ name: 'Kuva', quantity: 1200 })
    expect(parseRewardName('1000X Nano Spores')).toEqual({ name: 'Nano Spores', quantity: 1000 })
  })

  it('collapses every variant onto one id', () => {
    const ids = ['100X Plastids', '10X Plastids', '350X Plastids', 'Plastids'].map(itemIdFor)
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toBe('plastids')
  })

  // A bare leading number is opt-in per noun, because stripping it blindly invents facts.
  it('treats a bare number as a count only for currencies', () => {
    expect(parseRewardName('100 Endo')).toEqual({ name: 'Endo', quantity: 100 })
    expect(parseRewardName('15,000 Credits')).toEqual({ name: 'Credits', quantity: 15000 })
  })

  it('leaves a cache alone — the number is its contents, not how many caches', () => {
    expect(parseRewardName('1,500 Credits Cache')).toEqual({ name: '1,500 Credits Cache' })
    expect(parseRewardName('10,000 Höllars Cache')).toEqual({ name: '10,000 Höllars Cache' })
  })

  it('leaves a booster alone — the number is part of its name', () => {
    expect(parseRewardName('3 Day Affinity Booster')).toEqual({ name: '3 Day Affinity Booster' })
    expect(parseRewardName('3 Day Resource Drop Chance Booster').quantity).toBeUndefined()
  })

  it('does not mistake an ordinary name for a count', () => {
    expect(parseRewardName('Braton Prime Barrel')).toEqual({ name: 'Braton Prime Barrel' })
    expect(parseRewardName('Forma Blueprint').quantity).toBeUndefined()
  })
})

describe('scaleQuantity', () => {
  it('leaves the range alone when the name carried no count', () => {
    expect(scaleQuantity([1, 1], undefined)).toEqual([1, 1])
    expect(scaleQuantity([2, 3], undefined)).toEqual([2, 3])
  })

  // Upstream expresses "guaranteed, more than once" as a chance above 100%. That count and
  // the name's count are independent, so they multiply: two drops of a hundred is 200.
  it('multiplies a chance-derived multiple by the per-drop count', () => {
    expect(scaleQuantity([2, 2], 100)).toEqual([200, 200])
    expect(scaleQuantity([1, 2], 10)).toEqual([10, 20])
  })
})
