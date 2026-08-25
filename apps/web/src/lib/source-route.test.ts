import { describe, expect, it } from 'vitest'

import {
  needsSourcePage,
  relicItemIdFor,
  sourceHref,
  sourceIdFromRoute,
  sourceRouteParams,
  splitSourceId,
} from './source-route'

const ITEMS = new Set(['axi-a1-relic', 'braton-prime-barrel'])
const hasItem = (id: string): boolean => ITEMS.has(id)

describe('splitSourceId', () => {
  it('splits on the FIRST separator, leaving slashes in the rest', () => {
    expect(splitSourceId('mission:earth/cambria')).toEqual({ kind: 'mission', rest: 'earth/cambria' })
  })

  it('does not throw on an unnamespaced id', () => {
    expect(splitSourceId('lancer')).toEqual({ kind: 'other', rest: 'lancer' })
  })
})

describe('route params', () => {
  // If these two ever disagree, every link on the site 404s, so the round trip is asserted
  // directly rather than inferred from the two halves passing separately.
  it.each([
    'mission:earth/cambria',
    'enemy:lancer',
    'bounty:cetus/level-5-15-cetus-bounty',
    'syndicate:red-veil',
    'sortie:daily',
  ])('round-trips %s exactly', (id) => {
    const { kind, slug } = sourceRouteParams(id)
    expect(sourceIdFromRoute(kind, slug)).toBe(id)
  })

  it('splits a nested rest into one segment per level', () => {
    expect(sourceRouteParams('mission:earth/cambria').slug).toEqual(['earth', 'cambria'])
  })
})

describe('relicItemIdFor', () => {
  it('maps a relic source onto its item', () => {
    expect(relicItemIdFor('relic:axi-a1')).toBe('axi-a1-relic')
  })

  it('is undefined for every other kind', () => {
    expect(relicItemIdFor('mission:earth/cambria')).toBeUndefined()
  })
})

describe('sourceHref', () => {
  it('sends a relic to its item page, not to a second page for the same object', () => {
    expect(sourceHref('relic:axi-a1', hasItem)).toBe('/item/axi-a1-relic')
  })

  it('falls back to a source page when the relic item is missing', () => {
    expect(sourceHref('relic:axi-z9', hasItem)).toBe('/source/relic/axi-z9')
  })

  it('builds a catch-all path for everything else', () => {
    expect(sourceHref('mission:earth/cambria', hasItem)).toBe('/source/mission/earth/cambria')
    expect(sourceHref('enemy:lancer', hasItem)).toBe('/source/enemy/lancer')
  })

  it('encodes each segment without encoding the separators', () => {
    expect(sourceHref('other:a b/c d', hasItem)).toBe('/source/other/a%20b/c%20d')
  })
})

describe('needsSourcePage', () => {
  // The invariant that keeps generateStaticParams and sourceHref in agreement.
  it.each(['relic:axi-a1', 'relic:axi-z9', 'mission:earth/cambria', 'enemy:lancer'])(
    'agrees with sourceHref for %s',
    (id) => {
      expect(needsSourcePage(id, hasItem)).toBe(sourceHref(id, hasItem).startsWith('/source/'))
    },
  )
})
