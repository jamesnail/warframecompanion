'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryStates, parseAsString, parseAsStringLiteral } from 'nuqs'
import { useVirtualizer } from '@tanstack/react-virtual'

import { compileQuery, parseQuery, stageLabel, type QueryItem } from '@provenance/core'

import { QueryInput } from '@/components/QueryInput'
import { loadBrowseDataset, loadPrices } from '@/lib/client/dataset'
import {
  buildRows,
  facetsOf,
  facetsOfItems,
  filterItems,
  filterRows,
  sortItemRows,
  sortRows,
  toItemRow,
  type BrowseRow,
  type ItemRow,
  type SortColumn,
} from '@/lib/browse'
import { hasLegacyParams, readLegacyParams, toQueryText } from '@/lib/legacy-params'
import { buildQueryItems, indexById } from '@/lib/query-index'
import { hasTerm, toggleTerm } from '@/lib/query-text'
import { useAppliedSettings } from '@/lib/client/use-settings'

/**
 * Row heights, one per density.
 *
 * Fixed per density rather than measured, because the virtualizer works in pixels and a row
 * whose height it cannot predict makes the scrollbar lie about how much is below. Comfortable
 * clears the 44px touch-target floor; compact is for a mouse on a large screen, which is the
 * only place the extra rows per screen are worth the tighter target.
 */
const ROW_HEIGHT = { comfortable: 52, compact: 40 } as const

