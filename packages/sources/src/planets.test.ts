import { describe, expect, it } from 'vitest'

import { FACTION_RESOURCES, PLANET_EXCLUSIVES, buildPlanets } from './planets'
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

/** Earth as the pipeline sees it: Grineer-held, with a reward table that lists almost none of
 *  what the planet is actually farmed for. */
const earth = {
  nodes: [
    { planet: 'Earth', faction: 'Grineer' },
    { planet: 'Earth', faction: 'Grineer' },
    { planet: 'Earth', faction: 'Infested' },
  ],
  sources: [source('mission:earth/cambria', 'Earth')],
  edges: [edge('endo', 'mission:earth/cambria', 0.37)],
  items: [
    item('endo'),
    item('ferrite', 'Other'),
    item('alloy-plate'),
    item('detonite-ampule'),
    item('salvage'),
    item('nano-spores'),
    item('mutagen-sample'),
    item('plastids'),
    item('neurodes', 'Other'),
    item('oxium'),
    item('rubedo'),
    item('circuits'),
  ],
}

describe('buildPlanets', () => {
  it('gives Earth the resources its own drop tables omit', () => {
    const { planets } = buildPlanets(earth)
    const found = planets.find((planet) => planet.name === 'Earth')
    const ids = found?.resources.map((row) => row.itemId) ?? []
    // The six the derived-only build could not produce. This is the whole reason the file
    // exists — see the header there.
    for (const id of ['ferrite', 'rubedo', 'detonite-ampule', 'neurodes', 'oxium', 'circuits']) {
      expect(ids).toContain(id)
    }
  })

  it('marks each claim with how it was reached', () => {
    const { planets } = buildPlanets(earth)
    const rows = planets.find((planet) => planet.name === 'Earth')?.resources ?? []
    const basisOf = (id: string) => rows.find((row) => row.itemId === id)?.basis
    expect(basisOf('oxium')).toBe('exclusive')
    expect(basisOf('ferrite')).toBe('faction')
    expect(basisOf('endo')).toBe('reward-table')
  })

  it('a curated claim outranks a reward-table row for the same resource', () => {
    const withRubedo = {
      ...earth,
      edges: [...earth.edges, edge('rubedo', 'mission:earth/cambria', 0.12)],
    }
    const rows = buildPlanets(withRubedo).planets.find((p) => p.name === 'Earth')?.resources ?? []
    const rubedo = rows.filter((row) => row.itemId === 'rubedo')
    // One row, not two, and it says what the planet is FOR rather than what one table pays.
    expect(rubedo).toHaveLength(1)
    expect(rubedo[0]?.basis).toBe('exclusive')
  })

  it('names the faction on a faction row, ordered by who holds the planet', () => {
    const rows = buildPlanets(earth).planets.find((p) => p.name === 'Earth')?.resources ?? []
    const factionRows = rows.filter((row) => row.basis === 'faction')
    expect(factionRows[0]?.faction).toBe('Grineer')
    // Earth's three Infested nodes are real, so their resources are listed — last.
    expect(factionRows.at(-1)?.faction).toBe('Infested')
  })

  it('curated rows come before reward-table rows regardless of chance', () => {
    // The reward-table row here is 37%; every curated row has no chance at all. Sorting on
    // chance would put Endo first and bury what the planet is for.
    const rows = buildPlanets(earth).planets.find((p) => p.name === 'Earth')?.resources ?? []
    expect(rows[0]?.basis).not.toBe('reward-table')
    expect(rows.at(-1)?.itemId).toBe('endo')
  })

  it('reports a curated id that matches no item instead of dropping it silently', () => {
    const { unresolved } = buildPlanets({ ...earth, items: [item('endo')] })
    expect(unresolved.length).toBeGreaterThan(0)
    expect(unresolved.some((entry) => entry.includes('ferrite'))).toBe(true)
  })

  it('skips Railjack regions and game modes, which are not places with resources', () => {
    const names = buildPlanets({
      ...earth,
      sources: [...earth.sources, source('mission:veil/x', 'Veil Proxima')],
      edges: [...earth.edges, edge('endo', 'mission:veil/x', 0.5)],
    }).planets.map((planet) => planet.name)
    expect(names).not.toContain('Veil Proxima')
  })

  it('keeps open worlds, which have no nodes and no factions at all', () => {
    const cetus = buildPlanets({
      nodes: [],
      sources: [],
      edges: [],
      items: PLANET_EXCLUSIVES.Cetus!.map((id) => item(id)),
    }).planets.find((planet) => planet.name === 'Cetus')
    expect(cetus?.nodes).toBe(0)
    expect(cetus?.factions).toEqual([])
    expect(cetus?.resources.length).toBe(PLANET_EXCLUSIVES.Cetus?.length)
  })
})

describe('the curated tables themselves', () => {
  it('cover only the four star-chart factions', () => {
    expect(Object.keys(FACTION_RESOURCES).sort()).toEqual([
      'Corpus',
      'Corrupted',
      'Grineer',
      'Infested',
    ])
  })

  it('list no resource twice within one entry', () => {
    for (const [key, ids] of Object.entries({ ...FACTION_RESOURCES, ...PLANET_EXCLUSIVES })) {
      expect(new Set(ids).size, `${key} repeats a resource`).toBe(ids.length)
    }
  })
})
