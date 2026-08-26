import { describe, expect, it } from 'vitest'

import { parseSolNodes } from './nodes'

// Shaped exactly like the wiki module: one flat record per line inside a Lua table.
const LUA = `local MissionData = {
	["Missions"] = {
		{ Name = "Hydron", Link = "Hydron", Planet = "Sedna", Type = "Defense", Tileset = "Grineer Galleon", Enemy = "Grineer", MinLevel = 30, MaxLevel = 40, MasteryExp = 177, InternalName = "SolNode195", IsTracked = true },
		{ Name = "Tuvul Commons", Planet = "Zariman", Type = "Void Cascade", Enemy = "Grineer or Corpus", MinLevel = 30, MaxLevel = 40, InternalName = "SolNode232" },
		{ Name = "Nsu Grid", Planet = "Veil Proxima", Type = "Skirmish", Enemy = "Grineer", MinLevel = 100, MaxLevel = 130, InternalName = "CrewBattleNode518" },
		{ Name = "Lavan Test Mk Iii", Planet = "Earth", Type = "Capture", Enemy = "Grineer", MinLevel = 1, MaxLevel = 5, InternalName = "SolNode999" },
		{ Name = "No Internal Name", Planet = "Earth", Type = "Capture" },
		{ Name = "Duplicate", Planet = "Earth", Type = "Capture", InternalName = "SolNode195" }
	}
}
return MissionData`

const { nodes, skipped } = parseSolNodes(LUA)
const byId = (id: string) => nodes.find((n) => n.id === id)

describe('parseSolNodes', () => {
  it('keys every node by its internal id', () => {
    expect(byId('SolNode195')?.name).toBe('Hydron')
    expect(byId('SolNode232')?.name).toBe('Tuvul Commons')
  })

  it('carries the fields DE never publishes', () => {
    expect(byId('SolNode195')).toMatchObject({
      planet: 'Sedna',
      faction: 'Grineer',
      missionType: 'Defense',
      tileset: 'Grineer Galleon',
      levelRange: [30, 40],
    })
  })

  // Railjack nodes use a different prefix and must resolve too, or every void storm reads
  // as an internal id.
  it('handles Railjack nodes, not just SolNode', () => {
    expect(byId('CrewBattleNode518')).toMatchObject({ name: 'Nsu Grid', planet: 'Veil Proxima' })
  })

  it('keeps a faction the Faction enum could not hold', () => {
    expect(byId('SolNode232')?.faction).toBe('Grineer or Corpus')
  })

  it('normalises upstream roman-numeral casing in node names', () => {
    expect(byId('SolNode999')?.name).toBe('Lavan Test Mk III')
  })

  it('skips a record with no internal id rather than throwing', () => {
    expect(nodes.some((n) => n.name === 'No Internal Name')).toBe(false)
    expect(skipped).toBe(1)
  })

  it('keeps the first record when an id repeats', () => {
    expect(byId('SolNode195')?.name).toBe('Hydron')
    expect(nodes.filter((n) => n.id === 'SolNode195')).toHaveLength(1)
  })

  it('returns a stable id order so rebuilds hash identically', () => {
    const ids = nodes.map((n) => n.id)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it('returns nothing for input that is not the module at all', () => {
    expect(parseSolNodes('').nodes).toEqual([])
    expect(parseSolNodes('local x = 1').nodes).toEqual([])
  })

  it('omits optional fields rather than emitting empty ones', () => {
    const minimal = parseSolNodes('{ Name = "Bare", InternalName = "SolNode1" }')
    expect(minimal.nodes[0]).toEqual({ id: 'SolNode1', name: 'Bare' })
  })
})

describe('empty fields', () => {
  // The output-shape gate caught this: one real record carries InternalName = "".
  it('treats an empty internal name as absent', () => {
    const { nodes, skipped } = parseSolNodes('{ Name = "Ghost", InternalName = "" }')
    expect(nodes).toEqual([])
    expect(skipped).toBe(1)
  })

  it('treats an empty display name as absent', () => {
    expect(parseSolNodes('{ Name = "", InternalName = "SolNode1" }').nodes).toEqual([])
  })
})
