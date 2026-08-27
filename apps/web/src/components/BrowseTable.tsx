'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryStates, parseAsArrayOf, parseAsBoolean, parseAsFloat, parseAsString, parseAsStringLiteral } from 'nuqs'
import { useVirtualizer } from '@tanstack/react-virtual'

import { stageLabel } from '@provenance/core'
import type { ItemCategory, SourceKind } from '@provenance/core'

import { loadBrowseDataset } from '@/lib/client/dataset'
import {
  buildRows,
  facetsOf,
  filterRows,
  sortRows,
  type BrowseRow,
  type SortColumn,
} from '@/lib/browse'

/** Fixed, because the virtualizer measures in rows and a variable height would make the
 *  scrollbar lie about how much is below. Also clears the 44px touch-target floor. */
const ROW_HEIGHT = 52

const SORT_COLUMNS = ['item', 'source', 'category', 'chance'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

/**
 * Every control is a search param, so any view of this table is a URL someone else can
 * open and see exactly what you saw (CLAUDE.md constraint 5). `clearOnDefault` keeps the
 * common case — no filters — as a clean `/browse` rather than a URL full of empty values.
 */
const FILTER_PARSERS = {
  q: parseAsString.withDefault(''),
  category: parseAsArrayOf(parseAsString).withDefault([]),
  kind: parseAsArrayOf(parseAsString).withDefault([]),
  min: parseAsFloat.withDefault(0),
  tradable: parseAsBoolean.withDefault(false),
  farmable: parseAsBoolean.withDefault(false),
  sort: parseAsStringLiteral(SORT_COLUMNS).withDefault('chance'),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault('desc'),
}

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; rows: BrowseRow[] }

