import { z } from 'zod'

import type { Item } from '@provenance/core'

/**
 * warframe.market slugs, so an item page can link to where the thing is actually traded.
 *
 * Only the slug is taken. Live prices would need a runtime proxy — that API sends no CORS
 * headers, so the browser cannot call it directly — and a link costs nothing, never goes
 * stale, and sends the reader somewhere that shows more than a single number would.
 *
 * The join is on `gameRef`, which is the `/Lotus/...` uniqueName our items already carry
 * from WFCD. That is an exact key rather than a guess. Transforming our own slug instead
 * looks tempting and is wrong 26% of the time: assembled weapons are sold as "<name>_set",
 * augment mods drop the warframe suffix our id keeps ("abating-link-trinity" is their
 * "abating_link"), and some items are not traded at all.
 */

export const RawMarketItem = z.object({
  slug: z.string().min(1),
  /** The `/Lotus/...` path. Absent on a few entries, which then fall back to name matching. */
  gameRef: z.string().optional(),
  i18n: z.record(z.string(), z.object({ name: z.string() }).loose()).optional(),
})
export type RawMarketItem = z.infer<typeof RawMarketItem>

export const RawMarketItems = z.object({ data: z.array(RawMarketItem) })

export interface MarketIndex {
  byGameRef: Map<string, string>
  byName: Map<string, string>
}

/** First writer wins, so a duplicate name cannot displace an earlier, better entry. */
export function buildMarketIndex(entries: RawMarketItem[]): MarketIndex {
  const byGameRef = new Map<string, string>()
  const byName = new Map<string, string>()

  for (const entry of entries) {
    if (entry.gameRef !== undefined && entry.gameRef !== '' && !byGameRef.has(entry.gameRef)) {
      byGameRef.set(entry.gameRef, entry.slug)
    }
    const name = entry.i18n?.en?.name
    if (typeof name === 'string' && name !== '') {
      const key = name.toLowerCase()
      if (!byName.has(key)) byName.set(key, entry.slug)
    }
  }

  return { byGameRef, byName }
}

/**
 * The market slug for one item, or undefined if their catalogue does not list it.
 *
 * `gameRef` first because it is an identity rather than a label; name second for the ~38%
 * of matches whose entry carries no gameRef.
 */
export function marketSlugFor(item: Item, index: MarketIndex): string | undefined {
  if (item.uniqueName !== undefined) {
    const byRef = index.byGameRef.get(item.uniqueName)
    if (byRef !== undefined) return byRef
  }
  return index.byName.get(item.name.toLowerCase())
}

export interface MarketLinkResult {
  items: Item[]
  linked: number
}

/**
 * Stamp `marketSlug` onto every item their catalogue knows.
 *
 * Not gated on our own `tradable` flag: 486 items it marks untradable are sold there
 * anyway, assembled Prime sets among them. Their catalogue is the authority on what they
 * sell, and this is the only question being asked of it.
 */
export function linkMarketSlugs(items: Item[], index: MarketIndex): MarketLinkResult {
  let linked = 0
  const out = items.map((item) => {
    const slug = marketSlugFor(item, index)
    if (slug === undefined) return item
    linked++
    return { ...item, marketSlug: slug }
  })
  return { items: out, linked }
}

/** The public page for a slug. One place, so the URL shape is not spread across components. */
export function marketUrl(slug: string): string {
  return `https://warframe.market/items/${slug}`
}
