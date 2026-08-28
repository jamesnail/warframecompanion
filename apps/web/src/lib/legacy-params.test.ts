import { describe, expect, it } from 'vitest'

import { compileQuery, parseQuery, type DropEdge, type Item, type Source } from '@provenance/core'

import { buildRows, filterRows } from './browse'
import { hasLegacyParams, readLegacyParams, toQueryText } from './legacy-params'
import { buildQueryItems, indexById } from './query-index'

const items: Item[] = [
  { id: 'braton-prime-barrel', name: 'Braton Prime Barrel', category: 'Component', tradable: true },
  { id: 'orokin-cell', name: 'Orokin Cell', category: 'Resource', tradable: false },
  { id: 'axi-a1-relic', name: 'Axi A1 Relic', category: 'Relic', tradable: true, vaulted: true },
]

const sources: Source[] = [
  { id: 'mission:earth/cambria', kind: 'mission', name: 'Cambria', planet: 'Earth' },
  { id: 'enemy:lancer', kind: 'enemy', name: 'Lancer' },
  { id: 'relic:axi-a1', kind: 'relic', name: 'Axi A1 Relic' },
]

const edges: DropEdge[] = [
  { itemId: 'braton-prime-barrel', sourceId: 'mission:earth/cambria', chance: 0.25, quantity: [1, 1], provenance: 'official' },
  { itemId: 'braton-prime-barrel', sourceId: 'relic:axi-a1', chance: 0.1, quantity: [1, 1], provenance: 'official' },
  { itemId: 'orokin-cell', sourceId: 'enemy:lancer', chance: 0.02, quantity: [1, 1], provenance: 'official' },
]

const rows = buildRows(items, sources, edges, () => undefined)
const index = indexById(buildQueryItems(items, sources, edges))
const run = (query: string) => filterRows(rows, compileQuery(parseQuery(query).query), index)

describe('hasLegacyParams', () => {
  it('recognises a pre-query URL', () => {
    expect(hasLegacyParams(new URLSearchParams('category=Mod'))).toBe(true)
    expect(hasLegacyParams(new URLSearchParams('farmable=true'))).toBe(true)
  })

  it('leaves a query URL alone, so the migration runs once and never again', () => {
    expect(hasLegacyParams(new URLSearchParams('q=is:prime'))).toBe(false)
    expect(hasLegacyParams(new URLSearchParams(''))).toBe(false)
  })
})

describe('toQueryText', () => {
  it('translates each filter to its term', () => {
    expect(toQueryText({ category: ['Component'] }).query).toBe('cat:component')
    expect(toQueryText({ kind: ['relic'] }).query).toBe('from:relic')
    expect(toQueryText({ tradable: true }).query).toBe('is:tradable')
    // "Farmable now" was the negation all along.
    expect(toQueryText({ farmable: true }).query).toBe('-is:vaulted')
  })

  it('scales min from a fraction to a percentage', () => {
    // Carrying 0.05 across unchanged would mean chance:>=0.05 — a filter 100x looser than
    // the one the link described, silently.
    expect(toQueryText({ min: 0.05 }).query).toBe('chance:>=5')
    expect(toQueryText({ min: 0.001 }).query).toBe('chance:>=0.1')
  })

  it('keeps the free-text term first', () => {
    expect(toQueryText({ q: 'braton', category: ['Component'] }).query).toBe('braton cat:component')
  })

  it('quotes a value containing a space', () => {
    expect(toQueryText({ category: ['Some Category'] }).query).toBe('cat:"some category"')
  })

  it('reports what a multi-select could not express, rather than dropping it silently', () => {
    // The old facets were multi-select ORs and the language has no OR. Broadening the view
    // and saying so beats quietly applying one of the two.
    const { query, dropped } = toQueryText({ category: ['Mod', 'Component'] })
    expect(query).toBe('cat:mod')
    expect(dropped).toEqual(['cat:Component'])
  })

  it('produces nothing for an empty filter set', () => {
    expect(toQueryText({}).query).toBe('')
  })

  it('every translation parses cleanly', () => {
    const { query } = toQueryText({
      q: 'braton',
      category: ['Component'],
      kind: ['relic'],
      min: 0.05,
      tradable: true,
      farmable: true,
    })
    expect(parseQuery(query).errors).toEqual([])
  })
})

describe('readLegacyParams', () => {
  it('reads the comma-separated multi-value shape nuqs wrote', () => {
    const params = new URLSearchParams('q=braton&category=Mod,Component&min=0.05&tradable=true')
    expect(readLegacyParams(params)).toEqual({
      q: 'braton',
      category: ['Mod', 'Component'],
      kind: [],
      min: 0.05,
      tradable: true,
      farmable: false,
    })
  })
})

describe('old links resolve to the same rows', () => {
  // Asserted on RESULTS rather than on strings: the point of the migration is that a shared
  // URL still shows what it described, not that it produces a particular query text.
  it.each([
    // Two rows, not one: a row is an EDGE, and this part drops from a mission and a relic.
    ['category=Component', 2],
    ['kind=enemy', 1],
    ['tradable=true', 2],
    ['farmable=true', 2],
    ['q=braton&farmable=true', 1],
    ['min=0.05', 2],
  ])('%s', (search, expected) => {
    const { query } = toQueryText(readLegacyParams(new URLSearchParams(search)))
    expect(run(query)).toHaveLength(expected)
  })
})
