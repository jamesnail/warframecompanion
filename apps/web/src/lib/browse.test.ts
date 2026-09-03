import { describe, expect, it } from 'vitest'

import { compileQuery, parseQuery, type DropEdge, type Item, type Source } from '@provenance/core'

import {
  buildRows,
  facetsOf,
  facetsOfItems,
  filterItems,
  filterRows,
  sortItemRows,
  sortRows,
  toItemRow,
  type BrowseRow,
  type ItemRow,
} from './browse'
import { buildQueryItems, indexById } from './query-index'

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
const index = indexById(buildQueryItems(items, sources, edges))

/** Query text in, matching rows out — the path the component takes, end to end. */
const run = (
  query: string,
  subject: BrowseRow[] = rows,
  itemIndex = index,
): BrowseRow[] => filterRows(subject, compileQuery(parseQuery(query).query), itemIndex)

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
  it('returns everything for an empty query', () => {
    expect(run('')).toHaveLength(3)
  })

  it('matches bare words across item AND source names', () => {
    expect(run('cambria')).toHaveLength(1)
    expect(run('braton')).toHaveLength(1)
  })

  // Terms narrow, they do not widen. This is the difference from the fuzzy palette: in a
  // table you are cutting down a set you can see, so an extra word must mean "and".
  it('requires every term to match', () => {
    expect(run('braton cambria')).toHaveLength(1)
    expect(run('braton lancer')).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    expect(run('BRATON')).toHaveLength(1)
  })

  it('filters by category and by source kind', () => {
    expect(run('cat:mod')).toHaveLength(1)
    expect(run('from:enemy')).toHaveLength(2)
  })

  it('combines terms as AND', () => {
    expect(run('from:enemy cat:mod').map((row) => row.itemId)).toEqual(['vitality'])
  })

  it('filters by chance, typed as a percentage', () => {
    expect(run('chance:>=10').map((row) => row.itemId)).toEqual([
      'braton-prime-barrel',
      'vitality',
    ])
  })

  it('filters to tradable only', () => {
    expect(run('is:tradable').map((row) => row.itemId).sort()).toEqual([
      'braton-prime-barrel',
      'vitality',
    ])
  })

  it('negates', () => {
    expect(run('-is:tradable').map((row) => row.itemId)).toEqual(['orokin-cell'])
    expect(run('-braton')).toHaveLength(2)
  })

  it('filters by planet and rotation, which live on the source and the edge', () => {
    expect(run('planet:earth').map((row) => row.itemId)).toEqual(['braton-prime-barrel'])
    expect(run('rotation:c').map((row) => row.itemId)).toEqual(['braton-prime-barrel'])
  })

  it('drops a term that cannot be parsed rather than widening to everything', () => {
    // The failure this guards: an unknown key evaluating to "no constraint" and returning
    // the whole table, which reads as a successful search.
    expect(run('colour:gold')).toHaveLength(3)
    expect(parseQuery('colour:gold').errors).toHaveLength(1)
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

describe('vaulted paths', () => {
  const withRelics: Item[] = [
    ...items,
    { id: 'axi-a1-relic', name: 'Axi A1 Relic', category: 'Relic', tradable: true, vaulted: true },
    { id: 'neo-b2-relic', name: 'Neo B2 Relic', category: 'Relic', tradable: true, vaulted: false },
  ]
  const relicSources: Source[] = [
    ...sources,
    { id: 'relic:axi-a1', kind: 'relic', name: 'Axi A1 Relic' },
    { id: 'relic:neo-b2', kind: 'relic', name: 'Neo B2 Relic' },
  ]
  const relicEdges: DropEdge[] = [
    { itemId: 'braton-prime-barrel', sourceId: 'relic:axi-a1', chance: 0.2533, quantity: [1, 1], provenance: 'official' },
    { itemId: 'braton-prime-barrel', sourceId: 'relic:neo-b2', chance: 0.1, quantity: [1, 1], provenance: 'official' },
  ]
  const relicRows = buildRows(withRelics, relicSources, relicEdges, stage)

  it('marks a path through a vaulted relic', () => {
    expect(relicRows.find((r) => r.sourceId === 'relic:axi-a1')?.vaulted).toBe(true)
    expect(relicRows.find((r) => r.sourceId === 'relic:neo-b2')?.vaulted).toBe(false)
  })

  it('never marks a non-relic source vaulted', () => {
    expect(rows.every((row) => !row.vaulted)).toBe(true)
  })

  // The point of the filter: one live relic keeps the item farmable even when four others
  // are vaulted, so this must cut PATHS and not items.
  it('keeps the live path and drops the vaulted one', () => {
    const relicIndex = indexById(buildQueryItems(withRelics, relicSources, relicEdges))
    const out = run('-is:vaulted', relicRows, relicIndex)
    expect(out.map((row) => row.sourceId)).toEqual(['relic:neo-b2'])
  })

  it('leaves everything alone when the query is empty', () => {
    expect(run('', relicRows)).toHaveLength(2)
  })

  it('reads the relic tier off the source name', () => {
    // 771 of 771 relic sources name their tier first, which is why /browse does not load the
    // 294 KB relic chunk to look up one word.
    const relicIndex = indexById(buildQueryItems(withRelics, relicSources, relicEdges))
    expect(run('tier:axi', relicRows, relicIndex).map((row) => row.sourceId)).toEqual([
      'relic:axi-a1',
    ])
  })
})

/**
 * The item grain.
 *
 * `braton-prime` is added here rather than to the shared fixture above so the path-grain
 * tests keep asserting over the row count they were written for.
 */
describe('the item grain', () => {
  const withSet: Item[] = [
    ...items,
    {
      id: 'braton-prime',
      name: 'Braton Prime',
      category: 'Primary',
      tradable: false,
      parts: [{ itemId: 'braton-prime-barrel', count: 1 }],
      ingredients: [{ itemId: 'orokin-cell', count: 10 }],
    },
    // Nothing drops it and it builds nothing: the shape of a vaulted relic, 737 of which
    // ship in the real data.
    { id: 'ghost', name: 'Ghost', category: 'Other', tradable: false },
  ]
  const index = indexById(buildQueryItems(withSet, sources, edges))
  const rows = (query: string): ItemRow[] =>
    sortItemRows(
      filterItems(index.values(), compileQuery(parseQuery(query).query)).map((item) =>
        toItemRow(item, (id) => index.has(id)),
      ),
      'chance',
      'desc',
    )

  it('gives an undropped set a row of its own', () => {
    // THE regression, at the grain the table actually renders. Braton Prime has no edge; at
    // path grain it is invisible, and "0 rows" reads as "there is no Braton Prime".
    const set = rows('cat:primary')
    expect(set.map((row) => row.itemName)).toEqual(['Braton Prime'])
  })

  it('names the part its best path actually drops', () => {
    const [set] = rows('cat:primary')
    expect(set?.sourceName).toBe('Cambria')
    // Without this the row claims Cambria drops the assembled weapon.
    expect(set?.via).toBe('Braton Prime Barrel')
    expect(set?.paths).toBe(1)
  })

  it('leaves via unset where the item is what drops', () => {
    const [barrel] = rows('cat:component')
    expect(barrel?.via).toBeUndefined()
  })

  it('does not inherit an ingredient path', () => {
    // Orokin Cell drops from an enemy; Braton Prime consumes ten of them and drops from none.
    expect(rows('cat:primary from:enemy')).toEqual([])
  })

  it('reports an item nothing drops as zero paths, not as a missing row', () => {
    const [row] = rows('cat:other')
    expect(row?.itemName).toBe('Ghost')
    expect(row?.paths).toBe(0)
    expect(row?.chance).toBe(0)
    expect(row?.sourceName).toBeUndefined()
  })

  it('offers a category facet the edge table has none of', () => {
    // Primary exists only on the undropped set here, which is exactly the case that made a
    // facet read off edges under-report every prime Warframe.
    expect(facetsOf(buildRows(withSet, sources, edges, () => undefined)).categories).not.toContain(
      'Primary',
    )
    expect(facetsOfItems(index.values()).categories).toContain('Primary')
  })

  it('sorts undropped items to one end rather than through the alphabet', () => {
    const all = rows('')
    expect(all[all.length - 1]?.paths).toBe(0)
  })
})
