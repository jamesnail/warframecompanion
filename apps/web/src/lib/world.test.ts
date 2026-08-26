import { describe, expect, it } from 'vitest'

import {
  factionActivity,
  groupFissuresByTier,
  isStale,
  nodeToSourceId,
  parseWorldState,
  openFissures,
  payloadAgeMinutes,
  timeUntil,
  traderIsHere,
  type Fissure,
} from './world'

const NOW = Date.parse('2026-08-26T12:00:00.000Z')
const at = (minutes: number) => new Date(NOW + minutes * 60000).toISOString()

const fissure = (over: Partial<Fissure>): Fissure => ({
  id: Math.random().toString(36),
  node: 'Hydron (Sedna)',
  tier: 'Lith',
  expiry: at(60),
  ...over,
})

const payload = {
  timestamp: '2026-08-26T11:43:29.000Z',
  fissures: [
    { id: 'a', node: 'Everview Arc (Zariman)', tier: 'Omnia', expiry: at(30), enemy: 'Crossfire' },
    { id: 'b', node: 'Hydron (Sedna)', tier: 'Lith', expiry: at(90), enemy: 'Grineer' },
    // Malformed: no tier. Must cost this row and nothing else.
    { id: 'c', node: 'Broken (Nowhere)' },
  ],
  invasions: [
    {
      id: 'i1',
      node: 'Anthe (Saturn)',
      attacker: { faction: 'Corpus', reward: { countedItems: [{ count: 1, type: 'Dera Vandal Barrel' }] } },
      defender: { faction: 'Grineer' },
    },
    // Finished invasions are history, not news.
    { id: 'i2', node: 'Done (Earth)', completed: true, attacker: { faction: 'Infested' } },
  ],
  sortie: { faction: 'Corpus', boss: 'Nef Anyo', expiry: at(240), variants: [{ node: 'Sharpless (Phobos)' }] },
  archonHunt: { faction: 'Narmer', boss: 'Archon Nira', expiry: at(4000) },
  voidTrader: { character: "Baro Ki'Teer", location: 'Strata Relay (Earth)', activation: at(1000), expiry: at(3880) },
  earthCycle: { state: 'day', expiry: at(16) },
  cetusCycle: { state: 'night', expiry: at(8) },
  // Not in CYCLE_LABELS, must be ignored rather than crash.
  someNewCycle: { state: 'whatever' },
}

