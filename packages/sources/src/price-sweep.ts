import type { Item, MarketPrice } from '@provenance/core'

import { fetchJson } from './fetch'
import { RawTopOrders, priceUrl, pricableItems, summarise } from './prices'

/**
 * The price sweep: one request per priceable item, paced.
 *
 * ~3,185 requests at three per second is about eighteen minutes, which is fine for a daily
 * cron and is the whole reason this cannot happen at request time. The pacing is not a
 * politeness gesture — warframe.market is run by volunteers and this tool is a guest on it.
 *
 * The sweep is deliberately NOT fatal. Every other dataset in the pipeline fails the build
 * loudly, because a truncated drop table would ship a lie. Prices are different in kind: they
 * are a third party's live service, they are a garnish on the tool rather than its product,
 * and an outage there is not a reason to stop publishing drop data. So a failed sweep leaves
 * the previous price chunk in place and says so, and only a sweep that succeeds broadly
 * enough to be trustworthy replaces it.
 */

export interface SweepOptions {
  /** Requests per second. Three is the working assumption; lower it, never raise it. */
  ratePerSecond?: number
  /** Stop after this many items. For local runs — CI always sweeps everything. */
  limit?: number
  onProgress?: (done: number, total: number, failures: number) => void
}

export interface SweepResult {
  prices: MarketPrice[]
  attempted: number
  failed: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The share of requests that must succeed before the result is allowed to replace what is
 * already published.
 *
 * Below this, the run is treated as an outage rather than as news: publishing a sweep where
 * half the items failed would silently delete prices from half the site, and a reader cannot
 * tell "nobody is selling this" from "our fetch fell over".
 */
export const SWEEP_FLOOR = 0.8

export function sweptEnough(result: SweepResult): boolean {
  if (result.attempted === 0) return false
  return (result.attempted - result.failed) / result.attempted >= SWEEP_FLOOR
}

export async function sweepPrices(
  items: readonly Item[],
  options: SweepOptions = {},
): Promise<SweepResult> {
  const { ratePerSecond = 3, limit, onProgress } = options
  const targets = pricableItems(items).slice(0, limit ?? undefined)
  const spacing = 1000 / ratePerSecond

  const prices: MarketPrice[] = []
  let failed = 0

  for (const [index, target] of targets.entries()) {
    const startedAt = Date.now()
    try {
      // Two retries rather than the default four: across thousands of requests a stubborn
      // item is not worth thirty seconds of backoff, and one missing price is a hidden
      // panel rather than a broken page.
      const raw = await fetchJson<unknown>(priceUrl(target.slug), { retries: 2, timeoutMs: 15_000 })
      const parsed = RawTopOrders.safeParse(raw)
      if (!parsed.success) {
        failed += 1
      } else {
        const price = summarise(target.itemId, parsed.data)
        if (price !== undefined) prices.push(price)
      }
    } catch {
      // An item that cannot be fetched is simply absent from the result. It is counted so
      // the caller can tell a quiet market from a broken sweep.
      failed += 1
    }

    if (onProgress !== undefined && (index + 1) % 200 === 0) {
      onProgress(index + 1, targets.length, failed)
    }

    // Pace from the START of the request, so a slow response does not add to the gap and
    // the sweep holds its rate rather than drifting slower and slower.
    const elapsed = Date.now() - startedAt
    if (elapsed < spacing && index < targets.length - 1) await sleep(spacing - elapsed)
  }

  return { prices, attempted: targets.length, failed }
}
