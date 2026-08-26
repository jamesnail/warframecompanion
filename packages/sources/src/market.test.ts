import { describe, expect, it } from 'vitest'

import type { Item } from '@provenance/core'

import { buildMarketIndex, linkMarketSlugs, marketSlugFor, marketUrl, type RawMarketItem } from './market'

const entry = (slug: string, name: string, gameRef?: string): RawMarketItem => ({
  slug,
  ...(gameRef === undefined ? {} : { gameRef }),
  i18n: { en: { name } },
})

const catalogue: RawMarketItem[] = [
  entry('braton_prime_barrel', 'Braton Prime Barrel', '/Lotus/Weapons/Tenno/Rifle/BratonPrimeBarrel'),
  // Sold as a set; our item is just "Akbronco Prime".
  entry('akbronco_prime_set', 'Akbronco Prime Set', '/Lotus/Weapons/Tenno/Pistol/AkBroncoPrime'),
  // Their name drops the warframe suffix our id keeps.
  entry('abating_link', 'Abating Link'),
  entry('axi_a1_relic', 'Axi A1 Relic'),
]

const index = buildMarketIndex(catalogue)

const item = (over: Partial<Item>): Item => ({
  id: 'x',
  name: 'X',
  category: 'Other',
  tradable: true,
  ...over,
})

describe('marketSlugFor', () => {
  // The whole point: an identity, not a label.
  it('matches on gameRef, which is the uniqueName we already carry', () => {
    const found = marketSlugFor(
      item({ name: 'Something Else Entirely', uniqueName: '/Lotus/Weapons/Tenno/Rifle/BratonPrimeBarrel' }),
      index,
    )
    expect(found).toBe('braton_prime_barrel')
  })

  it('finds the set slug our own name would never produce', () => {
    const found = marketSlugFor(
      item({ id: 'akbronco-prime', name: 'Akbronco Prime', uniqueName: '/Lotus/Weapons/Tenno/Pistol/AkBroncoPrime' }),
      index,
    )
    expect(found).toBe('akbronco_prime_set')
  })

  it('falls back to name when the entry has no gameRef', () => {
    expect(marketSlugFor(item({ name: 'Abating Link' }), index)).toBe('abating_link')
  })

  it('is case-insensitive on the name', () => {
    expect(marketSlugFor(item({ name: 'axi a1 relic' }), index)).toBe('axi_a1_relic')
  })

  it('returns nothing for an item they do not sell', () => {
    expect(marketSlugFor(item({ name: 'Boot' }), index)).toBeUndefined()
  })

  it('does not match on a uniqueName they do not list', () => {
    expect(marketSlugFor(item({ name: 'Nope', uniqueName: '/Lotus/Nope' }), index)).toBeUndefined()
  })
})

describe('buildMarketIndex', () => {
  it('keeps the first entry when a name repeats', () => {
    const dupes = buildMarketIndex([entry('first', 'Same Name'), entry('second', 'Same Name')])
    expect(dupes.byName.get('same name')).toBe('first')
  })

  it('ignores an entry with no english name rather than throwing', () => {
    const partial = buildMarketIndex([{ slug: 'only_ref', gameRef: '/Lotus/Only' }])
    expect(partial.byGameRef.get('/Lotus/Only')).toBe('only_ref')
    expect(partial.byName.size).toBe(0)
  })
})

describe('linkMarketSlugs', () => {
  it('stamps the slug and counts what it linked', () => {
    const result = linkMarketSlugs([item({ id: 'a', name: 'Abating Link' }), item({ id: 'b', name: 'Boot' })], index)
    expect(result.linked).toBe(1)
    expect(result.items.find((i) => i.id === 'a')?.marketSlug).toBe('abating_link')
    expect(result.items.find((i) => i.id === 'b')?.marketSlug).toBeUndefined()
  })

  // 486 items our own flag calls untradable are sold there regardless.
  it('ignores our tradable flag, because their catalogue is the authority', () => {
    const result = linkMarketSlugs([item({ id: 'a', name: 'Abating Link', tradable: false })], index)
    expect(result.items[0]?.marketSlug).toBe('abating_link')
  })

  it('leaves the rest of the item untouched', () => {
    const original = item({ id: 'a', name: 'Abating Link', category: 'Mod', masteryReq: 4 })
    const result = linkMarketSlugs([original], index)
    expect(result.items[0]).toMatchObject({ id: 'a', category: 'Mod', masteryReq: 4 })
  })
})

describe('marketUrl', () => {
  it('builds the public page URL', () => {
    expect(marketUrl('braton_prime_barrel')).toBe('https://warframe.market/items/braton_prime_barrel')
  })
})