describe('parseWorldState', () => {
  const state = parseWorldState(payload)

  it('keeps the rows it understands and drops only the broken one', () => {
    expect(state.fissures).toHaveLength(2)
    expect(state.fissures.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('hides invasions that already finished', () => {
    expect(state.invasions.map((i) => i.id)).toEqual(['i1'])
  })

  it('reads the singular sections', () => {
    expect(state.sortie?.boss).toBe('Nef Anyo')
    expect(state.archonHunt?.faction).toBe('Narmer')
    expect(state.voidTrader?.location).toBe('Strata Relay (Earth)')
  })

  it('collects only the cycles it knows how to label', () => {
    expect(state.cycles.map((c) => c.label)).toEqual(['Earth', 'Cetus'])
  })

  // The whole reason parsing is per-section: this must not throw.
  it('survives rubbish without throwing', () => {
    expect(() => parseWorldState(null)).not.toThrow()
    expect(parseWorldState(null).fissures).toEqual([])
    expect(parseWorldState({ fissures: 'not an array' }).fissures).toEqual([])
    expect(parseWorldState(42).invasions).toEqual([])
  })
})

describe('nodeToSourceId', () => {
  it('turns a node label into the source id this site uses', () => {
    expect(nodeToSourceId('Everview Arc (Zariman)')).toBe('mission:zariman/everview-arc')
    expect(nodeToSourceId('Anthe (Saturn)')).toBe('mission:saturn/anthe')
  })

  it('handles a planet with two words', () => {
    expect(nodeToSourceId('Nsu Grid (Veil Proxima)')).toBe('mission:veil-proxima/nsu-grid')
  })

  it('returns nothing for a label without a planet', () => {
    expect(nodeToSourceId('Somewhere')).toBeUndefined()
  })
})

describe('groupFissuresByTier', () => {
  it('orders tiers the way the game lists them', () => {
    const groups = groupFissuresByTier([
      fissure({ tier: 'Axi' }),
      fissure({ tier: 'Lith' }),
      fissure({ tier: 'Neo' }),
      fissure({ tier: 'Meso' }),
    ])
    expect(groups.map((g) => g.tier)).toEqual(['Lith', 'Meso', 'Neo', 'Axi'])
  })

  it('puts unknown tiers after the known ones rather than dropping them', () => {
    const groups = groupFissuresByTier([fissure({ tier: 'Omnia' }), fissure({ tier: 'Lith' })])
    expect(groups.map((g) => g.tier)).toEqual(['Lith', 'Omnia'])
  })

  // A fissure with four minutes left is not the one to plan around.
  it('sorts soonest-to-expire first within a tier', () => {
    const groups = groupFissuresByTier([
      fissure({ id: 'late', tier: 'Lith', expiry: at(90) }),
      fissure({ id: 'soon', tier: 'Lith', expiry: at(10) }),
    ])
    expect(groups[0]?.fissures.map((f) => f.id)).toEqual(['soon', 'late'])
  })
})

describe('factionActivity', () => {
  it('counts fissures and invasions per faction, busiest first', () => {
    const state = parseWorldState({
      fissures: [
        { id: '1', node: 'A (X)', tier: 'Lith', expiry: at(10), enemy: 'Grineer' },
        { id: '2', node: 'B (X)', tier: 'Meso', expiry: at(10), enemy: 'Grineer' },
        { id: '3', node: 'C (X)', tier: 'Neo', expiry: at(10), enemy: 'Corpus' },
      ],
      invasions: [{ id: 'i', node: 'D (X)', attacker: { faction: 'Corpus' }, defender: { faction: 'Grineer' } }],
    })
    expect(factionActivity(state)).toEqual([
      { faction: 'Grineer', fissures: 2, invasions: 1 },
      { faction: 'Corpus', fissures: 1, invasions: 1 },
    ])
  })

  it('is empty when nothing is happening', () => {
    expect(factionActivity(parseWorldState({}))).toEqual([])
  })
})

describe('timeUntil', () => {
  it('formats minutes, hours and days', () => {
    expect(timeUntil(at(45), NOW)).toBe('45m')
    expect(timeUntil(at(135), NOW)).toBe('2h 15m')
    expect(timeUntil(at(60 * 30), NOW)).toBe('1d 6h')
  })

  it('says expired rather than showing a negative', () => {
    expect(timeUntil(at(-5), NOW)).toBe('expired')
  })

  it('returns nothing it cannot compute', () => {
    expect(timeUntil(undefined, NOW)).toBeUndefined()
    expect(timeUntil('not a date', NOW)).toBeUndefined()
  })
})

describe('traderIsHere', () => {
  it('is false while he is only scheduled', () => {
    expect(traderIsHere(parseWorldState(payload).voidTrader, NOW)).toBe(false)
  })

  it('is true inside the window', () => {
    const trader = { activation: at(-10), expiry: at(200) }
    expect(traderIsHere(trader, NOW)).toBe(true)
  })

  it('trusts an explicit active flag', () => {
    expect(traderIsHere({ active: true }, NOW)).toBe(true)
  })

  it('is false for nothing at all', () => {
    expect(traderIsHere(undefined, NOW)).toBe(false)
  })
})

describe('openFissures', () => {
  // Upstream keeps returning fissures past their own expiry — 13 of 32 in one live sample,
  // some by half an hour — so "32 open" was counting things nobody can run.
  it('drops fissures whose expiry has passed', () => {
    const out = openFissures(
      [fissure({ id: 'gone', expiry: at(-20) }), fissure({ id: 'live', expiry: at(20) })],
      NOW,
    )
    expect(out.map((f) => f.id)).toEqual(['live'])
  })

  it('keeps one whose expiry it cannot read, rather than silently hiding it', () => {
    const out = openFissures([fissure({ id: 'odd', expiry: 'not a date' })], NOW)
    expect(out.map((f) => f.id)).toEqual(['odd'])
  })

  it('excludes one expiring exactly now', () => {
    expect(openFissures([fissure({ expiry: at(0) })], NOW)).toEqual([])
  })
})

describe('payloadAgeMinutes', () => {
  it('reports how stale the payload is', () => {
    expect(payloadAgeMinutes(at(-32), NOW)).toBe(32)
  })

  it('never reports a negative age', () => {
    expect(payloadAgeMinutes(at(5), NOW)).toBe(0)
  })

  it('returns nothing when upstream did not say', () => {
    expect(payloadAgeMinutes(undefined, NOW)).toBeUndefined()
    expect(payloadAgeMinutes('rubbish', NOW)).toBeUndefined()
  })
})

describe('isStale', () => {
  // The upstream mirror froze for six hours with its timestamp stuck; every fissure, the
  // sortie and every cycle had expired, and the page read entirely as "expired".
  it('calls a feed that has stopped moving stale', () => {
    expect(isStale(at(-400), NOW)).toBe(true)
  })

  it('tolerates ordinary lag', () => {
    expect(isStale(at(-5), NOW)).toBe(false)
    expect(isStale(at(-29), NOW)).toBe(false)
  })

  it('does not treat a missing timestamp as stale', () => {
    expect(isStale(undefined, NOW)).toBe(false)
    expect(isStale('not a date', NOW)).toBe(false)
  })
})
