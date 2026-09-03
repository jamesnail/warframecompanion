import { describe, expect, it } from 'vitest'

import { GATHERED, REGION_RESOURCES, buildPlanets } from './planets'
import type { DropEdge, Item, Source } from '@provenance/core'

const item = (id: string, category: Item['category'] = 'Resource'): Item => ({
  id,
  name: id,
  category,
  tradable: true,
})

const source = (id: string, planet: string, kind: Source['kind'] = 'mission'): Source => ({
  id,
  kind,
  name: id,
  planet,
})

const edge = (itemId: string, sourceId: string, chance: number): DropEdge => ({
  itemId,
  sourceId,
  chance,
  quantity: [1, 1],
  provenance: 'official',
})

/** Every id any curated table names, so a fixture never fails for lack of an item. */
const allCurated: Item[] = [
  ...new Set([
    ...Object.values(REGION_RESOURCES).flatMap((pool) => pool.map(([id]) => id)),
    ...Object.values(GATHERED).flatMap((groups) => groups.flatMap((group) => group.ids)),
    'endo',
  ]),
].map((id) => item(id))

/** Earth as the pipeline sees it: Grineer-held, with a reward table listing almost none of
 *  what the region pool actually contains. */
const earth = {
  nodes: [
    { planet: 'Earth', faction: 'Grineer' },
    { planet: 'Earth', faction: 'Grineer' },
    { planet: 'Earth', faction: 'Infested' },
  ],
  sources: [source('mission:earth/cambria', 'Earth')],
  edges: [edge('endo', 'mission:earth/cambria', 0.37)],
  items: allCurated,
}

const earthRows = () =>
  buildPlanets(earth).planets.find((planet) => planet.name === 'Earth')?.resources ?? []

