import { describe, expect, it } from 'vitest'

import {
  factionActivity,
  groupFissuresByTier,
  isStale,
  openFissures,
  parseWorldState,
  payloadAgeMinutes,
  timeUntil,
  traderIsHere,
  type Fissure,
  type NodeIndex,
  type WorldState,
} from './world'

const NOW = Date.parse('2026-08-26T12:00:00.000Z')
const at = (minutes: number) => NOW + minutes * 60000
/** DE's wrapper shape. */
const de = (ms: number) => ({ $date: { $numberLong: String(ms) } })

const NODES: NodeIndex = {
  SolNode195: {
    id: 'SolNode195',
    name: 'Hydron',
    planet: 'Sedna',
    faction: 'Grineer',
    missionType: 'Defense',
    sourceId: 'mission:sedna/hydron',
  },
  // A real node this site has no page for — no unique drops, so the drop tables never mention it.
  SolNode500: { id: 'SolNode500', name: 'Eurasia', planet: 'Earth', faction: 'Grineer' },
  CrewBattleNode518: {
    id: 'CrewBattleNode518',
    name: 'Nsu Grid',
    planet: 'Veil Proxima',
    faction: 'Grineer',
    missionType: 'Skirmish',
  },
}

const PAYLOAD = {
  Time: Math.floor(at(-2) / 1000),
  ActiveMissions: [
    { _id: { $oid: 'a' }, Node: 'SolNode195', Expiry: de(at(60)), MissionType: 'MT_VOID_CASCADE', Modifier: 'VoidT3' },
    { _id: { $oid: 'b' }, Node: 'SolNode500', Expiry: de(at(20)), MissionType: 'MT_CAPTURE', Modifier: 'VoidT1' },
    // Already dead, and upstream keeps returning these.
    { _id: { $oid: 'c' }, Node: 'SolNode195', Expiry: de(at(-30)), Modifier: 'VoidT1' },
    // No tier: not a fissure we can place.
    { _id: { $oid: 'd' }, Node: 'SolNode195', Expiry: de(at(60)) },
  ],
  VoidStorms: [
    { _id: { $oid: 'e' }, Node: 'CrewBattleNode518', Expiry: de(at(45)), ActiveMissionTier: 'VoidT2' },
  ],
  Sorties: [
    {
      Expiry: de(at(240)),
      Boss: 'SORTIE_BOSS_PHORID',
      Variants: [
        { missionType: 'MT_MOBILE_DEFENSE', modifierType: 'SORTIE_MODIFIER_HAZARD_ICE', node: 'SolNode195' },
      ],
    },
  ],
  LiteSorties: [{ Expiry: de(at(4000)), Boss: 'SORTIE_BOSS_NIRA', Missions: [{ node: 'SolNode500' }] }],
  VoidTraders: [
    { Activation: de(at(1000)), Expiry: de(at(3880)), Character: "Baro'Ki Teel", Node: 'SolNode195', Manifest: [] },
  ],
}

const INVASIONS = {
  invasions: [
    { id: 'i1', node: 'SolNode195', ally: 'FC_GRINEER', enemy: 'FC_CORPUS' },
    // The feed lists one row per side, both with the same id.
    { id: 'i1', node: 'SolNode195', ally: 'FC_CORPUS', enemy: 'FC_GRINEER' },
  ],
}

const state = parseWorldState(PAYLOAD, INVASIONS, NODES)

