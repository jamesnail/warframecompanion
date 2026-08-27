import { describe, expect, it } from 'vitest'
import type { ChainRelic, DropChain } from '@provenance/core'

import { buildNeeds, groupByAction, trackedTargets, type TrackedSet } from './farm'

const relic = (over: Partial<ChainRelic> = {}): ChainRelic => ({
  id: 'r',
  name: 'r relic',
  tier: 'Neo',
  rarity: 'common',
  vaulted: false,
  refinement: 'intact',
  chance: 0.25,
  ...over,
})

const chain = (id: string, over: Partial<DropChain> = {}): DropChain => ({
  itemId: id,
  itemName: id,
  relic: relic({ id: `${id}-relic`, name: `${id} relic` }),
  source: { id: 'elara', name: 'Elara', kind: 'mission', chance: 0.1, href: '/source/mission/elara' },
  runs: 40,
  ...over,
})

const set = (id: string, parts: string[]): TrackedSet => ({
  id,
  name: id,
  components: parts.map((itemId) => ({ itemId, count: 1 })),
})

describe('trackedTargets', () => {
  const sets = [set('alpha', ['a', 'b']), set('beta', ['c', 'd'])]

  it('returns only the sets the player named', () => {
    expect(trackedTargets(sets, new Set(['alpha'])).map((s) => s.id)).toEqual(['alpha'])
  })

  it('is empty when nothing is tracked — owning parts is not intent', () => {
    // The regression this whole model exists for: owning a shared component used to put
    // every set containing it on the plan. Orokin Cell belongs to 177 sets.
    expect(trackedTargets(sets, new Set())).toEqual([])
  })
})

describe('buildNeeds', () => {
  const chains = { b: chain('b'), d: chain('d') }

  it('lists only the missing parts of tracked sets', () => {
    const needs = buildNeeds(
      [set('alpha', ['a', 'b'])],
      new Set(['alpha']),
      new Set(['a']),
      chains,
      new Set(),
    )
    expect(needs.map((n) => n.chain.itemId)).toEqual(['b'])
  })

  it('ignores a set that is not tracked, however many parts you own', () => {
    const needs = buildNeeds(
      [set('alpha', ['a', 'b'])],
      new Set(),
      new Set(['a']),
      chains,
      new Set(),
    )
    expect(needs).toEqual([])
  })

  it('counts a part wanted by two sets once, and names both', () => {
    // You farm it once; that both sets want it is a reason to do it sooner, not twice.
    const sets = [set('alpha', ['a', 'b']), set('beta', ['c', 'b'])]
    const needs = buildNeeds(
      sets,
      new Set(['alpha', 'beta']),
      new Set(['a', 'c']),
      chains,
      new Set(),
    )
    expect(needs).toHaveLength(1)
    expect(needs[0]?.wantedBy).toEqual(['alpha', 'beta'])
  })

  it('marks a need as now when its tier has an open fissure', () => {
    const needs = buildNeeds(
      [set('alpha', ['a', 'b'])],
      new Set(['alpha']),
      new Set(['a']),
      chains,
      new Set(['Neo']),
    )
    expect(needs[0]?.status).toBe('now')
  })

  it('skips parts with no known chain rather than inventing one', () => {
    const needs = buildNeeds(
      [set('alpha', ['a', 'zzz'])],
      new Set(['alpha']),
      new Set(['a']),
      chains,
      new Set(),
    )
    expect(needs).toEqual([])
  })

  it('costs needs at the given squad size', () => {
    const args = [
      [set('alpha', ['a', 'b'])],
      new Set(['alpha']),
      new Set(['a']),
      chains,
      new Set<string>(),
    ] as const
    const solo = buildNeeds(...args, 1)
    const four = buildNeeds(...args, 4)
    expect(four[0]?.runs).toBeLessThan(solo[0]?.runs ?? 0)
  })
})

describe('groupByAction', () => {
  const sets = [set('alpha', ['a', 'b']), set('beta', ['c', 'd'])]
  const tracked = new Set(['alpha', 'beta'])
  const owned = new Set(['a', 'c'])

  it('collapses every need behind an open tier into one fissure action', () => {
    // The point of the page: one Neo fissure run counts toward all of them.
    const chains = { b: chain('b'), d: chain('d') }
    const needs = buildNeeds(sets, tracked, owned, chains, new Set(['Neo']))
    const actions = groupByAction(needs)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.kind).toBe('fissure')
    expect(actions[0]?.title).toBe('Neo fissure')
    expect(actions[0]?.needs).toHaveLength(2)
  })

  it('groups by mission when no fissure is open', () => {
    const chains = { b: chain('b'), d: chain('d') }
    const needs = buildNeeds(sets, tracked, owned, chains, new Set())
    const actions = groupByAction(needs)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.kind).toBe('source')
    expect(actions[0]?.title).toBe('Elara')
  })

  it('separates different tiers into different fissure actions', () => {
    const chains = { b: chain('b'), d: chain('d', { relic: relic({ tier: 'Axi' }) }) }
    const needs = buildNeeds(sets, tracked, owned, chains, new Set(['Neo', 'Axi']))
    expect(
      groupByAction(needs)
        .map((a) => a.title)
        .sort(),
    ).toEqual(['Axi fissure', 'Neo fissure'])
  })

  it('puts fissures first and blocked last', () => {
    const chains = {
      b: chain('b'),
      d: chain('d', { relic: relic({ vaulted: true }) }),
      f: chain('f', { relic: relic({ tier: 'Lith' }) }),
    }
    const needs = buildNeeds(
      [set('alpha', ['a', 'b', 'd', 'f'])],
      new Set(['alpha']),
      new Set(['a']),
      chains,
      new Set(['Neo']),
    )
    expect(groupByAction(needs).map((a) => a.kind)).toEqual(['fissure', 'source', 'blocked'])
  })

  it('is empty with nothing tracked', () => {
    expect(groupByAction([])).toEqual([])
  })
})

describe('tracking single items', () => {
  const chains = { b: chain('b'), d: chain('d') }

  it('plans a bare tracked item that belongs to no tracked set', () => {
    const needs = buildNeeds([], new Set(['b']), new Set(), chains, new Set())
    expect(needs.map((n) => n.chain.itemId)).toEqual(['b'])
    // It finishes itself, so there is no "finishes X" line to show.
    expect(needs[0]?.wantedBy).toEqual([])
  })

  it('does not plan a tracked item already owned', () => {
    expect(buildNeeds([], new Set(['b']), new Set(['b']), chains, new Set())).toEqual([])
  })

  it('does not double-count an item tracked directly and via a set', () => {
    const needs = buildNeeds(
      [set('alpha', ['a', 'b'])],
      new Set(['alpha', 'b']),
      new Set(['a']),
      chains,
      new Set(),
    )
    expect(needs).toHaveLength(1)
    expect(needs[0]?.wantedBy).toEqual(['alpha'])
  })
})
