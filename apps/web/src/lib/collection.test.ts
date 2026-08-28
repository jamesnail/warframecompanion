import { describe, expect, it } from 'vitest'

import { byClosest, progressOf, type RecipeComponent } from './collection'
import { DEFAULT_SETTINGS } from '@provenance/core'

import { importedSettings, normalizeIds, normalizeImport, toExport } from './client/collection'

const BRATON: RecipeComponent[] = [
  { itemId: 'braton-prime-barrel', count: 1 },
  { itemId: 'braton-prime-receiver', count: 1 },
  { itemId: 'braton-prime-stock', count: 1 },
  { itemId: 'braton-prime-blueprint', count: 1 },
  { itemId: 'orokin-cell', count: 10 },
]

describe('progressOf', () => {
  it('is empty when nothing is owned', () => {
    const p = progressOf(BRATON, new Set())
    expect(p).toMatchObject({ owned: 0, total: 5, complete: false })
    expect(p.missing).toHaveLength(5)
  })

  // The rule the whole module exists for: ×10 Orokin Cell is ONE thing to go and get.
  it('counts distinct components, not units', () => {
    const p = progressOf(BRATON, new Set(['orokin-cell']))
    expect(p.owned).toBe(1)
    expect(p.total).toBe(5)
    expect(p.fraction).toBeCloseTo(0.2)
  })

  it('reports complete only when every component is owned', () => {
    const all = new Set(BRATON.map((c) => c.itemId))
    expect(progressOf(BRATON, all).complete).toBe(true)
    all.delete('orokin-cell')
    expect(progressOf(BRATON, all).complete).toBe(false)
  })

  it('lists what is missing in the recipe order', () => {
    const p = progressOf(BRATON, new Set(['braton-prime-receiver']))
    expect(p.missing).toEqual([
      'braton-prime-barrel',
      'braton-prime-stock',
      'braton-prime-blueprint',
      'orokin-cell',
    ])
  })

  it('ignores owned ids that are not part of this recipe', () => {
    expect(progressOf(BRATON, new Set(['something-else'])).owned).toBe(0)
  })

  it('does not divide by zero on an empty recipe', () => {
    expect(progressOf([], new Set())).toMatchObject({ fraction: 0, complete: false })
  })
})

describe('byClosest', () => {
  const entry = (name: string, owned: number, total: number) => ({
    name,
    progress: progressOf(
      Array.from({ length: total }, (_, i) => ({ itemId: `${name}-${String(i)}`, count: 1 })),
      new Set(Array.from({ length: owned }, (_, i) => `${name}-${String(i)}`)),
    ),
  })

  it('puts finished sets first and untouched sets last', () => {
    const sorted = [entry('untouched', 0, 4), entry('done', 3, 3), entry('half', 2, 4)].sort(byClosest)
    expect(sorted.map((e) => e.name)).toEqual(['done', 'half', 'untouched'])
  })

  it('prefers the higher fraction', () => {
    const sorted = [entry('quarter', 1, 4), entry('threequarters', 3, 4)].sort(byClosest)
    expect(sorted[0]?.name).toBe('threequarters')
  })

  it('breaks equal fractions on fewest remaining, then name', () => {
    // 1/2 and 2/4 are the same fraction; the one needing a single part is closer to done.
    const sorted = [entry('four', 2, 4), entry('two', 1, 2)].sort(byClosest)
    expect(sorted[0]?.name).toBe('two')
  })

  it('is a total order, so the list does not reshuffle between renders', () => {
    const list = [entry('b', 1, 2), entry('a', 1, 2), entry('c', 1, 2)]
    expect([...list].sort(byClosest).map((e) => e.name)).toEqual(
      [...list].reverse().sort(byClosest).map((e) => e.name),
    )
  })
})

describe('export and import', () => {
  it('round-trips through the export envelope', () => {
    const file = toExport({ owned: ['b', 'a'], tracked: ['z', 'y'] }, '2026-08-26T00:00:00.000Z')
    expect(file.owned).toEqual(['a', 'b'])
    expect(file.tracked).toEqual(['y', 'z'])
    expect(normalizeIds(file)).toEqual(['a', 'b'])
  })

  it('accepts a bare array, so a hand-edited file still imports', () => {
    expect(normalizeIds(['a', 'b'])).toEqual(['a', 'b'])
  })

  describe('settings in the backup', () => {
    const settings = { ...DEFAULT_SETTINGS, theme: 'grineer' as const, masteryRank: 14 }

    it('carries settings out and back', () => {
      const file = toExport({ owned: ['a'], tracked: [] }, '2026-08-28T00:00:00.000Z', settings)
      expect(file.version).toBe(3)
      expect(importedSettings(file)).toEqual(settings)
    })

    it('survives the JSON round trip a real file makes', () => {
      const file = toExport({ owned: ['a'], tracked: [] }, '2026-08-28T00:00:00.000Z', settings)
      expect(importedSettings(JSON.parse(JSON.stringify(file)))).toEqual(settings)
    })

    it('returns undefined for a version 2 file, which is NOT the same as defaults', () => {
      // A file that predates settings says nothing about preferences, and importing it must
      // leave the viewer's current theme alone rather than silently resetting it.
      const v2 = { format: 'provenance-collection', version: 2, owned: ['a'], tracked: [] }
      expect(importedSettings(v2)).toBeUndefined()
    })

    it('repairs a settings block that is partly nonsense', () => {
      const file = { owned: ['a'], settings: { theme: 'chartreuse', density: 'compact' } }
      expect(importedSettings(file)?.density).toBe('compact')
      expect(importedSettings(file)?.theme).toBe(DEFAULT_SETTINGS.theme)
    })

    it('ignores a settings field that is not an object', () => {
      expect(importedSettings({ owned: [], settings: 'compact' })).toBeUndefined()
    })
  })

  // An import that rejects a file the user cannot repair has destroyed their only backup.
  it('reads a newer version rather than refusing it', () => {
    expect(normalizeIds({ format: 'provenance-collection', version: 99, owned: ['a'] })).toEqual(['a'])
  })

  it('drops junk entries instead of throwing', () => {
    expect(normalizeIds({ owned: ['a', 2, null, '', 'b', 'a'] })).toEqual(['a', 'b'])
  })

  it('returns nothing for input that is not a collection at all', () => {
    expect(normalizeIds(null)).toEqual([])
    expect(normalizeIds({ nope: true })).toEqual([])
    expect(normalizeIds('a,b')).toEqual([])
  })
})

describe('normalizeImport', () => {
  it('reads both lists out of a version 2 file', () => {
    const file = toExport({ owned: ['a'], tracked: ['s'] }, '2026-08-27T00:00:00.000Z')
    expect(normalizeImport(file)).toEqual({ owned: ['a'], tracked: ['s'] })
  })

  it('imports a version 1 file, which had no farm list', () => {
    // The only backup a user made before tracking existed must still restore their items.
    const v1 = { format: 'provenance-collection', version: 1, owned: ['a', 'b'] }
    expect(normalizeImport(v1)).toEqual({ owned: ['a', 'b'], tracked: [] })
  })

  it('imports a bare array as the owned list', () => {
    expect(normalizeImport(['a'])).toEqual({ owned: ['a'], tracked: [] })
  })

  it('ignores a malformed tracked list rather than refusing the file', () => {
    expect(normalizeImport({ owned: ['a'], tracked: 'nonsense' })).toEqual({
      owned: ['a'],
      tracked: [],
    })
  })
})
