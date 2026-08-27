'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryStates, parseAsArrayOf, parseAsBoolean, parseAsString, parseAsStringLiteral } from 'nuqs'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { RelicTier } from '@provenance/core'

import { RarityTag } from '@/components/Primitives'
import { loadRelicDetails } from '@/lib/client/dataset'
import {
  buildRelicRows,
  countFarmable,
  filterRelics,
  matchedRewards,
  relicTiers,
  sortRelics,
  type RelicRow,

} from '@/lib/relics'

const SORT_COLUMNS = ['name', 'tier', 'rare'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

const FILTER_PARSERS = {
  q: parseAsString.withDefault(''),
  tier: parseAsArrayOf(parseAsString).withDefault([]),
  farmable: parseAsBoolean.withDefault(false),
  sort: parseAsStringLiteral(SORT_COLUMNS).withDefault('name'),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault('asc'),
}

/** Fixed, because the virtualizer measures in rows. Two lines of text plus padding. */
const ROW_HEIGHT = 64

type LoadState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; rows: RelicRow[] }

export function RelicTable({ names }: { names: Record<string, string> }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [filters, setFilters] = useQueryStates(FILTER_PARSERS, {
    clearOnDefault: true,
    history: 'replace',
  })

  useEffect(() => {
    let cancelled = false
    async function boot(): Promise<void> {
      try {
        const { relics } = await loadRelicDetails()
        if (cancelled) return
        setState({
          status: 'ready',
          rows: buildRelicRows(relics, (id) => names[id] ?? id),
        })
      } catch {
        if (!cancelled) setState({ status: 'failed' })
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [names])

  const all = state.status === 'ready' ? state.rows : []

  const tiers = useMemo(() => {
    const found = relicTiers(all)
    const selected = filters.tier as RelicTier[]
    return [...new Set([...found, ...selected])]
  }, [all, filters.tier])

  const visible = useMemo(
    () =>
      sortRelics(
        filterRelics(all, {
          q: filters.q,
          tiers: filters.tier as RelicTier[],
          farmableOnly: filters.farmable,
        }),
        filters.sort,
        filters.dir,
      ),
    [all, filters.q, filters.tier, filters.farmable, filters.sort, filters.dir],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // A new filter must return you to the top, or you are staring at row 400 of a 3-row result.
  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [filters.q, filters.tier, filters.farmable, filters.sort, filters.dir, virtualizer])

  const active = filters.q !== '' || filters.tier.length > 0 || filters.farmable
  const farmable = countFarmable(all)

  const toggleTier = (tier: string): void => {
    void setFilters({
      tier: filters.tier.includes(tier)
        ? filters.tier.filter((t) => t !== tier)
        : [...filters.tier, tier],
    })
  }

  return (
    <div>
      <div className="panel p-4 sm:p-5">
        <label className="block">
          <span className="sr-only">Filter by relic name or by what it contains</span>
          <input
            type="search"
            value={filters.q}
            onChange={(event) => void setFilters({ q: event.target.value })}
            placeholder="Search a relic, or a part inside one…"
            // text-base: iOS zooms any focused input under 16px and does not zoom back.
            className="chamfer-sm w-full border border-hairline bg-void-900 px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-gold placeholder:text-text-faint sm:text-sm"
          />
        </label>

        <div className="mt-4">
          <span className="label">Tier</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tiers.map((tier) => {
              const on = filters.tier.includes(tier)
              return (
                <button
                  key={tier}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    toggleTier(tier)
                  }}
                  className={`chamfer-sm border px-2.5 py-1 text-xs transition-colors ${
                    on
                      ? 'border-gold bg-void-700 text-gold'
                      : 'border-hairline text-text-dim hover:border-hairline-strong hover:text-text'
                  }`}
                >
                  {tier}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          {/* 737 of 771 are vaulted, so this is the difference between browsing history and
              browsing what you can actually go and get. */}
          <label className="flex items-center gap-2 text-sm text-text-dim">
            <input
              type="checkbox"
              checked={filters.farmable}
              onChange={(event) => void setFilters({ farmable: event.target.checked })}
              className="size-4 accent-gold"
            />
            Farmable now
            {state.status === 'ready' && (
              <span className="label">({farmable.toLocaleString()})</span>
            )}
          </label>

          <SortControl filters={filters} setFilters={setFilters} />

          {active && (
            <button
              type="button"
              onClick={() => void setFilters(null)}
              className="text-sm text-text-faint underline underline-offset-4 transition-colors hover:text-text"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <p className="label mt-4" role="status" aria-live="polite">
        {state.status === 'loading'
          ? 'Loading relics…'
          : state.status === 'failed'
            ? 'Relic data failed to load.'
            : `${visible.length.toLocaleString()} of ${all.length.toLocaleString()} relics`}
      </p>

      <div className="panel mt-2 overflow-hidden">
        {state.status === 'ready' && visible.length === 0 ? (
          <p className="px-3 py-8 text-sm text-text-faint sm:px-5">
            No relic matches. Try clearing the tier filter, or turning off &ldquo;farmable
            now&rdquo; — most relics are vaulted.
          </p>
        ) : (
          <div ref={scrollRef} className="h-[60vh] overflow-y-auto overscroll-contain">
            <div className="relative w-full" style={{ height: `${String(virtualizer.getTotalSize())}px` }}>
              {virtualizer.getVirtualItems().map((virtual) => {
                const row = visible[virtual.index]
                if (row === undefined) return null
                return (
                  <div
                    key={virtual.key}
                    className="absolute inset-x-0 top-0 border-b border-hairline/50 px-3 sm:px-5 transition-colors hover:bg-void-800"
                    style={{
                      height: `${String(ROW_HEIGHT)}px`,
                      transform: `translateY(${String(virtual.start)}px)`,
                    }}
                  >
                    <Row row={row} query={filters.q} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ row, query }: { row: RelicRow; query: string }) {
  // Only rewards the search actually hit, and only when they are not the rare one already
  // shown — otherwise a query for "forma" returns 400 rows that all look identical.
  const matches = matchedRewards(row, query).filter((reward) => reward.rarity !== 'rare')

  return (
    <div className={`flex h-full flex-col justify-center ${row.vaulted ? 'vaulted' : ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Link
          href={`/item/${row.id}`}
          className="min-w-0 truncate text-sm text-text transition-colors hover:text-gold"
        >
          {row.name}
        </Link>
        <span className="label shrink-0">
          {row.vaulted ? <span className="text-r-legendary">Vaulted</span> : row.tier}
        </span>
      </div>

      <div className="mt-0.5 flex min-w-0 items-baseline gap-2 text-xs">
        {row.rare !== undefined && (
          <>
            <RarityTag rarity="rare" />
            <Link
              href={`/item/${row.rare.itemId}`}
              className="min-w-0 truncate text-text-dim transition-colors hover:text-gold"
            >
              {row.rare.name}
            </Link>
          </>
        )}
        {matches.length > 0 && (
          <span className="min-w-0 truncate text-text-faint">
            · also {matches.map((reward) => reward.name).join(', ')}
          </span>
        )}
      </div>
    </div>
  )
}

function SortControl({
  filters,
  setFilters,
}: {
  filters: { sort: string; dir: string }
  setFilters: (values: Record<string, unknown>) => unknown
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-text-dim">
      Sort
      <select
        value={`${filters.sort}:${filters.dir}`}
        onChange={(event) => {
          const [sort, dir] = event.target.value.split(':')
          void setFilters({ sort, dir })
        }}
        className="chamfer-sm border border-hairline bg-void-900 px-2 py-1.5 text-sm text-text outline-none focus:border-gold"
      >
        <option value="name:asc">Name</option>
        <option value="tier:asc">Tier</option>
        {/* By the rare reward's NAME. Every rare sits at identical odds for a given
            refinement, so a "best chance" sort would be a no-op dressed as a choice. */}
        <option value="rare:asc">Rare reward</option>
      </select>
    </label>
  )
}
