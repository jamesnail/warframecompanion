import { describe, expect, it } from 'vitest'

import { applySuggestion, hasTerm, toggleTerm } from './query-text'

describe('hasTerm', () => {
  it('reads pressed state back out of the query text', () => {
    // The chips hold no state of their own, so typing a term by hand must light its chip.
    expect(hasTerm('is:prime cat:warframe', 'is:prime')).toBe(true)
    expect(hasTerm('is:prime', 'cat:warframe')).toBe(false)
  })

  it('does not confuse a term with its negation', () => {
    expect(hasTerm('-is:vaulted', 'is:vaulted')).toBe(false)
    expect(hasTerm('-is:vaulted', '-is:vaulted')).toBe(true)
  })

  it('compares comparisons by operator and value', () => {
    expect(hasTerm('chance:>5', 'chance:>5')).toBe(true)
    expect(hasTerm('chance:>5', 'chance:>10')).toBe(false)
    expect(hasTerm('chance:>5', 'chance:>=5')).toBe(false)
  })
})

describe('toggleTerm', () => {
  it('adds a term that is absent', () => {
    expect(toggleTerm('', 'is:prime')).toBe('is:prime')
    expect(toggleTerm('braton', 'cat:warframe')).toBe('braton cat:warframe')
  })

  it('removes a term that is present, leaving the rest in order', () => {
    expect(toggleTerm('braton is:prime cat:warframe', 'is:prime')).toBe('braton cat:warframe')
  })

  it('removes every copy', () => {
    // Typing a term twice and then clicking its chip should leave none behind.
    expect(toggleTerm('is:prime is:prime', 'is:prime')).toBe('')
  })

  it('round-trips: toggling twice returns the original', () => {
    const start = 'braton cat:warframe'
    expect(toggleTerm(toggleTerm(start, 'is:prime'), 'is:prime')).toBe(start)
  })

  it('preserves the rest of a query it cannot parse cleanly', () => {
    // A half-typed term must not be destroyed by clicking a chip.
    expect(toggleTerm('braton', 'is:prime')).toContain('braton')
  })
})

describe('applySuggestion', () => {
  it('replaces the token under the caret', () => {
    expect(applySuggestion('cat:war', 0, 7, 'cat:warframe')).toBe('cat:warframe ')
  })

  it('leaves a key open for its value, and closes a finished value', () => {
    // Picking `tier:` should let you keep typing; picking `neo` is done.
    expect(applySuggestion('ti', 0, 2, 'tier:')).toBe('tier:')
    expect(applySuggestion('tier:n', 0, 6, 'tier:neo')).toBe('tier:neo ')
  })

  it('keeps the terms around it', () => {
    expect(applySuggestion('is:prime cat:war', 9, 7, 'cat:warframe')).toBe('is:prime cat:warframe ')
  })
})
