import { describe, expect, it } from 'vitest'

import { FARM_OVERRIDES, farmStrategy, ranksByYield } from './farming'
import type { ItemCategory } from './types'

const item = (
  id: string,
  category: ItemCategory,
  components?: readonly unknown[],
): { id: string; category: ItemCategory; components?: readonly unknown[] } =>
  components === undefined ? { id, category } : { id, category, components }

describe('farmStrategy', () => {
  it('a relic path beats the category, because a prime part is filed as a Component', () => {
    expect(farmStrategy(item('braton-prime-barrel', 'Component'), true)).toBe('relic-chain')
    expect(farmStrategy(item('ash-prime-systems', 'Component'), true)).toBe('relic-chain')
  })

  it('an override beats even a relic path', () => {
    // Aya drops from relic-era content but is a currency, and the chain would misdescribe it.
    expect(farmStrategy(item('aya', 'Resource'), true)).toBe('currency')
  })

  it('resources rank by yield, wherever upstream filed them', () => {
    expect(farmStrategy(item('plastids', 'Resource'), false)).toBe('resource')
    // QUIRK: these two are categorised `Other` upstream despite being the two most farmed
    // resources in the game.
    expect(farmStrategy(item('ferrite', 'Other'), false)).toBe('resource')
    expect(farmStrategy(item('neurodes', 'Other'), false)).toBe('resource')
  })

  it('Endo is a currency, not the container that happens to hold 80 of it', () => {
    expect(farmStrategy(item('endo', 'Resource'), false)).toBe('currency')
  })

  it('an item with a recipe is built, not farmed', () => {
    expect(farmStrategy(item('braton-prime', 'Primary', [{}, {}]), false)).toBe('assembled')
    // ...unless it also drops from a relic, which is the more actionable answer.
    expect(farmStrategy(item('braton-prime', 'Primary', [{}]), true)).toBe('relic-chain')
  })

  it('mods and arcanes keep the chance ranking', () => {
    expect(farmStrategy(item('serration', 'Mod'), false)).toBe('mod')
    expect(farmStrategy(item('arcane-energize', 'Arcane'), false)).toBe('mod')
  })

  it('everything else is a plain direct drop', () => {
    expect(farmStrategy(item('lith-b4-relic', 'Relic'), false)).toBe('direct')
    expect(farmStrategy(item('some-cosmetic', 'Cosmetic'), false)).toBe('direct')
  })

  it('an empty component list is not an assembled item', () => {
    expect(farmStrategy(item('thing', 'Other', []), false)).toBe('direct')
  })
})

describe('ranksByYield', () => {
  it('is true exactly where an item stacks', () => {
    expect(ranksByYield('resource')).toBe(true)
    expect(ranksByYield('currency')).toBe(true)
    expect(ranksByYield('relic-chain')).toBe(false)
    expect(ranksByYield('mod')).toBe(false)
    expect(ranksByYield('direct')).toBe(false)
    expect(ranksByYield('assembled')).toBe(false)
  })
})

describe('FARM_OVERRIDES', () => {
  it('stays short — a long list means the category rules are wrong', () => {
    expect(Object.keys(FARM_OVERRIDES).length).toBeLessThanOrEqual(15)
  })
})
