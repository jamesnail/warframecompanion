import { describe, expect, it } from 'vitest'

import { isBreakable } from './tables'


describe('isBreakable', () => {
  it('recognises the containers upstream files as enemies', () => {
    expect(isBreakable('Rare Corpus Storage Container')).toBe(true)
    expect(isBreakable('Dusty Storage Crate')).toBe(true)
    expect(isBreakable('Zenith Granum Crown Cache')).toBe(true)
    expect(isBreakable('Narmer Cache')).toBe(true)
  })

  it('leaves things that are actually shot alone', () => {
    // A turret and a Raknoid are killed, not opened, however un-creaturely they look.
    expect(isBreakable('Corpus Mining Turret')).toBe(false)
    expect(isBreakable('Coolant Raknoid')).toBe(false)
    expect(isBreakable('Councilor Vay Hek')).toBe(false)
    // "Saturn Six Fugitive" contains no container word and must not be caught by a loose
    // match on "cache" or "crate".
    expect(isBreakable('Saturn Six Fugitive')).toBe(false)
  })
})
