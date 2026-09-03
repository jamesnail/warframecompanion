import { describe, expect, it } from 'vitest'

import { isSet, pathSourceIds, recipeOf } from './parts'

const ashPrime = {
  id: 'ash-prime',
  parts: [
    { itemId: 'ash-prime-blueprint', count: 1 },
    { itemId: 'ash-prime-systems-blueprint', count: 1 },
  ],
  ingredients: [{ itemId: 'orokin-cell', count: 1 }],
}

describe('isSet', () => {
  it('is about parts, not about having a recipe', () => {
    expect(isSet(ashPrime)).toBe(true)
    // Bronco's recipe is a blueprint and four resources. It is craftable; there is nothing
    // about it to farm that is not already its own item.
    expect(isSet({ parts: [] })).toBe(false)
    expect(isSet({})).toBe(false)
  })
})

describe('pathSourceIds', () => {
  it('carries the item and its parts', () => {
    expect(pathSourceIds(ashPrime)).toEqual([
      'ash-prime',
      'ash-prime-blueprint',
      'ash-prime-systems-blueprint',
    ])
  })

  it('never carries an ingredient', () => {
    // The whole point. Orokin Cell has 121 drop edges across missions, bounties and enemies;
    // admitting them here made `from:enemy` match every prime Warframe in the game.
    expect(pathSourceIds(ashPrime)).not.toContain('orokin-cell')
  })

  it('is just the item where there is no recipe', () => {
    expect(pathSourceIds({ id: 'rubedo' })).toEqual(['rubedo'])
  })
})

describe('recipeOf', () => {
  it('lists what you farm before what you supply', () => {
    expect(recipeOf(ashPrime).map((entry) => [entry.itemId, entry.part])).toEqual([
      ['ash-prime-blueprint', true],
      ['ash-prime-systems-blueprint', true],
      ['orokin-cell', false],
    ])
  })
})
