import { describe, expect, it } from 'vitest'

import { rotationCycleCost } from './rotations'

/**
 * The AABC cycle is the difference between "a 20-minute Survival" and "a 5-minute
 * Survival" as the cost of a Rotation C reward. Getting it backwards would understate
 * roughly a third of the dataset by up to fourfold.
 */
describe('rotationCycleCost', () => {
  it('charges two intervals for A and four for B and C', () => {
    // Four intervals yield A, A, B, C.
    expect(rotationCycleCost('Survival', 'A')).toBe(2)
    expect(rotationCycleCost('Survival', 'B')).toBe(4)
    expect(rotationCycleCost('Survival', 'C')).toBe(4)
  })

  it('is 1 when there is no rotation at all', () => {
    expect(rotationCycleCost('Capture', null)).toBe(1)
    expect(rotationCycleCost('Capture', undefined)).toBe(1)
    expect(rotationCycleCost(undefined, 'C')).toBe(1)
  })

  it('does not charge a cycle for caches or spy vaults', () => {
    // Upstream keys these A/B/C too, but you get all three in one run — they are the
    // 1st/2nd/3rd cache and the three vaults, not reward rotations.
    expect(rotationCycleCost('Caches', 'C')).toBe(1)
    expect(rotationCycleCost('Spy', 'B')).toBe(1)
  })

  it('leaves unmodelled mission types untouched rather than guessing', () => {
    // Overstating effort on content we have not modelled would be a new error.
    expect(rotationCycleCost('Disruption', 'C')).toBe(1)
    expect(rotationCycleCost('The Circuit', 'C')).toBe(1)
    expect(rotationCycleCost('Some Future Mode', 'C')).toBe(1)
  })

  it('makes a Rotation C reward cost 4x a rotation-less one', () => {
    const c = rotationCycleCost('Defense', 'C')
    const none = rotationCycleCost('Capture', null)
    expect(c / none).toBe(4)
  })
})
