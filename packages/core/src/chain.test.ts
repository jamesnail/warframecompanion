import { describe, expect, it } from 'vitest'

import {
  bestChain,
  bestEdge,
  chainNoun,
  chainRuns,
  chainStatus,
  compareChains,
  type ChainRelic,
  type ChainSource,
  type DropChain,
} from './chain'

const source = (chance: number, over: Partial<ChainSource> = {}): ChainSource => ({
  id: 'elara',
  name: 'Elara (Jupiter)',
  kind: 'mission',
  chance,
  href: '/source/mission/jupiter/elara',
  ...over,
})

const relic = (over: Partial<ChainRelic> = {}): ChainRelic => ({
  id: 'neo-c7-relic',
  name: 'Neo C7 Relic',
  tier: 'Neo',
  rarity: 'common',
  vaulted: false,
  refinement: 'intact',
  chance: 0.2533,
  ...over,
})

const chain = (over: Partial<DropChain> = {}): DropChain => ({
  itemId: 'braton-prime-barrel',
  itemName: 'Braton Prime Barrel',
  relic: relic(),
  source: source(0.1106),
  runs: 0,
  ...over,
})

describe('chainRuns', () => {
  it('multiplies the two hops solo', () => {
    // 1 / (0.1106 * 0.2533) = 35.68...
    const c = chain()
    expect(chainRuns(c, 1)).toBeCloseTo(1 / (0.1106 * 0.2533), 6)
  })

  it('makes a share cheaper, but only on the relic hop', () => {
    const c = chain()
    const solo = chainRuns(c, 1)
    const four = chainRuns(c, 4)
    expect(four).toBeLessThan(solo)
    // Four players do NOT quarter the cost: each opens their own relic, so the gain is
    // 1 - (1-p)^4 on the reward, not 4x on the whole chain.
    expect(four).toBeGreaterThan(solo / 4)
  })

  it('ignores squad size for a direct drop', () => {
    // A squad does not make an enemy drop more often for you personally.
    const c = chain({ relic: undefined, source: source(0.25) })
    expect(chainRuns(c, 1)).toBeCloseTo(4, 9)
    expect(chainRuns(c, 4)).toBeCloseTo(4, 9)
  })

  it('is infinite with no source', () => {
    expect(chainRuns(chain({ source: undefined }), 1)).toBe(Number.POSITIVE_INFINITY)
  })

  it('is infinite at zero chance rather than dividing by zero', () => {
    expect(chainRuns(chain({ source: source(0) }), 1)).toBe(Number.POSITIVE_INFINITY)
    expect(chainRuns(chain({ relic: relic({ chance: 0 }) }), 1)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('chainStatus', () => {
  const none = new Set<string>()

  it('is now when a fissure of the relic tier is open', () => {
    expect(chainStatus(chain(), new Set(['Neo']))).toBe('now')
  })

  it('is ready when the relic is in rotation but no fissure is open', () => {
    expect(chainStatus(chain(), new Set(['Lith']))).toBe('ready')
  })

  it('is blocked when the relic is vaulted, open fissure or not', () => {
    const vaulted = chain({ relic: relic({ vaulted: true }) })
    expect(chainStatus(vaulted, none)).toBe('blocked')
    // A Neo fissure does not help you crack a relic you cannot obtain.
    expect(chainStatus(vaulted, new Set(['Neo']))).toBe('blocked')
  })

  it('is ready for a direct drop, never now', () => {
    // Nothing about a direct drop expires, so it never outranks a closing fissure.
    const direct = chain({ relic: undefined })
    expect(chainStatus(direct, none)).toBe('ready')
    expect(chainStatus(direct, new Set(['Neo']))).toBe('ready')
  })

  it('is blocked with no source at all', () => {
    expect(chainStatus(chain({ source: undefined }), new Set(['Neo']))).toBe('blocked')
  })
})

describe('compareChains', () => {
  const row = (status: 'now' | 'ready' | 'blocked', runs: number, name: string) => ({
    chain: chain({ itemName: name }),
    status,
    runs,
  })

  it('puts an expiring route above a cheaper permanent one', () => {
    // The whole point of the ranking: a fissure closes, a mission does not.
    const rows = [row('ready', 4, 'Cheap'), row('now', 400, 'Expensive')]
    rows.sort(compareChains)
    expect(rows.map((r) => r.chain.itemName)).toEqual(['Expensive', 'Cheap'])
  })

  it('sorts by cost within a status', () => {
    const rows = [row('now', 90, 'B'), row('now', 12, 'A')]
    rows.sort(compareChains)
    expect(rows.map((r) => r.runs)).toEqual([12, 90])
  })

  it('breaks ties by name so the order is total', () => {
    const rows = [row('ready', 10, 'Zephyr'), row('ready', 10, 'Ash')]
    rows.sort(compareChains)
    expect(rows.map((r) => r.chain.itemName)).toEqual(['Ash', 'Zephyr'])
  })

  it('sinks blocked routes below everything', () => {
    const rows = [row('blocked', 1, 'Vaulted'), row('ready', 999, 'Slow')]
    rows.sort(compareChains)
    expect(rows.map((r) => r.status)).toEqual(['ready', 'blocked'])
  })
})

describe('bestChain', () => {
  it('picks the cheapest route by expected solo runs', () => {
    const best = bestChain('x', 'X', [
      { relic: relic({ chance: 0.02 }), source: source(0.1) }, // 500 runs
      { relic: relic({ id: 'b', chance: 0.25 }), source: source(0.1) }, // 40 runs
    ])
    expect(best.relic?.id).toBe('b')
    expect(best.runs).toBeCloseTo(40, 6)
  })

  it('prefers a direct drop when it is genuinely cheaper', () => {
    const best = bestChain('x', 'X', [
      { relic: relic({ chance: 0.02 }), source: source(0.1) }, // 500 runs
      { relic: undefined, source: source(0.2) }, // 5 runs
    ])
    expect(best.relic).toBeUndefined()
    expect(best.runs).toBeCloseTo(5, 9)
  })

  it('returns an unreachable chain rather than throwing when there are no candidates', () => {
    // Quest-locked and unobtainable items exist; the page must render them, not 500.
    const best = bestChain('x', 'X', [])
    expect(best.runs).toBe(Number.POSITIVE_INFINITY)
    expect(best.source).toBeUndefined()
  })
})

describe('bestEdge', () => {
  it('takes the highest per-run chance, accounting for events per run', () => {
    const edges = [
      { itemId: 'r', sourceId: 'a', chance: 0.1 },
      // Two shots at 6% per run beats one at 10%.
      { itemId: 'r', sourceId: 'b', chance: 0.06, eventsPerRun: 2 },
    ]
    // @ts-expect-error - partial DropEdge is enough for this pure helper
    expect(bestEdge(edges)?.edge.sourceId).toBe('b')
  })

  it('is undefined with no edges', () => {
    expect(bestEdge([])).toBeUndefined()
  })
})

describe('bestChain vaulting', () => {
  it('prefers a farmable relic over a cheaper vaulted one', () => {
    // The vaulted route is 10x cheaper on paper and still must not win: you cannot obtain
    // the relic at all, so presenting it as "best" sends the reader nowhere.
    const best = bestChain('x', 'X', [
      { relic: relic({ id: 'vaulted', vaulted: true, chance: 0.25 }), source: source(0.4) },
      { relic: relic({ id: 'live', vaulted: false, chance: 0.02 }), source: source(0.1) },
    ])
    expect(best.relic?.id).toBe('live')
  })

  it('falls back to a vaulted route when nothing else exists', () => {
    const best = bestChain('x', 'X', [
      { relic: relic({ id: 'vaulted', vaulted: true, chance: 0.25 }), source: source(0.4) },
    ])
    expect(best.relic?.id).toBe('vaulted')
  })
})

describe('chainNoun', () => {
  it('a direct enemy drop is counted in kills', () => {
    const c = chain({ relic: undefined, source: source(0.05, { kind: 'enemy' }) })
    expect(chainNoun(c).many).toBe('kills')
  })

  it('a direct mission drop is counted in runs', () => {
    expect(chainNoun(chain({ relic: undefined })).many).toBe('runs')
  })

  it('a relic route is counted in runs even when an enemy drops the relic', () => {
    // chainRuns there is farm-the-relic AND crack-it-at-a-fissure. The fissure is a mission
    // you queue, so "kills" would name only half the total.
    const c = chain({ source: source(0.05, { kind: 'enemy' }) })
    expect(chainNoun(c).many).toBe('runs')
  })

  it('a chain with no source at all falls back to runs rather than throwing', () => {
    expect(chainNoun(chain({ relic: undefined, source: undefined })).many).toBe('runs')
  })
})
