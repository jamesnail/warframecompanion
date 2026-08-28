import { describe, expect, it } from 'vitest'

import { compileQuery } from './evaluate'
import { parseQuery } from './grammar'
import type { QueryItem, QueryPath } from './types'

/**
 * Grain semantics and per-key behaviour, on hand-built fixtures.
 *
 * The counts against the real dataset live in `apps/web/src/lib/query-index.test.ts`, next to
 * the index builder that produces them — that is where "is:prime cat:warframe must be 50 and
 * not 0" is asserted.
 */

function item(overrides: Partial<QueryItem> = {}): QueryItem {
  return {
    id: 'ash-prime',
    name: 'Ash Prime',
    haystack: 'ash prime',
    category: 'Warframe',
    tradable: true,
    hasMarket: true,
    isPrime: true,
    isSet: true,
    masteryReq: undefined,
    vaulted: false,
    kinds: new Set(['relic']),
    planets: new Set<string>(),
    tiers: new Set(['axi']),
    rotations: new Set<string>(),
    sourceText: 'axi a1 relic',
    bestChance: 0.11,
    ...overrides,
  }
}

function path(overrides: Partial<QueryPath> = {}): QueryPath {
  return {
    itemName: 'Braton Prime Barrel',
    haystack: 'braton prime barrel · lith b4 relic',
    category: 'Component',
    tradable: true,
    hasMarket: true,
    isPrime: true,
    isSet: false,
    masteryReq: undefined,
    vaulted: false,
    kind: 'relic',
    planet: undefined,
    tier: 'lith',
    rotation: undefined,
    chance: 0.11,
    ...overrides,
  }
}

const matchItem = (query: string, subject: QueryItem): boolean =>
  compileQuery(parseQuery(query).query).matchItem(subject)

const matchPath = (query: string, subject: QueryPath): boolean =>
  compileQuery(parseQuery(query).query).matchPath(subject)

describe('compileQuery', () => {
  it('an empty query matches everything', () => {
    const compiled = compileQuery(parseQuery('').query)
    expect(compiled.size).toBe(0)
    expect(compiled.matchItem(item())).toBe(true)
    expect(compiled.matchPath(path())).toBe(true)
  })

  it('AND-s every term', () => {
    expect(matchItem('is:prime cat:warframe', item())).toBe(true)
    expect(matchItem('is:prime cat:melee', item())).toBe(false)
  })

  it('negates', () => {
    expect(matchItem('-is:vaulted', item({ vaulted: false }))).toBe(true)
    expect(matchItem('-is:vaulted', item({ vaulted: true }))).toBe(false)
  })

  it('matches bare words against the haystack, and can be told to skip them', () => {
    expect(matchItem('ash', item())).toBe(true)
    expect(matchItem('nyx', item())).toBe(false)
    // The palette pre-filters with uFuzzy, so words must not be applied twice.
    const compiled = compileQuery(parseQuery('nyx cat:warframe').query, { words: 'ignore' })
    expect(compiled.matchItem(item())).toBe(true)
  })

  it('a hand-built query with an unknown key does not widen the result set', () => {
    // parseQuery rejects unknown keys, but a Query built by hand must not silently pass.
    const compiled = compileQuery({
      terms: [{ type: 'predicate', negated: false, key: 'colour', value: { kind: 'text', text: 'gold' } }],
    })
    expect(compiled.size).toBe(0)
  })
})

describe('grain', () => {
  it('from: is existential on an item and exact on a path', () => {
    const twoWays = item({ kinds: new Set(['relic', 'mission']) })
    expect(matchItem('from:relic', twoWays)).toBe(true)
    expect(matchItem('from:mission', twoWays)).toBe(true)

    expect(matchPath('from:relic', path({ kind: 'relic' }))).toBe(true)
    expect(matchPath('from:mission', path({ kind: 'relic' }))).toBe(false)
  })

  it('an item-only key still judges a path, via the path own item', () => {
    // mr: has no path evaluator; a row inherits its item answer rather than dropping out.
    expect(matchPath('mr:<8', path({ masteryReq: 6 }))).toBe(true)
    expect(matchPath('mr:<8', path({ masteryReq: 12 }))).toBe(false)
  })

  it('chance at item grain asks about the best path', () => {
    expect(matchItem('chance:>10', item({ bestChance: 0.11 }))).toBe(true)
    expect(matchItem('chance:>10', item({ bestChance: 0.02 }))).toBe(false)
  })

  it('conjunction of two edge keys is loose at item grain and exact at path grain', () => {
    // Documented in the design doc § 3: at item grain this is "has a relic path AND has a
    // >10% path", not "has a >10% relic path". The path grain is where the exact answer is.
    const mixed = item({ kinds: new Set(['relic', 'enemy']), bestChance: 0.5 })
    expect(matchItem('from:relic chance:>40', mixed)).toBe(true)
    expect(matchPath('from:relic chance:>40', path({ kind: 'relic', chance: 0.11 }))).toBe(false)
  })
})

describe('keys', () => {
  it('cat: is case-insensitive', () => {
    expect(matchItem('cat:warframe', item())).toBe(true)
    expect(matchItem('cat:WARFRAME', item())).toBe(true)
  })

  it('planet: reads the rolled-up set', () => {
    const earth = item({ planets: new Set(['earth']) })
    expect(matchItem('planet:earth', earth)).toBe(true)
    expect(matchItem('planet:venus', earth)).toBe(false)
  })

  it('tier: and rotation: read their sets', () => {
    expect(matchItem('tier:axi', item())).toBe(true)
    expect(matchItem('tier:lith', item())).toBe(false)
    expect(matchItem('rotation:c', item({ rotations: new Set(['c']) }))).toBe(true)
  })

  it('mr: supports comparison and equality, and never matches an item without one', () => {
    expect(matchItem('mr:<8', item({ masteryReq: 4 }))).toBe(true)
    expect(matchItem('mr:4', item({ masteryReq: 4 }))).toBe(true)
    expect(matchItem('mr:>=14', item({ masteryReq: 14 }))).toBe(true)
    // An item with no mastery requirement is not "MR 0" — the concept does not apply, and
    // mr:<8 returning every mod in the game would be wrong.
    expect(matchItem('mr:<8', item({ masteryReq: undefined }))).toBe(false)
  })

  it('chance: is typed as a percentage', () => {
    expect(matchPath('chance:>5', path({ chance: 0.11 }))).toBe(true)
    expect(matchPath('chance:>5', path({ chance: 0.02 }))).toBe(false)
    expect(matchPath('chance:<1', path({ chance: 0.005 }))).toBe(true)
  })

  it('source: matches text in the source name', () => {
    expect(matchItem('source:axi', item())).toBe(true)
    expect(matchItem('source:lith', item())).toBe(false)
  })

  it('is: and has: are the same namespace', () => {
    expect(matchItem('is:prime', item())).toBe(true)
    expect(matchItem('has:prime', item())).toBe(true)
    expect(matchItem('has:market', item({ hasMarket: true }))).toBe(true)
    expect(matchItem('is:set', item({ isSet: false }))).toBe(false)
  })
})
