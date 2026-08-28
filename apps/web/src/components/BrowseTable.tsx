'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryStates, parseAsString, parseAsStringLiteral } from 'nuqs'
import { useVirtualizer } from '@tanstack/react-virtual'

import { compileQuery, parseQuery, stageLabel, type QueryItem } from '@provenance/core'

import { QueryInput } from '@/components/QueryInput'
import { loadBrowseDataset } from '@/lib/client/dataset'
import {
  buildRows,
  facetsOf,
  filterRows,
  sortRows,
  type BrowseRow,
  type SortColumn,
} from '@/lib/browse'
import { hasLegacyParams, readLegacyParams, toQueryText } from '@/lib/legacy-params'
import { buildQueryItems, indexById } from '@/lib/query-index'
import { hasTerm, toggleTerm } from '@/lib/query-text'

/** Fixed, because the virtualizer measures in rows and a variable height would make the
 *  scrollbar lie about how much is below. Also clears the 44px touch-target floor. */
const ROW_HEIGHT = 52

const SORT_COLUMNS = ['item', 'source', 'category', 'chance'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

/**
 * The whole filter state is one param, holding the literal text someone typed (CLAUDE.md
 * constraint 5). It replaced six — q, category, kind, min, tradable, farmable — which between
 * them could not express "prime warframes" and put an encoding between the URL and the
 * predicate. `clearOnDefault` keeps the common case as a clean `/browse`.
 *
 * This also answers DESIGN.md § 12's open question about saved filter presets with "no": once
 * the URL holds the query text, a bookmark IS the preset.
 */
const FILTER_PARSERS = {
  q: parseAsString.withDefault(''),
  sort: parseAsStringLiteral(SORT_COLUMNS).withDefault('chance'),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault('desc'),
}

/**
 * Declared only so the one-shot migration can clear them. They are never read as filter
 * state — `toQueryText` reads the raw URL — and nothing else in the app knows they exist.
 */
const LEGACY_PARSERS = {
  category: parseAsString,
  kind: parseAsString,
  min: parseAsString,
  tradable: parseAsString,
  farmable: parseAsString,
}

const EMPTY_INDEX: ReadonlyMap<string, QueryItem> = new Map()

/** Enough to show the answer exists and act on it; not a second table. */
const ITEM_FALLBACK_CAP = 24

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; rows: BrowseRow[]; itemsById: Map<string, QueryItem> }

