import { describe, expect, it } from 'vitest'
import type { DropChain } from '@provenance/core'

import { buildNeeds, groupByAction, inProgress, type TrackedSet } from './farm'

const chain = (id: string, over: Partial<DropChain> = {}): DropChain => ({
  itemId: id,
  itemName: id,
  relic: {
    id: `${id}-relic`,
    name: `${id} relic`,
    tier: 'Neo',
    rarity: 'common',
    vaulted: false,
    refinement: 'intact',
    chance: 0.25,
  },
  source: { id: 'elara', name: 'Elara', kind: 'mission', chance: 0.1, href: '/source/mission/elara' },
  runs: 40,
  ...over,
})

const set = (id: string, parts: string[]): TrackedSet => ({
  id,
  name: id,
  components: parts.map((itemId) => ({ itemId, count: 1 })),
})

describe('inProgress', () => {
  const sets = [set('alpha', ['a', 'b']), set('beta', ['c', 'd'])]

  it('counts a set with some but not all parts', () => {
    expect(inProgress(sets, new Set(['a'])).map((s) => s.id)).toEqual(['alpha'])
  })

  it('ignores untouched sets — that is the whole game, not a plan', () => {
    expect(inProgress(sets, new Set())).toEqual([])
  })

  it('ignores finished sets', () => {
    expect(inProgress(sets, new Set(['a', 'b']))).toEqual([])
  })
})

describe('buildNeeds', () => {
  const chains = { b: chain('b'), d: chain('d') }

  it('lists only the missing parts of sets in progress', () => {
    const needs = buildNeeds([set('alpha', ['a', 'b'])], new Set(['a']), chains, new Set())
    expect(needs.map((n) => n.chain.itemId)).toEqual(['b'])
  })

  it('counts a part wanted by two sets once, and names both', () => {
    // You farm it once; that both sets want it is a reason to do it sooner, not twice.
    const sets = [set('alpha', ['a', 'b']), set('beta', ['c', 'b'])]
    const needs = buildNeeds(sets, new Set(['a', 'c']), chains, new Set())
    expect(needs).toHaveLength(1)
    expect(needs[0]?.wantedBy).toEqual(['alpha', 'beta'])
  })

  it('marks a need as now when its tier has an open fissure', () => {
    const needs = buildNeeds([set('alpha', ['a', 'b'])], new Set(['a']), chains, new Set(['Neo']))
    expect(needs[0]?.status).toBe('now')
  })

  it('skips parts with no known chain rather than inventing one', () => {
    const needs = buildNeeds([set('alpha', ['a', 'zzz'])], new Set(['a']), chains, new Set())
    expect(needs).toEqual([])
  })

  it('costs needs at the given squad size', () => {
    const solo = buildNeeds([set('alpha', ['a', 'b'])], new Set(['a']), chains, new Set(), 1)
    const four = buildNeeds([set('alpha', ['a', 'b'])], new Set(['a']), chains, new Set(), 4)
    expect(four[0]?.runs).toBeLessThan(solo[0]?.runs ?? 0)
  })
})

describe('groupByAction', () => {
  it('collapses every need behind an open tier into one fissure action', () => {
    // The point of the page: one Neo fissure run counts toward all of them.
    const chains = { b: chain('b'), d: chain('d') }
    const sets = [set('alpha', ['a', 'b']), set('beta', ['c', 'd'])]
    const needs = buildNeeds(sets, new Set(['a', 'c']), chains, new Set(['Neo']))
    const actions = groupByAction(needs)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.kind).toBe('fissure')
    expect(actions[0]?.title).toBe('Neo fissure')
    expect(actions[0]?.needs).toHaveLength(2)
  })

  it('groups by mission when no fissure is open', () => {
    const chains = { b: chain('b'), d: chain('d') }
    const sets = [set('alpha', ['a', 'b']), set('beta', ['c', 'd'])]
    const needs = buildNeeds(sets, new Set(['a', 'c']), chains, new Set())
    const actions = groupByAction(needs)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.kind).toBe('source')
    expect(actions[0]?.title).toBe('Elara')
  })

  it('separates different tiers into different fissure actions', () => {
    const chains = {
      b: chain('b'),
      d: chain('d', { relic: { ...chain('d').relic!, tier: 'Axi' } }),
    }
    const sets = [set('alpha', ['a', 'b']), set('beta', ['c', 'd'])]
    const needs = buildNeeds(sets, new Set(['a', 'c']), chains, new Set(['Neo', 'Axi']))
    expect(groupByAction(needs).map((a) => a.title).sort()).toEqual(['Axi fissure', 'Neo fissure'])
  })

  it('puts fissures first and blocked last', () => {
    const chains = {
      b: chain('b'),
      d: chain('d', { relic: { ...chain('d').relic!, vaulted: true } }),
      f: chain('f', { relic: { ...chain('f').relic!, tier: 'Lith' } }),
    }
    const sets = [set('alpha', ['a', 'b', 'd', 'f'])]
    const needs = buildNeeds(sets, new Set(['a']), chains, new Set(['Neo']))
    const actions = groupByAction(needs)
    expect(actions.map((a) => a.kind)).toEqual(['fissure', 'source', 'blocked'])
  })

  it('is empty for an empty collection', () => {
    expect(groupByAction([])).toEqual([])
  })
})
