import { describe, expect, it } from 'vitest'

import { normalizeDisplayName } from './names'
import { slug } from './slug'

describe('normalizeDisplayName', () => {
  it('fixes the three tokens that actually occur upstream', () => {
    expect(normalizeDisplayName('Lavan Apoc Mk Ii')).toBe('Lavan Apoc Mk II')
    expect(normalizeDisplayName('Lavan Cryophon Mk Iii')).toBe('Lavan Cryophon Mk III')
    expect(normalizeDisplayName('Lavan Glazio Mk Iv')).toBe('Lavan Glazio Mk IV')
  })

  it('fixes a numeral in the middle of a name', () => {
    expect(normalizeDisplayName('Ekwana Ii Jai Blueprint')).toBe('Ekwana II Jai Blueprint')
    expect(normalizeDisplayName('Ekwana Jai Ii Blueprint')).toBe('Ekwana Jai II Blueprint')
  })

  it('leaves an already-correct name alone', () => {
    expect(normalizeDisplayName('Lavan Apoc Mk II')).toBe('Lavan Apoc Mk II')
    expect(normalizeDisplayName('Braton Prime Barrel')).toBe('Braton Prime Barrel')
  })

  // The reason this is an allowlist of whole tokens rather than a pattern.
  it('does not touch ordinary words that merely start with numeral letters', () => {
    expect(normalizeDisplayName('Ivara Prime Systems')).toBe('Ivara Prime Systems')
    expect(normalizeDisplayName('Xaku Prime Chassis')).toBe('Xaku Prime Chassis')
    expect(normalizeDisplayName('Vitality')).toBe('Vitality')
    expect(normalizeDisplayName('Ignis Wraith')).toBe('Ignis Wraith')
  })

  it('treats hyphens as boundaries without mangling hyphenated names', () => {
    expect(normalizeDisplayName('Mk1-Braton')).toBe('Mk1-Braton')
    expect(normalizeDisplayName('Kala-azar')).toBe('Kala-azar')
  })

  it('is idempotent', () => {
    const once = normalizeDisplayName('Lavan Talyn Mk Iv')
    expect(normalizeDisplayName(once)).toBe(once)
  })

  /**
   * The property that makes this safe to apply everywhere: ids are slugged lowercase, so
   * correcting the display name cannot change an id and cannot break a bookmarked URL.
   */
  it('never changes the slug it would produce', () => {
    for (const name of [
      'Lavan Apoc Mk Ii',
      'Ekwana Ii Jai Blueprint',
      'Eximus Eliminator Iv',
      'Braton Prime Barrel',
    ]) {
      expect(slug(normalizeDisplayName(name))).toBe(slug(name))
    }
  })
})