export function BrowseTable() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [filters, setFilters] = useQueryStates(FILTER_PARSERS, {
    clearOnDefault: true,
    history: 'replace',
  })
  const [, setLegacy] = useQueryStates(LEGACY_PARSERS, {
    clearOnDefault: true,
    history: 'replace',
  })

  useEffect(() => {
    let cancelled = false
    async function boot(): Promise<void> {
      try {
        const { items, sources, edges } = await loadBrowseDataset()
        if (cancelled) return
        setState({
          status: 'ready',
          rows: buildRows(items, sources, edges, stageLabel),
          itemsById: indexById(buildQueryItems(items, sources, edges)),
        })
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

  /**
   * Old six-param links are shareable by design, so they have to keep resolving to the view
   * they described. Translate once, replace the URL, and never look again — a permanent
   * compatibility layer would mean two live ways to express one filter.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!hasLegacyParams(params)) return
    const { query } = toQueryText(readLegacyParams(params))
    // Both calls land in one history entry: nuqs batches updates within a tick, so the old
    // keys clear and the new one appears together rather than as two visible states.
    void setFilters({ q: query === '' ? null : query })
    void setLegacy({ category: null, kind: null, min: null, tradable: null, farmable: null })
  }, [setFilters, setLegacy])

  const all = state.status === 'ready' ? state.rows : []
  const itemsById = state.status === 'ready' ? state.itemsById : EMPTY_INDEX

  /** Facets come from the loaded rows, so a dead option is never offered. */
  const facets = useMemo(() => facetsOf(all), [all])

  // Parsing is cheap and the errors are needed for the input, so it happens on every render
  // of the query rather than being threaded through state.
  const parsed = useMemo(() => parseQuery(filters.q), [filters.q])

  // Filtering ~28k rows runs on every keystroke, so it is memoised on the exact inputs.
  // Predicates compile once here, not once per row: the closures below are what the row loop
  // calls. Measured at 0.34–3.37 ms for the full corpus.
  const compiled = useMemo(() => compileQuery(parsed.query), [parsed])

  const visible = useMemo(
    () => sortRows(filterRows(all, compiled, itemsById), filters.sort, filters.dir),
    [all, itemsById, compiled, filters.sort, filters.dir],
  )

  /**
   * Items that match when the ROWS do not.
   *
   * `is:prime cat:warframe` is the case: all 50 prime Warframes match, and every one of them
   * has zero drop rows, because a set is built from parts rather than dropped. A bare "0 rows"
   * there is technically true and reads as "there are no prime Warframes", so the answer that
   * does exist is offered instead of withheld.
   */
  const itemMatches = useMemo(() => {
    if (visible.length > 0 || compiled.size === 0) return []
    const found: QueryItem[] = []
    for (const item of itemsById.values()) {
      if (compiled.matchItem(item)) found.push(item)
      if (found.length >= ITEM_FALLBACK_CAP) break
    }
    return found
  }, [visible.length, compiled, itemsById])

  const setQuery = (next: string): void => {
    void setFilters({ q: next === '' ? null : next })
  }

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
  }, [filters.q, virtualizer])

  const active = filters.q !== ''

  return (
    <div>
      <div className="panel p-4 sm:p-5">
        <QueryInput
          label="Search and filter"
          placeholder="braton, or is:prime from:relic -is:vaulted"
          value={filters.q}
          onChange={setQuery}
          errors={parsed.errors}
        />

        {/* The chips write query terms rather than holding state of their own, so a chip and
            the same text typed by hand produce the identical URL. */}
        <TermRow
          label="Category"
          terms={facets.categories.map((value) => ({ label: value, term: `cat:${value.toLowerCase()}` }))}
          query={filters.q}
          onToggle={(term) => { setQuery(toggleTerm(filters.q, term)) }}
        />
        <TermRow
          label="Source"
          terms={facets.kinds.map((value) => ({ label: value, term: `from:${value}` }))}
          query={filters.q}
          onToggle={(term) => { setQuery(toggleTerm(filters.q, term)) }}
        />
        <TermRow
          label="Filters"
          terms={[
            { label: 'Prime', term: 'is:prime' },
            { label: 'Tradable', term: 'is:tradable' },
            // 455 of 582 prime parts are reachable only through a vaulted relic, so this is
            // the difference between "where is it from" and "what can I farm tonight".
            { label: 'Farmable now', term: '-is:vaulted' },
            { label: 'Over 5%', term: 'chance:>5' },
          ]}
          query={filters.q}
          onToggle={(term) => { setQuery(toggleTerm(filters.q, term)) }}
        />

        {active && (
          <button
            type="button"
            onClick={() => { setQuery('') }}
            className="mt-4 text-sm text-text-faint underline underline-offset-4 transition-colors hover:text-text"
          >
            Clear query
          </button>
        )}
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
          <div className="px-3 py-6 sm:px-5">
            <p className="text-sm text-text-faint">{emptyStateHint(filters.q)}</p>
            {itemMatches.length > 0 && (
              <div className="mt-5">
                <p className="text-sm text-text-dim">
                  {itemMatches.length === ITEM_FALLBACK_CAP ? 'At least ' : ''}
                  {itemMatches.length} item{itemMatches.length === 1 ? '' : 's'} match, with no
                  drop row of their own — an assembled set is built from parts, never dropped.
                </p>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                  {itemMatches.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/item/${item.id}`}
                        className="text-sm text-text transition-colors hover:text-gold"
                      >
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div ref={scrollRef} className="h-[60vh] overflow-y-auto overscroll-contain">
            <div className="relative w-full" style={{ height: `${String(virtualizer.getTotalSize())}px` }}>
              {virtualizer.getVirtualItems().map((virtual) => {
                const row = visible[virtual.index]
                if (row === undefined) return null
                return (
                  <div
                    key={virtual.key}
                    className="absolute inset-x-0 top-0 grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_5rem] items-center gap-3 border-b border-hairline/50 px-3 text-sm sm:px-5 transition-colors hover:bg-void-800"
                    style={{ height: `${String(ROW_HEIGHT)}px`, transform: `translateY(${String(virtual.start)}px)` }}
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/item/${row.itemId}`}
                        className="block truncate text-text transition-colors hover:text-gold"
                      >
                        {row.itemName}
                      </Link>
                      <span className="label block truncate">{row.category}</span>
                    </div>
                    <div className={`min-w-0 ${row.vaulted ? 'vaulted' : ''}`}>
                      <Link
                        href={row.sourceHref}
                        className="block truncate text-text-dim transition-colors hover:text-gold"
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

/**
 * Empty results are not an error and must not read as one (CLAUDE.md § Copy).
 *
 * Naming the likeliest culprit beats a generic "no rows": the last negation is the term most
 * often responsible, because it is the one that silently removes rows you were looking at.
 */
function emptyStateHint(query: string): string {
  const terms = parseQuery(query).query.terms
  const negated = [...terms].reverse().find((term) => term.negated)
  if (negated !== undefined) {
    const text =
      negated.type === 'word'
        ? negated.text
        : `${negated.key}:${negated.value.kind === 'text' ? negated.value.text : ''}`
    return `No rows match that query. Try clearing -${text}.`
  }
  if (terms.length > 1) return 'No rows match that query. Try removing a term.'
  return 'No rows match that query.'
}

/**
 * A row of chips, each of which toggles one query term.
 *
 * Pressed state is read back OUT of the query text rather than held separately, so typing a
 * term by hand lights its chip and the two can never disagree about what is filtered.
 */
function TermRow({
  label,
  terms,
  query,
  onToggle,
}: {
  label: string
  terms: { label: string; term: string }[]
  query: string
  onToggle: (term: string) => void
}) {
  if (terms.length === 0) return null
  return (
    <div className="mt-4">
      <span className="label">{label}</span>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {terms.map((entry) => {
          const on = hasTerm(query, entry.term)
          return (
            <button
              key={entry.term}
              type="button"
              aria-pressed={on}
              onClick={() => {
                onToggle(entry.term)
              }}
              title={entry.term}
              className={`chamfer-sm border px-2.5 py-1 text-xs capitalize transition-colors ${
                on
                  ? 'border-gold bg-void-700 text-gold'
                  : 'border-hairline text-text-dim hover:border-hairline-strong hover:text-text'
              }`}
            >
              {entry.label}
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