describe('parseWorldState', () => {
  it('resolves internal node ids to places a player recognises', () => {
    const first = state.fissures.find((f) => f.id === 'a')
    expect(first).toMatchObject({ node: 'Hydron', planet: 'Sedna', faction: 'Grineer' })
  })

  it('translates DE tokens into words', () => {
    const first = state.fissures.find((f) => f.id === 'a')
    expect(first?.tier).toBe('Neo')
    expect(first?.missionType).toBe('Void Cascade')
  })

  it('reads DE nested timestamps', () => {
    expect(state.fissures.find((f) => f.id === 'a')?.expiry).toBe(at(60))
  })

  it('folds Railjack void storms in and marks them', () => {
    const storm = state.fissures.find((f) => f.id === 'e')
    expect(storm).toMatchObject({ node: 'Nsu Grid', tier: 'Meso', isStorm: true })
    // A storm carries no MissionType, so the node's own type answers it.
    expect(storm?.missionType).toBe('Skirmish')
  })

  it('drops a row it cannot place rather than guessing', () => {
    expect(state.fissures.some((f) => f.id === 'd')).toBe(false)
  })

  // Linking on a name lookup alone 404s for nodes with no unique drops.
  it('only carries a source link where the server said a page exists', () => {
    expect(state.fissures.find((f) => f.id === 'a')?.sourceId).toBe('mission:sedna/hydron')
    expect(state.fissures.find((f) => f.id === 'b')?.sourceId).toBeUndefined()
  })

  it('keeps an unknown node as its id rather than blanking it', () => {
    const unknown = parseWorldState(
      { ActiveMissions: [{ Node: 'SolNode999', Expiry: de(at(10)), Modifier: 'VoidT1' }] },
      {},
      NODES,
    )
    expect(unknown.fissures[0]?.node).toBe('SolNode999')
  })

  it('deduplicates the two rows an invasion arrives as', () => {
    expect(state.invasions).toHaveLength(1)
    expect(state.invasions[0]).toMatchObject({ attacker: 'Grineer', defender: 'Corpus' })
  })

  it('reads the sortie and the archon hunt from their separate keys', () => {
    expect(state.sortie?.boss).toBe('Phorid')
    expect(state.sortie?.variants[0]).toMatchObject({
      node: 'Hydron',
      missionType: 'Mobile Defense',
      modifier: 'Hazard Ice',
    })
    expect(state.archonHunt?.boss).toBe('Nira')
  })

  it('reads the void trader', () => {
    expect(state.voidTrader?.node).toBe('Hydron')
    expect(traderIsHere(state.voidTrader, NOW)).toBe(false)
  })

  // The reason parsing is per-section.
  it('survives rubbish without throwing', () => {
    expect(() => parseWorldState(null, null, {})).not.toThrow()
    expect(parseWorldState(null, null, {}).fissures).toEqual([])
    expect(parseWorldState({ ActiveMissions: 'nope' }, {}, {}).fissures).toEqual([])
    expect(parseWorldState(42, 42, {}).invasions).toEqual([])
  })
})

describe('openFissures', () => {
  it('drops fissures whose expiry has passed', () => {
    const open = openFissures(state.fissures, NOW)
    expect(open.some((f) => f.id === 'c')).toBe(false)
    expect(open).toHaveLength(3)
  })
})

describe('groupFissuresByTier', () => {
  const fissure = (tier: string, expiry: number, id = tier + String(expiry)): Fissure => ({
    id,
    node: 'X',
    planet: undefined,
    sourceId: undefined,
    missionType: undefined,
    faction: undefined,
    tier,
    expiry,
    isHard: false,
    isStorm: false,
  })

  it('orders tiers the way the game lists them', () => {
    const groups = groupFissuresByTier([
      fissure('Axi', at(10)),
      fissure('Lith', at(10)),
      fissure('Neo', at(10)),
      fissure('Meso', at(10)),
    ])
    expect(groups.map((g) => g.tier)).toEqual(['Lith', 'Meso', 'Neo', 'Axi'])
  })

  it('sorts soonest-to-expire first within a tier', () => {
    const groups = groupFissuresByTier([
      fissure('Lith', at(90), 'late'),
      fissure('Lith', at(10), 'soon'),
    ])
    expect(groups[0]?.fissures.map((f) => f.id)).toEqual(['soon', 'late'])
  })
})

describe('factionActivity', () => {
  it('counts fissures and invasions per faction, busiest first', () => {
    const activity = factionActivity(state)
    expect(activity[0]?.faction).toBe('Grineer')
    expect(activity.find((a) => a.faction === 'Corpus')?.invasions).toBe(1)
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
  })
})

describe('isStale', () => {
  it('accepts a feed that is merely lagging', () => {
    expect(isStale(state, NOW)).toBe(false)
  })

  it('calls a feed with an old timestamp stale', () => {
    expect(isStale({ ...state, timestamp: at(-400) }, NOW)).toBe(true)
  })

  /**
   * The load-bearing half: DE's own payload does not always carry `Time`, so a frozen feed
   * has to be detectable from the content. If every fissure has expired, it has stopped.
   */
  it('calls a feed stale when every fissure has expired, even with no timestamp', () => {
    const dead: WorldState = {
      ...state,
      timestamp: undefined,
      fissures: state.fissures.map((f) => ({ ...f, expiry: at(-60) })),
    }
    expect(isStale(dead, NOW)).toBe(true)
  })

  it('does not call an empty feed stale, because that is not evidence', () => {
    expect(isStale({ ...state, timestamp: undefined, fissures: [] }, NOW)).toBe(false)
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
  })
})

describe('void trader naming', () => {
  // DE spells him "Baro'Ki Teel" internally; the game's own UI says "Baro Ki'Teer".
  it("uses the name players know", () => {
    const parsed = parseWorldState(
      { VoidTraders: [{ Character: "Baro'Ki Teel", Node: 'SolNode195' }] },
      {},
      NODES,
    )
    expect(parsed.voidTrader?.character).toBe("Baro Ki'Teer")
  })

  it('leaves any other trader name alone', () => {
    const parsed = parseWorldState({ VoidTraders: [{ Character: 'Someone Else' }] }, {}, NODES)
    expect(parsed.voidTrader?.character).toBe('Someone Else')
  })
})
