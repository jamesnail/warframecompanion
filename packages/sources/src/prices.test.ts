import { describe, expect, it } from 'vitest'

import type { Item } from '@provenance/core'

import { RawTopOrders, priceUrl, pricableItems, summarise } from './prices'

const order = (platinum: number, status = 'ingame', visible = true) => ({
  platinum,
  quantity: 1,
  visible,
  user: { status },
})

const top = (sell: unknown[], buy: unknown[] = []) =>
  RawTopOrders.parse({ data: { sell, buy } })

describe('summarise', () => {
  it('reads the cheapest ask and the best bid', () => {
    const out = summarise('braton-prime', top([order(7), order(5), order(9)], [order(4), order(6)]))
    expect(out?.sellLow).toBe(5)
    expect(out?.buyHigh).toBe(6)
  })

  it('reports how many live orders each side rests on', () => {
    // The difference between "five sellers agree" and "one person is asking this".
    const out = summarise('x', top([order(5), order(7)], [order(3)]))
    expect(out).toMatchObject({ sellOrders: 2, buyOrders: 1 })
  })

  it('takes the median of the asks as the typical price', () => {
    const out = summarise('x', top([order(5), order(7), order(9)]))
    expect(out?.sellTypical).toBe(7)
  })

  it('takes the lower middle on an even count, so the number is a real listing', () => {
    const out = summarise('x', top([order(5), order(9)]))
    expect(out?.sellTypical).toBe(5)
  })

  describe('the filter that makes the number usable', () => {
    it('drops offline sellers', () => {
      // Measured against the live API: Vitality's mean across ALL visible sell orders is
      // 1,019 platinum with a max of 99,999, because of parked placeholder listings. The
      // in-game-only mean is 47. This test is that difference.
      const out = summarise('vitality', top([order(99999, 'offline'), order(40), order(45)]))
      expect(out?.sellLow).toBe(40)
      expect(out?.sellOrders).toBe(2)
    })

    it('drops a stale cheap listing from an offline seller', () => {
      // The other direction, and the more dangerous one: quoting 1 platinum invites someone
      // to try to buy at a price nobody will honour.
      const out = summarise('braton-prime', top([order(1, 'offline'), order(7)]))
      expect(out?.sellLow).toBe(7)
    })

    it('drops invisible orders', () => {
      expect(summarise('x', top([order(3, 'ingame', false), order(8)]))?.sellLow).toBe(8)
    })

    it('drops nonsense prices rather than publishing them', () => {
      expect(summarise('x', top([order(0), order(-5), order(12)]))?.sellLow).toBe(12)
    })

    it('accepts online as well as in-game', () => {
      expect(summarise('x', top([order(11, 'online')]))?.sellLow).toBe(11)
    })
  })

  describe('absence', () => {
    it('returns undefined when nothing is live, rather than a price of zero', () => {
      // "No price" and "price of 0" are different claims and only one of them is true.
      expect(summarise('x', top([order(5, 'offline')], [order(2, 'offline')]))).toBeUndefined()
      expect(summarise('x', top([], []))).toBeUndefined()
    })

    it('keeps one side when only the other is empty', () => {
      const sellOnly = summarise('x', top([order(5)], []))
      expect(sellOnly?.sellLow).toBe(5)
      expect(sellOnly?.buyHigh).toBeUndefined()
      expect(sellOnly?.buyOrders).toBe(0)

      const buyOnly = summarise('x', top([], [order(9)]))
      expect(buyOnly?.buyHigh).toBe(9)
      expect(buyOnly?.sellLow).toBeUndefined()
    })

    it('survives a response with the arrays missing entirely', () => {
      expect(summarise('x', RawTopOrders.parse({ data: {} }))).toBeUndefined()
    })
  })
})

describe('pricableItems', () => {
  const items: Item[] = [
    { id: 'b', name: 'B', category: 'Mod', tradable: true, marketSlug: 'b_slug' },
    { id: 'a', name: 'A', category: 'Mod', tradable: true, marketSlug: 'a_slug' },
    { id: 'no-slug', name: 'No slug', category: 'Mod', tradable: true },
  ]

  it('takes only items the market actually lists', () => {
    expect(pricableItems(items).map((entry) => entry.itemId)).toEqual(['a', 'b'])
  })

  it('is stably ordered, so a partial run is reproducible', () => {
    expect(pricableItems(items)).toEqual(pricableItems([...items].reverse()))
  })
})

describe('priceUrl', () => {
  it('asks for the top orders, not the full book', () => {
    // The full book is 510 KB per item — 1.6 GB across a sweep, daily, from a service run
    // by volunteers. This endpoint is 2.8 KB.
    expect(priceUrl('braton_prime_set')).toBe(
      'https://api.warframe.market/v2/orders/item/braton_prime_set/top',
    )
  })

  it('encodes a slug rather than trusting it', () => {
    expect(priceUrl('a b')).toContain('a%20b')
  })
})
