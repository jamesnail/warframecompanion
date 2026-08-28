'use client'

import { useEffect, useState } from 'react'

import type { MarketPrice } from '@provenance/core'

import { Panel, PanelHeader, SummaryCard } from '@/components/Primitives'
import { loadPrices } from '@/lib/client/dataset'
import { useAppliedSettings } from '@/lib/client/use-settings'

/**
 * What one item is trading for, from the last build.
 *
 * A client island rather than server-rendered data, because prices are the one chunk that
 * changes on its own schedule — baking them into 4,875 static pages would mean rebuilding
 * every page whenever the market moved.
 *
 * Renders nothing at all when there is no price: an item nobody is selling gets no panel
 * rather than a panel full of dashes. Same when "drops only" is on — this is the trading
 * surface that setting exists to hide.
 */
export function MarketPricePanel({ itemId, marketSlug }: { itemId: string; marketSlug: string }) {
  const { dropsOnly } = useAppliedSettings()
  const [price, setPrice] = useState<MarketPrice | undefined>(undefined)
  const [state, setState] = useState<'loading' | 'done'>('loading')

  useEffect(() => {
    let cancelled = false
    void loadPrices().then((prices) => {
      if (cancelled) return
      setPrice(prices.get(itemId))
      setState('done')
    })
    return () => {
      cancelled = true
    }
  }, [itemId])

  if (dropsOnly || state === 'loading' || price === undefined) return null

  const spread =
    price.sellLow !== undefined && price.buyHigh !== undefined
      ? price.sellLow - price.buyHigh
      : undefined

  return (
    <Panel className="mt-8">
      <PanelHeader title="Trading at" aside="platinum" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 px-3 py-4 sm:grid-cols-3 sm:px-5">
        {price.sellLow !== undefined && (
          <SummaryCard
            label="Buy for"
            value={price.sellLow.toLocaleString()}
            tone="accent"
            detail={
              price.sellOrders === 1
                ? 'one seller'
                : `cheapest of ${String(price.sellOrders)} live`
            }
          />
        )}
        {price.buyHigh !== undefined && (
          <SummaryCard
            label="Sell for"
            value={price.buyHigh.toLocaleString()}
            detail={
              price.buyOrders === 1 ? 'one buyer' : `best of ${String(price.buyOrders)} live`
            }
          />
        )}
        {price.sellTypical !== undefined && (
          <SummaryCard label="Typical ask" value={price.sellTypical.toLocaleString()} detail="median" />
        )}
      </div>

      <p className="border-t border-hairline px-3 py-3 text-xs text-text-faint sm:px-5">
        {/* The two things a reader has to know to use these numbers: who they came from, and
            how old they are. Both are stated rather than implied. */}
        From the five best live orders on each side at the last build, counting only sellers who
        were online. The full order book is thick with parked listings — one Vitality offer sits
        at 99,999 platinum — so an average across all of them would be fiction.
        {spread !== undefined && spread > 0 && (
          <> The spread is {spread.toLocaleString()} platinum.</>
        )}{' '}
        <a
          href={`https://warframe.market/items/${marketSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 transition-colors hover:text-gold"
        >
          Live orders on warframe.market
          <span aria-hidden="true"> ↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </Panel>
  )
}