const SORT_COLUMNS = ['item', 'source', 'category', 'chance'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

/**
 * The two grains, and why the default is items.
 *
 * An item row can never be empty while items match, which is the failure the path grain
 * produced on `is:prime cat:warframe`: 50 matching items, zero matching edges, "0 of 28,020
 * rows". Paths stay one click away and keep the precision items cannot have — at item grain
 * `tier:axi rotation:c` is satisfied by an Axi path and a separate rotation-C path, because
 * the language is lifted existentially (DESIGN.md § 11).
 */
const VIEWS = ['items', 'paths'] as const

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
  view: parseAsStringLiteral(VIEWS).withDefault('items'),
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
        // Prices ride along: a small chunk next to a 5 MB one, and `price:` is useless
        // without it. loadPrices never throws — an empty map means the key matches nothing,
        // which is the honest answer when the market data did not ship.
        const [{ items, sources, edges }, prices] = await Promise.all([
          loadBrowseDataset(),
          loadPrices(),
        ])
        if (cancelled) return
        setState({
          status: 'ready',
          rows: buildRows(items, sources, edges, stageLabel),
          itemsById: indexById(buildQueryItems(items, sources, edges, prices)),
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
  const items = filters.view === 'items'

  /**
   * Facets come from whichever grain is showing, so a dead option is never offered — and so
   * the item grain offers categories the edge table has none of. Warframe is one: every
   * prime frame is undropped, so a facet read off edges alone under-reports it.
   */
  const facets = useMemo(
    () => (items ? facetsOfItems(itemsById.values()) : facetsOf(all)),
    [items, all, itemsById],
  )

  // Parsing is cheap and the errors are needed for the input, so it happens on every render
  // of the query rather than being threaded through state.
  const parsed = useMemo(() => parseQuery(filters.q), [filters.q])

  // Filtering ~28k rows runs on every keystroke, so it is memoised on the exact inputs.
  // Predicates compile once here, not once per row: the closures below are what the row loop
  // calls. Measured at 0.34–3.37 ms for the full corpus.
  const compiled = useMemo(() => compileQuery(parsed.query), [parsed])

  const visible = useMemo(
    () =>
      items ? [] : sortRows(filterRows(all, compiled, itemsById), filters.sort, filters.dir),
    [items, all, itemsById, compiled, filters.sort, filters.dir],
  )

  const visibleItems = useMemo(
    () =>
      items
        ? sortItemRows(
            filterItems(itemsById.values(), compiled).map((item) =>
              toItemRow(item, (id) => itemsById.has(id)),
            ),
            filters.sort,
            filters.dir,
          )
        : [],
    [items, itemsById, compiled, filters.sort, filters.dir],
  )

  const count = items ? visibleItems.length : visible.length
  const total = items ? itemsById.size : all.length

  /**
   * How many items match, when the PATH grain is showing and found nothing.
   *
   * Not a second table any more — the item grain is a real view now, so this is one line
   * pointing at it. It stays because the case is common and silent: 1,046 items have no path
   * at all, and a reader who filtered on `from:` cannot tell "nothing drops it" apart from
   * "no such item" without being told.
   */
  const itemMatches = useMemo(() => {
    if (items || visible.length > 0 || compiled.size === 0) return 0
    let found = 0
    for (const item of itemsById.values()) {
      if (compiled.matchItem(item)) found++
    }
    return found
  }, [items, visible.length, compiled, itemsById])

  const setQuery = (next: string): void => {
    void setFilters({ q: next === '' ? null : next })
  }

  const { density } = useAppliedSettings()
  const rowHeight = ROW_HEIGHT[density]

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  })

  // The virtualizer caches measurements, so changing density without this leaves every row
  // positioned for the old height and the list overlaps itself.
  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  // A new filter must return you to the top. Keeping the offset leaves you staring at row
  // 4,000 of a 12-row result, which reads as an empty table.
  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [filters.q, filters.view, virtualizer])

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
            // 455 of 588 prime parts are reachable only through a vaulted relic, so this is
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

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="label" role="status" aria-live="polite">
          {state.status === 'loading'
            ? 'Loading drop data…'
            : state.status === 'failed'
              ? 'Drop data failed to load.'
              : `${count.toLocaleString()} of ${total.toLocaleString()} ${items ? 'items' : 'paths'}`}
        </p>

        {/* Two buttons rather than a select: there are exactly two grains and both names are
            short, so the choice and its state are readable without opening anything. */}
        <div className="flex gap-1.5" role="group" aria-label="Row grain">
          {VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.view === value}
              onClick={() => {
                void setFilters({ view: value })
              }}
              className={`chamfer-sm border px-2.5 py-1 text-xs capitalize transition-colors ${
                filters.view === value
                  ? 'border-gold bg-void-700 text-gold'
                  : 'border-hairline text-text-dim hover:border-hairline-strong hover:text-text'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {/* An ARIA grid rather than a <table>.
          Every other data surface here is a real table with real <th scope>, and this one
          cannot be: the rows are absolutely positioned by the virtualizer, which a table's
          own layout will not do. So it carries the semantics explicitly instead. Without
          them the site's largest data view was an undifferentiated list of links — no
          column names, no row position — and the aria-sort below sat on a bare <button>,
          where it is ignored, so the one affordance that was here did not work either.
          aria-rowcount is the whole filtered set; aria-rowindex is 1-based with the header
          as row 1, which is how a screen reader knows row 40 of 4,875 is not row 40 of 12. */}
      {/* The role is unconditional. Dropping it on an empty result left three columnheaders
          with no grid to belong to, which is the same orphaning this block exists to fix —
          and a grid holding only its header row is a perfectly ordinary empty table. */}
      <div
        role="grid"
        aria-label={items ? 'Items' : 'Drop paths'}
        aria-rowcount={count + 1}
        aria-colcount={3}
        className="panel mt-2 overflow-hidden"
      >
        <div
          role="row"
          aria-rowindex={1}
          className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_5rem] gap-3 border-b border-hairline px-3 py-2 sm:px-5"
        >
          <SortHeader column="item" label="Item" filters={filters} setFilters={setFilters} />
          <SortHeader
            column="source"
            label={items ? 'Best source' : 'Source'}
            filters={filters}
            setFilters={setFilters}
          />
          <SortHeader column="chance" label="Chance" filters={filters} setFilters={setFilters} align="right" />
        </div>

        {state.status === 'ready' && count === 0 ? (
          <div className="px-3 py-6 sm:px-5">
            <p className="text-sm text-text-faint">{emptyStateHint(filters.q, items)}</p>
            {itemMatches > 0 && (
              <p className="mt-4 text-sm text-text-dim">
                {itemMatches.toLocaleString()} item{itemMatches === 1 ? '' : 's'} match with no
                drop path of their own — an assembled set is built from parts, never dropped.{' '}
                <button
                  type="button"
                  onClick={() => {
                    void setFilters({ view: 'items' })
                  }}
                  className="text-text underline underline-offset-4 transition-colors hover:text-gold"
                >
                  Show them as items
                </button>
                .
              </p>
            )}
          </div>
        ) : (
          <div
            ref={scrollRef}
            role="rowgroup"
            className="h-[60vh] overflow-y-auto overscroll-contain"
          >
            {/* Presentational so the rows below are exposed as children of the rowgroup: a
                generic element between the two breaks the grid's accessibility tree. */}
            <div
              role="presentation"
              className="relative w-full"
              style={{ height: `${String(virtualizer.getTotalSize())}px` }}
            >
              {virtualizer.getVirtualItems().map((virtual) => {
                const itemRow = items ? visibleItems[virtual.index] : undefined
                if (itemRow !== undefined) {
                  return (
                    <ItemRowView
                      key={virtual.key}
                      row={itemRow}
                      height={rowHeight}
                      offset={virtual.start}
                      // 1-based, with the header occupying row 1.
                      rowIndex={virtual.index + 2}
                    />
                  )
                }
                const row = visible[virtual.index]
                if (row === undefined) return null
                return (
                  <div
                    key={virtual.key}
                    role="row"
                    aria-rowindex={virtual.index + 2}
                    className="absolute inset-x-0 top-0 grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_5rem] items-center gap-3 border-b border-hairline/50 px-3 text-sm sm:px-5 transition-colors hover:bg-void-800"
                    style={{ height: `${String(rowHeight)}px`, transform: `translateY(${String(virtual.start)}px)` }}
                  >
                    <div role="gridcell" className="min-w-0">
                      <Link
                        href={`/item/${row.itemId}`}
                        className="block truncate text-text transition-colors hover:text-gold"
                      >
                        {row.itemName}
                      </Link>
                      <span className="label block truncate">{row.category}</span>
                    </div>
                    <div role="gridcell" className={`min-w-0 ${row.vaulted ? 'vaulted' : ''}`}>
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
                    <div role="gridcell" className="data-num text-right text-text">
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
 * One item, collapsed to its best path.
 *
 * The three columns are the path grain's, so the two views line up column for column and a
 * grain switch does not move the reader's eye. An item nothing drops fills the source cell
 * with what it IS rather than a dash: "built from 4 parts" is the answer to where it comes
 * from, and an em dash is not.
 */
function ItemRowView({
  row,
  height,
  offset,
  rowIndex,
}: {
  row: ItemRow
  height: number
  offset: number
  rowIndex: number
}) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      className="absolute inset-x-0 top-0 grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_5rem] items-center gap-3 border-b border-hairline/50 px-3 text-sm sm:px-5 transition-colors hover:bg-void-800"
      style={{ height: `${String(height)}px`, transform: `translateY(${String(offset)}px)` }}
    >
      <div role="gridcell" className="min-w-0">
        <Link
          href={`/item/${row.itemId}`}
          className="block truncate text-text transition-colors hover:text-gold"
        >
          {row.itemName}
        </Link>
        <span className="label block truncate">{row.category}</span>
      </div>
      <div role="gridcell" className={`min-w-0 ${row.vaulted ? 'vaulted' : ''}`}>
        {row.sourceHref === undefined || row.sourceName === undefined ? (
          <span className="block truncate text-text-faint">Not dropped</span>
        ) : (
          <Link
            href={row.sourceHref}
            className="block truncate text-text-dim transition-colors hover:text-gold"
          >
            {row.sourceName}
          </Link>
        )}
        <span className="block truncate text-xs text-text-faint">
          {row.vaulted && <span className="text-r-legendary">Vaulted · </span>}
          {/* Which part the relic actually contains. Without it the row claims an Axi relic
              drops a Warframe, which is the misreading the item grain exists to avoid. */}
          {row.via !== undefined && `via ${row.via} · `}
          {row.paths === 0
            ? 'no path recorded'
            : `${row.paths.toLocaleString()} ${row.paths === 1 ? 'path' : 'paths'}`}
        </span>
      </div>
      <div role="gridcell" className="data-num text-right text-text">
        {row.paths === 0 ? <span className="text-text-faint">—</span> : `${(row.chance * 100).toFixed(2)}%`}
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
function emptyStateHint(query: string, items: boolean): string {
  const noun = items ? 'items' : 'paths'
  const terms = parseQuery(query).query.terms
  const negated = [...terms].reverse().find((term) => term.negated)
  if (negated !== undefined) {
    const text =
      negated.type === 'word'
        ? negated.text
        : `${negated.key}:${negated.value.kind === 'text' ? negated.value.text : ''}`
    return `No ${noun} match that query. Try clearing -${text}.`
  }
  if (terms.length > 1) return `No ${noun} match that query. Try removing a term.`
  return `No ${noun} match that query.`
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
    // aria-sort is only honoured on a columnheader / rowheader. It sat on the button, where
    // assistive technology ignores it — RivenTable gets this right with a real <th scope>,
    // and this is the same intent expressed the only way a virtualized grid can.
    <div
      role="columnheader"
      aria-sort={on ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={align === 'right' ? 'justify-self-end' : undefined}
    >
    <button
      type="button"
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
    </div>
  )
}
