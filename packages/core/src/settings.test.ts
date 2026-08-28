import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS,
  MAX_MASTERY_RANK,
  THEMES,
  isDefaultSettings,
  normalizeSettings,
} from './settings'

describe('normalizeSettings', () => {
  it('reads a full, valid object', () => {
    const input = {
      theme: 'corpus',
      density: 'compact',
      motion: 'reduced',
      dropsOnly: true,
      masteryRank: 12,
      newPlayer: true,
    }
    expect(normalizeSettings(input)).toEqual(input)
  })

  it('falls back per FIELD, not wholesale', () => {
    // The case this exists for: a file written by a newer build with a theme this one has
    // never heard of must still restore the density and the mastery rank. Rejecting the whole
    // object would throw away preferences the user cannot recover.
    const out = normalizeSettings({ theme: 'chartreuse', density: 'compact', masteryRank: 7 })
    expect(out.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(out.density).toBe('compact')
    expect(out.masteryRank).toBe(7)
  })

  it.each([undefined, null, 42, 'compact', [], NaN])('survives %j', (input) => {
    expect(normalizeSettings(input)).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores unknown fields rather than failing on them', () => {
    expect(normalizeSettings({ theme: 'grineer', somethingElse: true }).theme).toBe('grineer')
  })

  it('rejects an out-of-range mastery rank', () => {
    expect(normalizeSettings({ masteryRank: -1 }).masteryRank).toBeNull()
    expect(normalizeSettings({ masteryRank: MAX_MASTERY_RANK + 1 }).masteryRank).toBeNull()
    expect(normalizeSettings({ masteryRank: 2.5 }).masteryRank).toBeNull()
  })

  it('keeps null as null — "not saying" is a real answer, not a missing 0', () => {
    expect(normalizeSettings({ masteryRank: null }).masteryRank).toBeNull()
    expect(normalizeSettings({ masteryRank: 0 }).masteryRank).toBe(0)
  })

  it('round-trips through JSON, which is how it is actually stored', () => {
    const settings = normalizeSettings({ theme: 'contrast', masteryRank: 30, newPlayer: true })
    expect(normalizeSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
  })
})

describe('isDefaultSettings', () => {
  it('is true for the defaults and false for any change', () => {
    expect(isDefaultSettings(DEFAULT_SETTINGS)).toBe(true)
    expect(isDefaultSettings({ ...DEFAULT_SETTINGS, theme: 'grineer' })).toBe(false)
    expect(isDefaultSettings({ ...DEFAULT_SETTINGS, masteryRank: 0 })).toBe(false)
  })
})

describe('THEMES', () => {
  it('every theme is a value the schema accepts', () => {
    for (const theme of THEMES) {
      expect(normalizeSettings({ theme: theme.id }).theme).toBe(theme.id)
    }
  })

  it('the default theme is one of them', () => {
    expect(THEMES.map((theme) => theme.id)).toContain(DEFAULT_SETTINGS.theme)
  })
})
