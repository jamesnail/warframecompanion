import { describe, expect, it } from 'vitest'
import type { Item } from '@provenance/core'

import { createSearchIndex } from './search-index'

/**
 * A broken search box is hard to spot because it returns *something* for most queries.
 * These assert the cases that actually matter: exact names win, prefixes do not swamp
 * their own family, and a typo still lands.
 */

const item = (id: string, name: string, category: Item['category'] = 'Component'): Item => ({
  id,
  name,
  category,
  tradable: false,
})

const items: Item[] = [
  item('braton-prime-barrel', 'Braton Prime Barrel'),
  item('braton-prime-blueprint', 'Braton Prime Blueprint'),
  item('braton-prime-receiver', 'Braton Prime Receiver'),
  item('braton-vandal-stock', 'Braton Vandal Stock'),
  item('forma-blueprint', 'Forma Blueprint', 'Blueprint'),
  item('nitain-extract', 'Nitain Extract', 'Resource'),
  item('orokin-cell', 'Orokin Cell', 'Resource'),
  item('lith-b4-relic', 'Lith B4 Relic', 'Relic'),
  item('rhino-prime-systems', 'Rhino Prime Systems'),
]

describe('createSearchIndex', () => {
  const index = createSearchIndex(items)

  it('reports how much it indexed', () => {
    expect(index.size).toBe(items.length)
  })

  it('returns nothing for an empty query rather than everything', () => {
    expect(index.search('')).toEqual([])
    expect(index.search('   ')).toEqual([])
  })

  it('finds an exact name', () => {
    const hits = index.search('Nitain Extract')
    expect(hits[0]?.id).toBe('nitain-extract')
  })

  it('matches case-insensitively', () => {
    expect(index.search('orokin cell')[0]?.id).toBe('orokin-cell')
    expect(index.search('OROKIN CELL')[0]?.id).toBe('orokin-cell')
  })

  it('matches on a later term, not just a prefix', () => {
    // Players type the distinctive word, not the full name from the left.
    const hits = index.search('receiver')
    expect(hits.map((h) => h.id)).toContain('braton-prime-receiver')
  })

  it('returns the whole family for a shared prefix', () => {
    const ids = index.search('braton prime').map((hit) => hit.id)
    expect(ids).toContain('braton-prime-barrel')
    expect(ids).toContain('braton-prime-blueprint')
    expect(ids).toContain('braton-prime-receiver')
    // Vandal is a different weapon and must not ride along on "prime".
    expect(ids).not.toContain('braton-vandal-stock')
  })

  it('tolerates a single typo', () => {
    // One transposition — the kind of thing that happens mid-sentence in game chat.
    expect(index.search('Nitian Extract').map((h) => h.id)).toContain('nitain-extract')
  })

  it('honours the limit', () => {
    expect(index.search('braton', 2)).toHaveLength(2)
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(index.search('zzzzzzzz')).toEqual([])
  })

  it('carries the category through for display', () => {
    expect(index.search('Forma Blueprint')[0]).toMatchObject({
      id: 'forma-blueprint',
      category: 'Blueprint',
    })
  })
})
