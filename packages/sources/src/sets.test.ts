import { describe, expect, it } from 'vitest'

import type { Item, ItemCategory } from '@provenance/core'

import { applySets, buildSets, componentIdCandidates } from './sets'
import type { RawWfcdItem } from './enrich'

const part = (name: string) => ({ name, uniqueName: `/Lotus/Recipes/Weapons/${name}` })
const ingredient = (name: string) => ({ name, uniqueName: `/Lotus/Types/Items/${name}` })

const BRATON_PRIME: RawWfcdItem = {
  name: 'Braton Prime',
  tradable: true,
  components: [part('Barrel'), part('Receiver'), part('Stock'), part('Blueprint'), ingredient('Orokin Cell')],
}

/** Frame parts drop as blueprints; weapon parts drop as the part. */
const ASH_PRIME: RawWfcdItem = {
  name: 'Ash Prime',
  components: [part('Chassis'), part('Neuroptics'), part('Systems'), part('Blueprint')],
}

const CATALOGUE = new Set([
  'braton-prime-barrel',
  'braton-prime-receiver',
  'braton-prime-stock',
  'braton-prime-blueprint',
  'orokin-cell',
  'ash-prime-chassis-blueprint',
  'ash-prime-neuroptics-blueprint',
  'ash-prime-systems-blueprint',
  'ash-prime-blueprint',
])
const has = (id: string): boolean => CATALOGUE.has(id)

const files = (rows: RawWfcdItem[], category: ItemCategory = 'Primary') => [{ category, rows }]

describe('componentIdCandidates', () => {
  it('names a part relative to its parent', () => {
    expect(componentIdCandidates('Braton Prime', part('Barrel'))[0]).toBe('braton-prime-barrel')
  })

  it('leaves a shared ingredient its own bare name', () => {
    // Prefixing would invent "Braton Prime Orokin Cell", an item that does not exist.
    expect(componentIdCandidates('Braton Prime', ingredient('Orokin Cell'))[0]).toBe('orokin-cell')
  })

  // The quirk that took fully-resolved sets from 206 to 309.
  it('offers a Blueprint-suffixed fallback, because frame parts drop as blueprints', () => {
    expect(componentIdCandidates('Ash Prime', part('Chassis'))).toEqual([
      'ash-prime-chassis',
      'ash-prime-chassis-blueprint',
    ])
  })
})

describe('buildSets', () => {
  it('emits a set whose every component resolves', () => {
    const { sets } = buildSets(files([BRATON_PRIME]), has)
    expect(sets).toHaveLength(1)
    expect(sets[0]?.id).toBe('braton-prime')
    expect(sets[0]?.components?.map((c) => c.itemId)).toEqual([
      'braton-prime-barrel',
      'braton-prime-receiver',
      'braton-prime-stock',
      'braton-prime-blueprint',
      'orokin-cell',
    ])
  })

  it('resolves frame parts through the blueprint fallback', () => {
    const { sets } = buildSets(files([ASH_PRIME], 'Warframe'), has)
    expect(sets[0]?.components?.map((c) => c.itemId)).toEqual([
      'ash-prime-chassis-blueprint',
      'ash-prime-neuroptics-blueprint',
      'ash-prime-systems-blueprint',
      'ash-prime-blueprint',
    ])
  })

  // The rule the whole module exists to enforce: four of five pieces reads as a complete
  // answer and is not one.
  it('discards an incomplete recipe rather than shipping a partial one', () => {
    const incomplete: RawWfcdItem = {
      name: 'Braton Prime',
      components: [part('Barrel'), part('Nonexistent Widget')],
    }
    const { sets, partial } = buildSets(files([incomplete]), has)
    expect(sets).toEqual([])
    expect(partial).toEqual(['Braton Prime: Nonexistent Widget'])
  })

  it('ignores a recipe of nothing but shared ingredients', () => {
    const notAFarm: RawWfcdItem = { name: 'Some Alloy', components: [ingredient('Orokin Cell')] }
    expect(buildSets(files([notAFarm]), has).sets).toEqual([])
  })

  it('never shadows an item the drop data already knows first-hand', () => {
    const alsoDrops = (id: string): boolean => id === 'braton-prime' || has(id)
    expect(buildSets(files([BRATON_PRIME]), alsoDrops).sets).toEqual([])
  })

  it('keeps the first spelling when the same name appears in two files', () => {
    const { sets } = buildSets(
      [
        { category: 'Primary', rows: [BRATON_PRIME] },
        { category: 'Melee', rows: [BRATON_PRIME] },
      ],
      has,
    )
    expect(sets).toHaveLength(1)
    expect(sets[0]?.category).toBe('Primary')
  })

  it('records the reverse link for every component, including shared ingredients', () => {
    const { buildsInto } = buildSets(files([BRATON_PRIME]), has)
    expect(buildsInto.get('braton-prime-barrel')).toEqual(['braton-prime'])
    expect(buildsInto.get('orokin-cell')).toEqual(['braton-prime'])
  })

  it('lists one component in every set it builds, without duplicating', () => {
    const other: RawWfcdItem = { name: 'Soma Prime', components: [part('Barrel'), ingredient('Orokin Cell')] }
    const wider = (id: string): boolean => id === 'soma-prime-barrel' || has(id)
    const { buildsInto } = buildSets(files([BRATON_PRIME, other]), wider)
    expect(buildsInto.get('orokin-cell')).toEqual(['braton-prime', 'soma-prime'])
  })
})

