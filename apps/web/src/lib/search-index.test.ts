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
    expect(index.search('').hits).toEqual([])
    expect(index.search('   ').hits).toEqual([])
  })

  it('finds an exact name', () => {
    const { hits } = index.search('Nitain Extract')
    expect(hits[0]?.id).toBe('nitain-extract')
  })

  it('matches case-insensitively', () => {
    expect(index.search('orokin cell').hits[0]?.id).toBe('orokin-cell')
    expect(index.search('OROKIN CELL').hits[0]?.id).toBe('orokin-cell')
  })

  it('matches on a later term, not just a prefix', () => {
    // Players type the distinctive word, not the full name from the left.
    const { hits } = index.search('receiver')
    expect(hits.map((h) => h.id)).toContain('braton-prime-receiver')
  })

  it('returns the whole family for a shared prefix', () => {
    const ids = index.search('braton prime').hits.map((hit) => hit.id)
    expect(ids).toContain('braton-prime-barrel')
    expect(ids).toContain('braton-prime-blueprint')
    expect(ids).toContain('braton-prime-receiver')
    // Vandal is a different weapon and must not ride along on "prime".
    expect(ids).not.toContain('braton-vandal-stock')
  })

  it('tolerates a single typo', () => {
    // One transposition — the kind of thing that happens mid-sentence in game chat.
    expect(index.search('Nitian Extract').hits.map((h) => h.id)).toContain('nitain-extract')
  })

  it('honours the limit', () => {
    expect(index.search('braton', 2).hits).toHaveLength(2)
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(index.search('zzzzzzzz').hits).toEqual([])
  })

  it('carries the category through for display', () => {
    expect(index.search('Forma Blueprint').hits[0]).toMatchObject({
      id: 'forma-blueprint',
      category: 'Blueprint',
    })
  })
})

describe('truncation reporting', () => {
  // The palette shows 20 rows. Without `total` it could not distinguish "these are all the
  // matches" from "these are 20 of 137", and silently presented the second as the first.
  it('reports the full match count even when the hits are capped', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `braton-part-${String(i)}`,
      name: `Braton Part ${String(i)}`,
      category: 'Component' as const,
      tradable: false,
    }))
    const index = createSearchIndex(many)

    const capped = index.search('braton', 5)
    expect(capped.hits).toHaveLength(5)
    expect(capped.total).toBe(50)
  })

  it('total equals hits.length when nothing was cut', () => {
    const index = createSearchIndex([
      { id: 'orokin-cell', name: 'Orokin Cell', category: 'Resource', tradable: false },
    ])
    const result = index.search('orokin')
    expect(result.total).toBe(result.hits.length)
  })

  it('reports zero for a query that matches nothing', () => {
    const index = createSearchIndex([
      { id: 'orokin-cell', name: 'Orokin Cell', category: 'Resource', tradable: false },
    ])
    expect(index.search('zzzzzzzz')).toEqual({ hits: [], total: 0 })
  })
})
