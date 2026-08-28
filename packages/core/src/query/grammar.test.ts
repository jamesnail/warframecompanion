import { describe, expect, it } from 'vitest'

import { parseQuery, printQuery, queryWords } from './grammar'

describe('parseQuery', () => {
  it('reads bare words as lowercased word terms', () => {
    const { query, errors } = parseQuery('Braton Prime')
    expect(errors).toEqual([])
    expect(query.terms).toEqual([
      { type: 'word', negated: false, text: 'braton' },
      { type: 'word', negated: false, text: 'prime' },
    ])
  })

  it('reads a predicate and lowercases its value', () => {
    const { query, errors } = parseQuery('cat:Warframe')
    expect(errors).toEqual([])
    expect(query.terms).toEqual([
      { type: 'predicate', negated: false, key: 'cat', value: { kind: 'text', text: 'warframe' } },
    ])
  })

  it('reads a leading minus as negation, on both term kinds', () => {
    const { query } = parseQuery('-braton -is:vaulted')
    expect(query.terms.map((term) => term.negated)).toEqual([true, true])
  })

  it('parses comparisons on numeric keys', () => {
    const { query, errors } = parseQuery('chance:>=5 mr:<8')
    expect(errors).toEqual([])
    expect(query.terms).toEqual([
      {
        type: 'predicate',
        negated: false,
        key: 'chance',
        value: { kind: 'compare', compare: { op: '>=', value: 5 } },
      },
      {
        type: 'predicate',
        negated: false,
        key: 'mr',
        value: { kind: 'compare', compare: { op: '<', value: 8 } },
      },
    ])
  })

  it('keeps a quoted phrase together, spaces and all', () => {
    const { query, errors } = parseQuery('source:"Plains of Eidolon"')
    expect(errors).toEqual([])
    expect(query.terms).toEqual([
      {
        type: 'predicate',
        negated: false,
        key: 'source',
        value: { kind: 'text', text: 'plains of eidolon' },
      },
    ])
  })

  it('treats a colon inside a quoted phrase as content, not a separator', () => {
    const { query } = parseQuery('"Rotation C: Stage 3"')
    expect(query.terms).toEqual([
      { type: 'word', negated: false, text: 'rotation c: stage 3' },
    ])
  })

  describe('errors', () => {
    it('rejects an unknown key rather than ignoring it', () => {
      // The failure mode this exists to prevent: an unrecognised key evaluating to "no
      // constraint" and handing back the whole corpus, looking like a successful search.
      const { query, errors } = parseQuery('colour:gold')
      expect(query.terms).toEqual([])
      expect(errors[0]?.kind).toBe('unknown-key')
      expect(errors[0]?.message).toContain('colour')
    })

    it('suggests the nearest key', () => {
      expect(parseQuery('planett:earth').errors[0]?.suggestion).toBe('planet')
      expect(parseQuery('categ:mod').errors[0]?.suggestion).toBe('cat')
    })

    it('suggests the nearest value from a closed space', () => {
      const { errors } = parseQuery('from:relicc')
      expect(errors[0]?.kind).toBe('unknown-value')
      expect(errors[0]?.suggestion).toBe('relic')
    })

    it('offers no suggestion when nothing is close', () => {
      expect(parseQuery('from:zzzzzzzz').errors[0]?.suggestion).toBeUndefined()
    })

    it('reports a key with no value', () => {
      expect(parseQuery('cat:').errors[0]?.kind).toBe('empty-value')
    })

    it('reports a non-number on a numeric key', () => {
      expect(parseQuery('mr:banana').errors[0]?.kind).toBe('bad-number')
    })

    it('reports an unterminated quote', () => {
      const { errors } = parseQuery('source:"Plains of')
      expect(errors.some((error) => error.kind === 'unterminated-quote')).toBe(true)
    })

    it('reports a dangling minus', () => {
      expect(parseQuery('-').errors[0]?.kind).toBe('dangling-negation')
    })

    it('keeps the good terms when one term is bad', () => {
      // Clearing the result set because a half-typed term is wrong punishes the reader
      // mid-keystroke for a query they have not finished.
      const { query, errors } = parseQuery('is:prime colour:gold cat:warframe')
      expect(errors).toHaveLength(1)
      expect(query.terms).toHaveLength(2)
    })

    it('points at the exact span of the bad token', () => {
      const input = 'is:prime colour:gold'
      const { errors } = parseQuery(input)
      const error = errors[0]
      expect(error).toBeDefined()
      expect(input.slice(error?.start, error?.end)).toBe('colour:gold')
    })
  })

  describe('adversarial input', () => {
    it.each([
      ['', 0],
      ['   ', 0],
      ['::', 0],
      [':::::', 0],
      ['-', 0],
      ['--', 0],
      ['""', 0],
      ['"', 0],
      // Not a category, so it is an unknown-value error rather than a term. The second colon
      // is not a syntax error — the value simply runs to the end of the token.
      ['cat:warframe:extra', 0],
    ])('survives %j', (input, terms) => {
      expect(() => parseQuery(input)).not.toThrow()
      expect(parseQuery(input).query.terms).toHaveLength(terms)
    })

    it('handles 500 terms without complaint', () => {
      const input = Array.from({ length: 500 }, (_, index) => `word${String(index)}`).join(' ')
      expect(parseQuery(input).query.terms).toHaveLength(500)
    })
  })
})

describe('printQuery', () => {
  it.each([
    'braton',
    'cat:warframe',
    'is:prime from:relic -is:vaulted',
    'chance:>5',
    'mr:<=8',
    '-braton',
    'source:"plains of eidolon"',
  ])('round-trips %j', (input) => {
    const first = parseQuery(input).query
    expect(printQuery(first)).toBe(input)
    // The real property: parsing the printed form yields the same tree.
    expect(parseQuery(printQuery(first)).query).toEqual(first)
  })

  it('quotes a value only when it needs quoting', () => {
    expect(printQuery(parseQuery('source:cambria').query)).toBe('source:cambria')
    expect(printQuery(parseQuery('source:"two words"').query)).toBe('source:"two words"')
  })
})

describe('queryWords', () => {
  it('returns positive bare words only, so a matcher can pre-filter with them', () => {
    expect(queryWords(parseQuery('braton prime -vandal cat:warframe').query)).toEqual([
      'braton',
      'prime',
    ])
  })
})
