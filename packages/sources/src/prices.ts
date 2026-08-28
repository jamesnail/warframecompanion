import { z } from 'zod'

import type { Item, MarketPrice } from '@provenance/core'

/**
 * Live trade prices from warframe.market, read at build time.
 *
 * ## Why the `/top` endpoint and not the full order book
 *
 * The full book — `/v2/orders/item/{slug}` — is about 510 KB per item and ignores both
 * `?limit` and `?status`. Across the 3,185 items that have a market slug that is roughly
 * **1.6 GB per pipeline run**, every day, from a service run by volunteers for free. The tool
 * does not need it badly enough to justify that, so it is not taken.
 *
 * `/v2/orders/item/{slug}/top` is 2.8 KB and returns the five best live orders on each side,
 * already restricted to sellers who are online or in-game. Same sweep, about **9 MB**.
 *
 * ## What that costs, stated plainly
 *
 * A true count of every open offer, and a true mean across all of them, are not obtainable
 * this way. Neither is worth 1.6 GB a day, and both are worse numbers than they sound —
 * see the note on `MarketPrice` for what the unfiltered mean actually looks like. What the
 * endpoint gives instead is the two prices a player can act on: the cheapest live ask and the
 * highest live bid.
 */

/** One order as the v2 API returns it. Only the fields we use are described. */
export const RawOrder = z.object({
  platinum: z.number(),
  quantity: z.number().optional(),
  visible: z.boolean().optional(),
  user: z.object({ status: z.string().optional() }).partial().optional(),
})
export type RawOrder = z.infer<typeof RawOrder>

export const RawTopOrders = z.object({
  data: z.object({
    sell: z.array(RawOrder).optional(),
    buy: z.array(RawOrder).optional(),
  }),
})
export type RawTopOrders = z.infer<typeof RawTopOrders>

/**
 * Sellers who can trade right now.
 *
 * `/top` already filters to these, but it is asserted here rather than trusted: the endpoint's
 * contract is not documented anywhere we control, and a silent change upstream that started
 * including offline sellers would reintroduce exactly the 99,999-platinum artefact this whole
 * module exists to avoid.
 */
const LIVE = new Set(['ingame', 'online'])

function livePrices(orders: readonly RawOrder[] | undefined): number[] {
  return (orders ?? [])
    .filter((order) => order.visible !== false && LIVE.has(order.user?.status ?? ''))
    .map((order) => order.platinum)
    .filter((platinum) => Number.isFinite(platinum) && platinum > 0)
}

/** Median of a small already-known-short list. Even counts take the lower middle, so the
 *  result is always a price somebody is actually asking rather than an average of two. */
function median(sorted: readonly number[]): number | undefined {
  if (sorted.length === 0) return undefined
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

/**
 * Fold one item's top orders into the stored snapshot.
 *
 * Returns undefined when nothing is live on either side, so an item with no market activity
 * is absent from the dataset rather than present with zeroes — "no price" and "price of 0"
 * are different claims and only one of them is true.
 */
export function summarise(itemId: string, raw: RawTopOrders): MarketPrice | undefined {
  const sells = livePrices(raw.data.sell).sort((a, b) => a - b)
  const buys = livePrices(raw.data.buy).sort((a, b) => b - a)

  if (sells.length === 0 && buys.length === 0) return undefined

  return {
    itemId,
    ...(sells[0] !== undefined ? { sellLow: sells[0] } : {}),
    ...(median(sells) !== undefined ? { sellTypical: median(sells) } : {}),
    ...(buys[0] !== undefined ? { buyHigh: buys[0] } : {}),
    // Capped at five by the endpoint. Stored so the UI can distinguish "five sellers agree"
    // from "one person is asking this", which is the difference between a price and an anecdote.
    sellOrders: Math.min(sells.length, 5),
    buyOrders: Math.min(buys.length, 5),
  }
}

/** Every item that can be priced, paired with the slug to ask about. */
export function pricableItems(items: readonly Item[]): { itemId: string; slug: string }[] {
  return items
    .filter((item): item is Item & { marketSlug: string } => item.marketSlug !== undefined)
    .map((item) => ({ itemId: item.id, slug: item.marketSlug }))
    // Stable order so a partial run is reproducible and a diff is readable.
    .sort((a, b) => a.itemId.localeCompare(b.itemId))
}

export function priceUrl(slug: string): string {
  return `https://api.warframe.market/v2/orders/item/${encodeURIComponent(slug)}/top`
}
