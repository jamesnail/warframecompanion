import { describe, expect, it } from 'vitest'

import { parseQuery } from './grammar'
import { QUERY_EXAMPLES, activeToken, suggest } from './suggest'

describe('activeToken', () => {
  it('reads the token under the caret, not the whole input', () => {
    expect(activeToken('is:prime cat:war', 16)).toEqual({ text: 'cat:war', start: 9 })
    expect(activeToken('braton ', 7)).toEqual({ text: '', start: 7 })
  })
})

describe('suggest', () => {
  it('offers keys until a colon is typed', () => {
    expect(suggest('c').map((s) => s.label)).toEqual(['cat:', 'chance:'])
  })

  it('offers that key values after the colon', () => {
    expect(suggest('tier:').map((s) => s.label)).toContain('neo')
    expect(suggest('tier:n').map((s) => s.label)).toEqual(['neo'])
  })

  it('offers nothing for a free-text key, where a list would be wrong or enormous', () => {
    expect(suggest('planet:')).toEqual([])
    expect(suggest('source:')).toEqual([])
  })

  it('keeps a leading minus on what it inserts', () => {
    expect(suggest('-is:va')[0]?.insert).toBe('-is:vaulted')
  })

  it('offers nothing for an unknown key', () => {
    expect(suggest('colour:g')).toEqual([])
  })
})

describe('QUERY_EXAMPLES', () => {
  it('every example parses without error', () => {
    // An example that does not parse is worse than no example: it is the first thing a
    // reader tries, and it teaches them the syntax is broken.
    for (const example of QUERY_EXAMPLES) {
      expect(parseQuery(example.query).errors, example.query).toEqual([])
    }
  })
})