describe('buildPlanets', () => {
  it('gives Earth the region pool its own drop tables omit', () => {
    const ids = earthRows().map((row) => row.itemId)
    // The four the derived-only build could not produce. This is the whole reason the curated
    // tables exist — see the header in planets.ts.
    for (const id of ['ferrite', 'rubedo', 'detonite-ampule', 'neurodes']) {
      expect(ids).toContain(id)
    }
  })

  it('does NOT give Earth resources belonging to another region', () => {
    // The regression this table was written to fix. The previous faction-derived model handed
    // Earth Nano Spores, Mutagen Sample and Plastids off the back of three Infested nodes;
    // Earth's real pool contains none of them, and neither does its reward table here.
    const ids = earthRows().map((row) => row.itemId)
    for (const id of ['nano-spores', 'mutagen-sample', 'plastids', 'circuits', 'oxium']) {
      expect(ids, `Earth must not list ${id}`).not.toContain(id)
    }
  })

  it('marks each claim with how it was reached', () => {
    const basisOf = (id: string) => earthRows().find((row) => row.itemId === id)?.basis
    expect(basisOf('ferrite')).toBe('region')
    expect(basisOf('endo')).toBe('reward-table')
    const cetus = buildPlanets({ ...earth, sources: [], edges: [] }).planets.find(
      (planet) => planet.name === 'Cetus',
    )
    expect(cetus?.resources.find((row) => row.itemId === 'cetus-wisp')?.basis).toBe('gathered')
  })

  it('carries the wiki rarity, which is a property of the pair and not of the resource', () => {
    const rarityOn = (planet: string, id: string) =>
      buildPlanets(earth).planets.find((p) => p.name === planet)?.resources.find((r) => r.itemId === id)
        ?.rarity
    // Morphics is rare on Mercury and uncommon on Mars; Nano Spores common on Saturn,
    // uncommon on Neptune. Storing rarity per resource would have lost both.
    expect(rarityOn('Mercury', 'morphics')).toBe('rare')
    expect(rarityOn('Mars', 'morphics')).toBe('uncommon')
    expect(rarityOn('Saturn', 'nano-spores')).toBe('common')
    expect(rarityOn('Neptune', 'nano-spores')).toBe('uncommon')
  })

  it('a region claim outranks a reward-table row for the same resource', () => {
    const withFerrite = {
      ...earth,
      edges: [...earth.edges, edge('ferrite', 'mission:earth/cambria', 0.12)],
    }
    const rows = buildPlanets(withFerrite).planets.find((p) => p.name === 'Earth')?.resources ?? []
    const ferrite = rows.filter((row) => row.itemId === 'ferrite')
    expect(ferrite).toHaveLength(1)
    expect(ferrite[0]?.basis).toBe('region')
  })

  it('orders the region pool commons first, so the rare reads as the payoff', () => {
    const pool = earthRows().filter((row) => row.basis === 'region')
    expect(pool.map((row) => row.rarity)).toEqual(['common', 'common', 'uncommon', 'rare'])
    expect(pool.at(-1)?.itemId).toBe('neurodes')
  })

  it('curated rows come before reward-table rows regardless of chance', () => {
    // The reward-table row is 37%; no curated row has a chance at all. Sorting on chance
    // would put Endo first and bury what the planet is for.
    const rows = earthRows()
    expect(rows[0]?.basis).toBe('region')
    expect(rows.at(-1)?.itemId).toBe('endo')
  })

  it('still reports factions, which describe what you shoot rather than what drops', () => {
    const earthPlanet = buildPlanets(earth).planets.find((p) => p.name === 'Earth')
    expect(earthPlanet?.factions).toEqual(['Grineer', 'Infested'])
  })

  it('reports a curated id that matches no item instead of dropping it silently', () => {
    const { unresolved } = buildPlanets({ ...earth, items: [item('endo')] })
    expect(unresolved.length).toBeGreaterThan(0)
    expect(unresolved.some((entry) => entry.includes('ferrite'))).toBe(true)
  })

  it('skips Railjack regions and game modes, which are not places with a resource identity', () => {
    const names = buildPlanets({
      ...earth,
      sources: [...earth.sources, source('mission:veil/x', 'Veil Proxima')],
      edges: [...earth.edges, edge('endo', 'mission:veil/x', 0.5)],
    }).planets.map((planet) => planet.name)
    expect(names).not.toContain('Veil Proxima')
  })

  it('keeps open worlds, which have no nodes and no factions at all', () => {
    const cetus = buildPlanets({ nodes: [], sources: [], edges: [], items: allCurated }).planets.find(
      (planet) => planet.name === 'Cetus',
    )
    expect(cetus?.nodes).toBe(0)
    expect(cetus?.factions).toEqual([])
    expect(cetus?.resources.every((row) => row.basis === 'gathered')).toBe(true)
    expect(cetus?.resources.every((row) => row.method !== undefined)).toBe(true)
  })
})

describe('the curated tables themselves', () => {
  it('give every region pool a rarity on every row', () => {
    for (const [planet, pool] of Object.entries(REGION_RESOURCES)) {
      for (const [id, rarity] of pool) {
        expect(['common', 'uncommon', 'rare'], `${planet}/${id}`).toContain(rarity)
      }
    }
  })

  it('list no resource twice within one region pool', () => {
    for (const [planet, pool] of Object.entries(REGION_RESOURCES)) {
      const ids = pool.map(([id]) => id)
      expect(new Set(ids).size, `${planet} repeats a resource`).toBe(ids.length)
    }
  })

  it('never name Fieldron Sample, which resolves to the crafted item and not the sample', () => {
    const every = [
      ...Object.values(REGION_RESOURCES).flatMap((pool) => pool.map(([id]) => id)),
      ...Object.values(GATHERED).flatMap((groups) => groups.flatMap((group) => group.ids)),
    ]
    expect(every).not.toContain('fieldron')
    expect(every).not.toContain('fieldron-sample')
  })

  it('cite a source for every gathered group', () => {
    for (const [planet, groups] of Object.entries(GATHERED)) {
      for (const group of groups) {
        expect(group.citation.url, `${planet}/${group.method}`).toMatch(/^https:\/\/wiki\.warframe\.com\//)
        expect(group.citation.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })
})