export function BrowseTable() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [filters, setFilters] = useQueryStates(FILTER_PARSERS, {
    clearOnDefault: true,
    history: 'replace',
  })

  useEffect(() => {
    let cancelled = false
    async function boot(): Promise<void> {
      try {
        const { items, sources, edges } = await loadBrowseDataset()
        if (cancelled) return
        setState({ status: 'ready', rows: buildRows(items, sources, edges, stageLabel) })
      } catch {
        // A missing dataset must not blank the page (CLAUDE.md § Errors).
        if (!cancelled) setState({ status: 'failed' })
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const all = state.status === 'ready' ? state.rows : []

  /**
   * Facets come from the loaded rows so a dead option is never offered — but anything the
   * URL already selected is unioned in. Without that, arriving at /browse?category=Mod shows
   * an empty filter panel for as long as the edge list takes to load, and the one filter
   * that IS applied is the only one you cannot see.
   */
  const facets = useMemo(() => {
    const found = facetsOf(all)
    const union = (available: string[], selected: string[]): string[] =>
      [...new Set([...available, ...selected])].sort((a, b) => a.localeCompare(b))
    return {
      categories: union(found.categories, filters.category),
      kinds: union(found.kinds, filters.kind),
    }
  }, [all, filters.category, filters.kind])

  // Filtering ~28k rows runs on every keystroke, so it is memoised on the exact inputs
  // rather than recomputed per render.
  const visible = useMemo(() => {
    const filtered = filterRows(all, {
      q: filters.q,
      categories: filters.category as ItemCategory[],
      kinds: filters.kind as SourceKind[],
      minChance: filters.min,
      tradableOnly: filters.tradable,
      farmableOnly: filters.farmable,
    })
    return sortRows(filtered, filters.sort, filters.dir)
  }, [all, filters.q, filters.category, filters.kind, filters.min, filters.tradable, filters.farmable, filters.sort, filters.dir])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  // A new filter must return you to the top. Keeping the offset leaves you staring at row
  // 4,000 of a 12-row result, which reads as an empty table.
  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [filters.q, filters.category, filters.kind, filters.min, filters.tradable, filters.farmable, virtualizer])

  const toggle = (key: 'category' | 'kind', value: string): void => {
    const current = filters[key]
    void setFilters({
      [key]: current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value],
    })
  }

  const active =
    filters.q !== '' ||
    filters.category.length > 0 ||
    filters.kind.length > 0 ||
    filters.min > 0 ||
    filters.tradable ||
    filters.farmable

  return (
    <div>
      <div className="panel p-4 sm:p-5">
        <label className="block">
          <span className="sr-only">Filter by item or source name</span>
          <input
            type="search"
            value={filters.q}
            onChange={(event) => void setFilters({ q: event.target.value })}
            placeholder="Filter by item or source…"
            // text-base: iOS zooms any focused input under 16px and does not zoom back.
            className="chamfer-sm w-full border border-hairline bg-void-900 px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-energy placeholder:text-text-faint sm:text-sm"
          />
        </label>

        <FacetRow label="Category" values={facets.categories} selected={filters.category} onToggle={(v) => { toggle('category', v) }} />
        <FacetRow label="Source" values={facets.kinds} selected={filters.kind} onToggle={(v) => { toggle('kind', v) }} />

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex items-center gap-2 text-sm text-text-dim">
            <input
              type="checkbox"
              checked={filters.tradable}
              onChange={(event) => void setFilters({ tradable: event.target.checked })}
              className="size-4 accent-energy"
            />
            Tradable only
          </label>

          {/* 455 of 582 prime parts are reachable only through a vaulted relic, so this is
              the difference between "where is it from" and "what can I farm tonight". */}
          <label className="flex items-center gap-2 text-sm text-text-dim">
            <input
              type="checkbox"
              checked={filters.farmable}
              onChange={(event) => void setFilters({ farmable: event.target.checked })}
              className="size-4 accent-energy"
            />
            Farmable now
          </label>

          <label className="flex items-center gap-2 text-sm text-text-dim">
            Min chance
            <select
              value={String(filters.min)}
              onChange={(event) => void setFilters({ min: Number(event.target.value) })}
              className="chamfer-sm border border-hairline bg-void-900 px-2 py-1.5 text-sm text-text outline-none focus:border-energy"
            >
              {[0, 0.01, 0.05, 0.1, 0.25, 0.5].map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? 'any' : `${String(value * 100)}%`}
                </option>
              ))}
            </select>
          </label>

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
          ? 'Loading drop data…'
          : state.status === 'failed'
            ? 'Drop data failed to load.'
            : `${visible.length.toLocaleString()} of ${all.length.toLocaleString()} rows`}
      </p>

      <div className="panel mt-2 overflow-hidden">
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_5rem] gap-3 border-b border-hairline px-3 py-2 sm:px-5">
          <SortHeader column="item" label="Item" filters={filters} setFilters={setFilters} />
          <SortHeader column="source" label="Source" filters={filters} setFilters={setFilters} />
          <SortHeader column="chance" label="Chance" filters={filters} setFilters={setFilters} align="right" />
        </div>

        {state.status === 'ready' && visible.length === 0 ? (
          <p className="px-3 py-8 text-sm text-text-faint sm:px-5">
            No rows match. Try removing a category, or lowering the minimum chance.
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
                    className="absolute inset-x-0 top-0 grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_5rem] items-center gap-3 border-b border-hairline/50 px-3 text-sm sm:px-5"
                    style={{ height: `${String(ROW_HEIGHT)}px`, transform: `translateY(${String(virtual.start)}px)` }}
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/item/${row.itemId}`}
                        className="block truncate text-text transition-colors hover:text-energy"
                      >
                        {row.itemName}
                      </Link>
                      <span className="label block truncate">{row.category}</span>
                    </div>
                    <div className={`min-w-0 ${row.vaulted ? 'vaulted' : ''}`}>
                      <Link
                        href={row.sourceHref}
                        className="block truncate text-text-dim transition-colors hover:text-energy"
                      >
                        {row.sourceName}
                      </Link>
                      <span className="block truncate text-xs text-text-faint">
                        {row.vaulted && <span className="text-r-legendary">Vaulted</span>}
                        {row.vaulted && row.detail !== '' && ' · '}
                        {row.detail}
                      </span>
                    </div>
                    <div className="data-num text-right text-text">
                      {(row.chance * 100).toFixed(2)}%
                      {row.quantity[1] > 1 && (
                        <span className="block text-xs text-text-dim">
                          ×
                          {row.quantity[0] === row.quantity[1]
                            ? row.quantity[0].toLocaleString()
                            : `${row.quantity[0].toLocaleString()}–${row.quantity[1].toLocaleString()}`}
                        </span>
                      )}
                    </div>
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

function FacetRow({
  label,
  values,
  selected,
  onToggle,
}: {
  label: string
  values: string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  if (values.length === 0) return null
  return (
    <div className="mt-4">
      <span className="label">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((value) => {
          const on = selected.includes(value)
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onToggle(value)
              }}
              className={`chamfer-sm border px-2.5 py-1 text-xs capitalize transition-colors ${
                on
                  ? 'border-energy bg-void-700 text-energy'
                  : 'border-hairline text-text-dim hover:border-hairline-strong hover:text-text'
              }`}
            >
              {value}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SortHeader({
  column,
  label,
  filters,
  setFilters,
  align = 'left',
}: {
  column: SortColumn
  label: string
  filters: { sort: string; dir: string }
  setFilters: (values: Record<string, unknown>) => unknown
  align?: 'left' | 'right'
}) {
  const on = filters.sort === column
  return (
    <button
      type="button"
      // A sortable header must announce its state, not just look pressed.
      aria-sort={on ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => {
        void setFilters(
          on ? { dir: filters.dir === 'asc' ? 'desc' : 'asc' } : { sort: column, dir: 'desc' },
        )
      }}
      className={`label flex items-center gap-1 transition-colors hover:text-text ${
        align === 'right' ? 'justify-end' : ''
      } ${on ? 'text-text' : ''}`}
    >
      {label}
      <span aria-hidden="true" className={on ? '' : 'opacity-0'}>
        {filters.dir === 'asc' ? '▲' : '▼'}
      </span>
    </button>
  )
}