describe('applySets', () => {
  const items: Item[] = [
    { id: 'braton-prime-barrel', name: 'Braton Prime Barrel', category: 'Component', tradable: true },
    { id: 'orokin-cell', name: 'Orokin Cell', category: 'Resource', tradable: false },
  ]

  it('appends the sets and stamps buildsInto onto their components', () => {
    const out = applySets(items, buildSets(files([BRATON_PRIME]), has))
    expect(out.find((i) => i.id === 'braton-prime')).toBeDefined()
    expect(out.find((i) => i.id === 'braton-prime-barrel')?.buildsInto).toEqual(['braton-prime'])
  })

  it('leaves an item that builds into nothing untouched', () => {
    const out = applySets(items, { sets: [], buildsInto: new Map(), partial: [] })
    expect(out.every((item) => item.buildsInto === undefined)).toBe(true)
  })

  // Content-addressed output means a rebuild that found nothing new must hash identically.
  it('returns a stable id order', () => {
    const out = applySets(items, buildSets(files([BRATON_PRIME]), has))
    expect(out.map((i) => i.id)).toEqual([...out.map((i) => i.id)].sort((a, b) => a.localeCompare(b)))
  })
})

describe('applySets referential integrity', () => {
  // The defect the component orphan gate caught on its first run: buildEnrichmentIndex mints
  // component ids from WFCD's recipe nesting without checking any of them exist.
  it('prunes a component reference to an item that does not exist', () => {
    const items: Item[] = [
      {
        id: 'advanced-nosam-cutter',
        name: 'Advanced Nosam Cutter',
        category: 'Other',
        tradable: false,
        components: [{ itemId: 'advanced-nosam-cutter-blueprint', count: 1 }],
      },
    ]
    const out = applySets(items, { sets: [], buildsInto: new Map(), partial: [] })
    expect(out[0]?.components).toBeUndefined()
  })

  it('keeps the references that do resolve', () => {
    const items: Item[] = [
      { id: 'orokin-cell', name: 'Orokin Cell', category: 'Resource', tradable: false },
      {
        id: 'thing',
        name: 'Thing',
        category: 'Other',
        tradable: false,
        components: [
          { itemId: 'orokin-cell', count: 2 },
          { itemId: 'ghost', count: 1 },
        ],
      },
    ]
    const out = applySets(items, { sets: [], buildsInto: new Map(), partial: [] })
    expect(out.find((i) => i.id === 'thing')?.components).toEqual([{ itemId: 'orokin-cell', count: 2 }])
  })

  it('drops a buildsInto target that is not in the table', () => {
    const items: Item[] = [
      { id: 'part', name: 'Part', category: 'Component', tradable: false, buildsInto: ['ghost-set'] },
    ]
    const out = applySets(items, { sets: [], buildsInto: new Map(), partial: [] })
    expect(out[0]?.buildsInto).toBeUndefined()
  })
})
