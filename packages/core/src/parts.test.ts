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
    // A recipe of nothing but resources is a crafting note. The pipeline never emits one and
    // a build gate fails if it does. isSet cannot be fooled by one even in principle: its
    // parameter is Pick<Item, 'parts'>, so an ingredient list is not in scope to be counted.
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
