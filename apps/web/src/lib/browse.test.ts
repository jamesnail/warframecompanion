import { describe, expect, it } from 'vitest'

import type { DropEdge, Item, Source } from '@provenance/core'

import {
  EMPTY_FILTERS,
  buildRows,
  facetsOf,
  filterRows,
  sortRows,
  type BrowseRow,
} from './browse'

const items: Item[] = [
  { id: 'braton-prime-barrel', name: 'Braton Prime Barrel', category: 'Component', tradable: true },
  { id: 'orokin-cell', name: 'Orokin Cell', category: 'Resource', tradable: false },
  { id: 'vitality', name: 'Vitality', category: 'Mod', tradable: true },
]

const sources: Source[] = [
  { id: 'mission:earth/cambria', kind: 'mission', name: 'Cambria', planet: 'Earth', missionType: 'Excavation' },
  { id: 'enemy:lancer', kind: 'enemy', name: 'Lancer' },
]

const edges: DropEdge[] = [
  {
    itemId: 'braton-prime-barrel',
    sourceId: 'mission:earth/cambria',
    chance: 0.2533,
    rotation: 'C',
    quantity: [1, 1],
    provenance: 'official',
  },
  {
    itemId: 'orokin-cell',
    sourceId: 'enemy:lancer',
    chance: 0.05,
    quantity: [1, 1],
    provenance: 'official',
  },
  {
    itemId: 'vitality',
    sourceId: 'enemy:lancer',
    chance: 0.1,
    quantity: [1, 1],
    provenance: 'official',
  },
  // An edge whose item is missing. The pipeline's orphan gate makes this impossible, but a
  // client that trusted that and was wrong would blank the page instead of dropping a row.
  {
    itemId: 'does-not-exist',
    sourceId: 'enemy:lancer',
    chance: 0.5,
    quantity: [1, 1],
    provenance: 'official',
  },
]

const stage = (_missionType: string | undefined, rotation: DropEdge['rotation']) =>
  rotation == null ? undefined : `Rotation ${rotation}`

const rows = buildRows(items, sources, edges, stage)

describe('buildRows', () => {
  it('produces one row per edge, not per item', () => {
    expect(rows).toHaveLength(3)
  })

  it('drops an edge whose item or source does not resolve, rather than throwing', () => {
    expect(rows.some((row) => row.itemId === 'does-not-exist')).toBe(false)
  })

  it('joins the source detail into one readable line', () => {
    const row = rows.find((r) => r.itemId === 'braton-prime-barrel')
    expect(row?.detail).toBe('Earth · Excavation · Rotation C')
  })

  it('omits absent detail parts instead of leaving separators', () => {
    // An enemy has no planet, mission type or rotation.
    expect(rows.find((r) => r.itemId === 'orokin-cell')?.detail).toBe('')
  })

  it('resolves a link target for the source, so the name is not a dead end', () => {
    expect(rows.find((r) => r.itemId === 'braton-prime-barrel')?.sourceHref).toBe(
      '/source/mission/earth/cambria',
    )
    expect(rows.find((r) => r.itemId === 'orokin-cell')?.sourceHref).toBe('/source/enemy/lancer')
  })

  it('precomputes a lowercased haystack covering item and source', () => {
    const row = rows.find((r) => r.itemId === 'braton-prime-barrel')
    expect(row?.haystack).toBe('braton prime barrel cambria')
  })
})

describe('filterRows', () => {
  it('returns everything when no filter is set', () => {
    expect(filterRows(rows, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('matches across item AND source names', () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, q: 'cambria' })).toHaveLength(1)
    expect(filterRows(rows, { ...EMPTY_FILTERS, q: 'braton' })).toHaveLength(1)
  })

  // Terms narrow, they do not widen. This is the difference from the fuzzy palette: in a
  // table you are cutting down a set you can see, so an extra word must mean "and".
  it('requires every term to match', () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, q: 'braton cambria' })).toHaveLength(1)
    expect(filterRows(rows, { ...EMPTY_FILTERS, q: 'braton lancer' })).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, q: 'BRATON' })).toHaveLength(1)
  })

  it('filters by category and by source kind', () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, categories: ['Mod'] })).toHaveLength(1)
    expect(filterRows(rows, { ...EMPTY_FILTERS, kinds: ['enemy'] })).toHaveLength(2)
  })

  it('treats an empty facet list as "no filter", not "match nothing"', () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, categories: [] })).toHaveLength(3)
  })

  it('combines filters as AND', () => {
    const out = filterRows(rows, { ...EMPTY_FILTERS, kinds: ['enemy'], categories: ['Mod'] })
    expect(out.map((row) => row.itemId)).toEqual(['vitality'])
  })

  it('applies the minimum chance inclusively', () => {
    expect(filterRows(rows, { ...EMPTY_FILTERS, minChance: 0.1 }).map((r) => r.itemId)).toEqual([
      'braton-prime-barrel',
      'vitality',
    ])
  })

  it('filters to tradable only', () => {
    const out = filterRows(rows, { ...EMPTY_FILTERS, tradableOnly: true })
    expect(out.map((row) => row.itemId).sort()).toEqual(['braton-prime-barrel', 'vitality'])
  })
})

describe('sortRows', () => {
  it('sorts by chance in both directions', () => {
    expect(sortRows(rows, 'chance', 'desc')[0]?.itemId).toBe('braton-prime-barrel')
    expect(sortRows(rows, 'chance', 'asc')[0]?.itemId).toBe('orokin-cell')
  })

  it('sorts by name', () => {
    expect(sortRows(rows, 'item', 'asc')[0]?.itemName).toBe('Braton Prime Barrel')
  })

  it('does not mutate its input', () => {
    const before = rows.map((row) => row.itemId)
    sortRows(rows, 'chance', 'asc')
    expect(rows.map((row) => row.itemId)).toEqual(before)
  })

  // Without a tiebreak the comparator is not a total order, and equal-chance rows swap
  // places between renders — the table appears to shuffle on its own.
  it('breaks ties deterministically', () => {
    const tied: BrowseRow[] = ['Zeta', 'Alpha', 'Mu'].map((name) => ({
      ...(rows[0] as BrowseRow),
      itemId: name.toLowerCase(),
      itemName: name,
      chance: 0.1,
    }))
    expect(sortRows(tied, 'chance', 'desc').map((row) => row.itemName)).toEqual([
      'Alpha',
      'Mu',
      'Zeta',
    ])
  })
})

describe('facetsOf', () => {
  it('offers only options that actually occur', () => {
    const facets = facetsOf(rows)
    expect(facets.categories).toEqual(['Component', 'Mod', 'Resource'])
    expect(facets.kinds).toEqual(['enemy', 'mission'])
  })
})
