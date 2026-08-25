import { describe, expect, it } from 'vitest'

import { stageLabel } from '@provenance/core'
import type { DropEdge, Item, Source } from '@provenance/core'

import { groupDrops } from './source-drops'

const itemsById = new Map<string, Item>(
  (
    [
      { id: 'endo', name: 'Endo', category: 'Resource', tradable: false },
      { id: 'oxium', name: 'Oxium', category: 'Resource', tradable: true },
      { id: 'vitality', name: 'Vitality', category: 'Mod', tradable: true },
    ] as Item[]
  ).map((item) => [item.id, item]),
)

const edge = (over: Partial<DropEdge>): DropEdge => ({
  itemId: 'endo',
  sourceId: 'mission:earth/cambria',
  chance: 0.1,
  quantity: [1, 1],
  provenance: 'official',
  ...over,
})

const mission: Source = {
  id: 'mission:earth/cambria',
  kind: 'mission',
  name: 'Cambria',
  planet: 'Earth',
  missionType: 'Excavation',
}

describe('groupDrops', () => {
  it('returns a single "Drops" group when nothing carries a rotation', () => {
    const groups = groupDrops(
      { id: 'enemy:lancer', kind: 'enemy', name: 'Lancer' },
      [edge({ itemId: 'endo' }), edge({ itemId: 'oxium', chance: 0.4 })],
      itemsById,
      stageLabel,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.title).toBe('Drops')
    expect(groups[0]?.rows.map((row) => row.itemName)).toEqual(['Oxium', 'Endo'])
  })

  it('groups by rotation in A, B, C order regardless of edge order', () => {
    const groups = groupDrops(
      mission,
      [
        edge({ itemId: 'vitality', rotation: 'C' }),
        edge({ itemId: 'oxium', rotation: 'A' }),
        edge({ itemId: 'endo', rotation: 'B' }),
      ],
      itemsById,
      stageLabel,
    )
    expect(groups.map((group) => group.title)).toEqual(['Rotation A', 'Rotation B', 'Rotation C'])
  })

  it('omits a rotation nothing drops in, rather than showing an empty panel', () => {
    const groups = groupDrops(mission, [edge({ rotation: 'A' })], itemsById, stageLabel)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe('A')
  })

  // Sabotage caches and Spy vaults are keyed A/B/C but are not reward rotations; the label
  // has to come from stageLabel or the page tells the player something false about the mission.
  it('names Spy groups vaults, not rotations', () => {
    const spy: Source = { id: 'mission:mars/oceanum', kind: 'mission', name: 'Oceanum', missionType: 'Spy' }
    const groups = groupDrops(
      spy,
      [edge({ sourceId: spy.id, rotation: 'A' }), edge({ sourceId: spy.id, itemId: 'oxium', rotation: 'B' })],
      itemsById,
      stageLabel,
    )
    expect(groups.map((group) => group.title)).toEqual(['Vault A', 'Vault B'])
  })

  it('sorts by chance descending within a group, breaking ties on name', () => {
    const groups = groupDrops(
      { id: 'enemy:lancer', kind: 'enemy', name: 'Lancer' },
      [
        edge({ itemId: 'vitality', chance: 0.2 }),
        edge({ itemId: 'endo', chance: 0.2 }),
        edge({ itemId: 'oxium', chance: 0.9 }),
      ],
      itemsById,
      stageLabel,
    )
    expect(groups[0]?.rows.map((row) => row.itemName)).toEqual(['Oxium', 'Endo', 'Vitality'])
  })

  it('strips the repeated syndicate name from every offering detail', () => {
    const groups = groupDrops(
      { id: 'syndicate:red-veil', kind: 'syndicate', name: 'Red Veil' },
      [edge({ chance: 1, stage: 'Red Veil, Respected · 1,000 standing' })],
      itemsById,
      stageLabel,
    )
    expect(groups[0]?.rows[0]?.detail).toBe('Respected · 1,000 standing')
  })

  it('leaves a detail that does not repeat the name alone', () => {
    const groups = groupDrops(mission, [edge({ stage: 'Stage 1' })], itemsById, stageLabel)
    expect(groups[0]?.rows[0]?.detail).toBe('Stage 1')
  })

  it('drops an edge whose item does not resolve instead of throwing', () => {
    const groups = groupDrops(mission, [edge({ itemId: 'ghost' })], itemsById, stageLabel)
    expect(groups).toEqual([])
  })
})
