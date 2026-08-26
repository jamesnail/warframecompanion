'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  useQueryStates,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs'

import type { RivenPrice, RivenType, RivenWeapon } from '@provenance/core'

import { loadRivens } from '@/lib/client/dataset'
import {
  filterRivens,
  isThin,
  rivenFacets,
  sortRivens,
  tradesOf,
  type RivenSortColumn,
} from '@/lib/rivens'

const SORT_COLUMNS = ['name', 'type', 'disposition', 'unrolled', 'rerolled', 'trades'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

/** Every control is a search param, so any view of this table is a shareable link
 *  (CLAUDE.md constraint 5). */
const FILTER_PARSERS = {
  q: parseAsString.withDefault(''),
  type: parseAsArrayOf(parseAsString).withDefault([]),
  trades: parseAsInteger.withDefault(0),
  priced: parseAsBoolean.withDefault(false),
  sort: parseAsStringLiteral(SORT_COLUMNS).withDefault('disposition'),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault('desc'),
}

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; weapons: RivenWeapon[] }

export function RivenTable() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [filters, setFilters] = useQueryStates(FILTER_PARSERS, {
    clearOnDefault: true,
    history: 'replace',
  })

  useEffect(() => {
    let cancelled = false
    async function boot(): Promise<void> {
      try {
        const { rivens } = await loadRivens()
        if (!cancelled) setState({ status: 'ready', weapons: rivens })
      } catch {
        // A missing dataset hides the feature, it does not blank the page.
        if (!cancelled) setState({ status: 'failed' })
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const all = state.status === 'ready' ? state.weapons : []

  const facets = useMemo(() => {
    const found = rivenFacets(all)
    return [...new Set([...found, ...(filters.type as RivenType[])])].sort((a, b) =>
      a.localeCompare(b),
    )
  }, [all, filters.type])

  const visible = useMemo(
    () =>
      sortRivens(
        filterRivens(all, {
          q: filters.q,
          types: filters.type as RivenType[],
          minTrades: filters.trades,
          pricedOnly: filters.priced,
        }),
        filters.sort,
        filters.dir,
      ),
    [all, filters.q, filters.type, filters.trades, filters.priced, filters.sort, filters.dir],
  )

  const active =
    filters.q !== '' || filters.type.length > 0 || filters.trades > 0 || filters.priced

  const toggleType = (value: string): void => {
    void setFilters({
      type: filters.type.includes(value)
        ? filters.type.filter((entry) => entry !== value)
        : [...filters.type, value],
    })
  }

  return (
    <div>
      <div className="panel p-4 sm:p-5">
        <label className="block">
          <span className="sr-only">Filter by weapon name</span>
          <input
            type="search"
            value={filters.q}
            onChange={(event) => void setFilters({ q: event.target.value })}
            placeholder="Filter by weapon…"
            // text-base: iOS zooms any focused input under 16px and does not zoom back.
            className="chamfer-sm w-full border border-hairline bg-void-900 px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-orokin placeholder:text-text-faint sm:text-sm"
          />
        </label>

        <div className="mt-4">
          <span className="label">Riven type</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {facets.map((type) => {
              const on = filters.type.includes(type)
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    toggleType(type)
                  }}
                  className={`chamfer-sm border px-2.5 py-1 text-xs transition-colors ${
                    on
                      ? 'border-orokin bg-void-700 text-orokin'
                      : 'border-hairline text-text-dim hover:border-hairline-strong hover:text-text'
                  }`}
                >
                  {type}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex items-center gap-2 text-sm text-text-dim">
            <input
              type="checkbox"
              checked={filters.priced}
              onChange={(event) => void setFilters({ priced: event.target.checked })}
              className="size-4 accent-orokin"
            />
            Traded this week
          </label>

          {/* The honesty control. The five priciest medians in the dataset each come from a
              single trade, so being able to demand a real sample is not a nicety. */}
          <label className="flex items-center gap-2 text-sm text-text-dim">
            Min trades
            <select
              value={String(filters.trades)}
              onChange={(event) => void setFilters({ trades: Number(event.target.value) })}
              className="chamfer-sm border border-hairline bg-void-900 px-2 py-1.5 text-sm text-text outline-none focus:border-orokin"
            >
              {[0, 3, 10, 25, 100].map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? 'any' : String(value)}
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
          ? 'Loading riven data…'
          : state.status === 'failed'
            ? 'Riven data failed to load.'
            : `${visible.length.toLocaleString()} of ${all.length.toLocaleString()} weapons`}
      </p>

      <div className="panel mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Riven dispositions and last week&rsquo;s observed trade prices, by weapon
          </caption>
          <thead>
            <tr className="border-b border-hairline text-left">
              <Header column="name" label="Weapon" filters={filters} setFilters={setFilters} />
              <Header column="disposition" label="Disp." filters={filters} setFilters={setFilters} align="right" />
              <Header column="unrolled" label="Unrolled" filters={filters} setFilters={setFilters} align="right" />
              <Header column="rerolled" label="Rerolled" filters={filters} setFilters={setFilters} align="right" />
            </tr>
          </thead>
          <tbody>
            {visible.map((weapon) => (
              <tr key={weapon.id} className="border-b border-hairline/50 last:border-0">
                <th scope="row" className="px-2 py-3 text-left font-normal sm:px-5 sm:py-2.5">
                  {/* Only 243 of 687 have a catalogue page — the rest are bought, never
                      dropped — so the name is a link only where there is somewhere to go. */}
                  {weapon.itemId === undefined ? (
                    <span className="text-text">{weapon.name}</span>
                  ) : (
                    <Link
                      href={`/item/${weapon.itemId}`}
                      className="text-text transition-colors hover:text-orokin"
                    >
                      {weapon.name}
                    </Link>
                  )}
                  <span className="label mt-0.5 block">{weapon.rivenType}</span>
                </th>
                <td className="px-2 py-3 text-right sm:px-5 sm:py-2.5">
                  <Disposition weapon={weapon} />
                </td>
                <td className="px-2 py-3 text-right sm:px-5 sm:py-2.5">
                  <Price price={weapon.unrolled} />
                </td>
                <td className="px-2 py-3 text-right sm:px-5 sm:py-2.5">
                  <Price price={weapon.rerolled} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {state.status === 'ready' && visible.length === 0 && (
          <p className="px-3 py-8 text-sm text-text-faint sm:px-5">
            No weapon matches. Try lowering the minimum trades, or clearing the type filter.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Dots and the number together.
 *
 * The dots are what players say to each other ("a five-dot riven") and the number is what
 * the game actually multiplies by; showing one without the other loses either the shorthand
 * or the precision.
 */
function Disposition({ weapon }: { weapon: RivenWeapon }) {
  if (weapon.disposition === undefined) {
    return <span className="text-xs text-text-faint">—</span>
  }
  const stars = weapon.dispositionStars
  return (
    <span className="inline-flex items-baseline gap-2">
      {/* The dots cost about 55px, which at 360px is the difference between the Rerolled
          column being on screen and being behind a horizontal scroll nothing advertises.
          Rerolled is the price most rivens actually trade at, so the shorthand yields to it
          and the exact number — which the dots only approximate — stays. */}
      {stars !== undefined && (
        <span className="hidden text-xs text-text-faint sm:inline" aria-hidden="true">
          {'●'.repeat(stars)}
          {'○'.repeat(5 - stars)}
        </span>
      )}
      <span className="data-num text-text">{weapon.disposition.toFixed(2)}</span>
      {stars !== undefined && <span className="sr-only">{stars} of 5</span>}
    </span>
  )
}

/**
 * Median leads, and the sample size rides underneath.
 *
 * Riven prices are violently skewed and the file's own mean proves it, so the median is the
 * number shown. A sample under three is called out rather than quietly presented as a price:
 * the most expensive median in the whole dataset comes from exactly one trade.
 */
function Price({ price }: { price: RivenPrice | undefined }) {
  if (price === undefined) return <span className="text-xs text-text-faint">—</span>
  const thin = isThin(price.pop)
  return (
    <span className="inline-block text-right">
      <span className={`data-num block ${thin ? 'text-text-faint' : 'text-text'}`}>
        {Math.round(price.median).toLocaleString()}
        <span className="ml-0.5 text-xs text-text-faint">p</span>
      </span>
      <span className={`block text-xs ${thin ? 'text-r-legendary' : 'text-text-faint'}`}>
        {thin
          ? `${String(price.pop)} trade${price.pop === 1 ? '' : 's'} only`
          : `${price.pop.toLocaleString()} trades`}
      </span>
    </span>
  )
}

function Header({
  column,
  label,
  filters,
  setFilters,
  align = 'left',
}: {
  column: RivenSortColumn
  label: string
  filters: { sort: string; dir: string }
  setFilters: (values: Record<string, unknown>) => unknown
  align?: 'left' | 'right'
}) {
  const on = filters.sort === column
  return (
    <th
      scope="col"
      className="label px-2 py-2 font-normal sm:px-5"
      aria-sort={on ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => {
          void setFilters(
            on ? { dir: filters.dir === 'asc' ? 'desc' : 'asc' } : { sort: column, dir: 'desc' },
          )
        }}
        className={`flex items-center gap-1 transition-colors hover:text-text ${
          align === 'right' ? 'ml-auto justify-end' : ''
        } ${on ? 'text-text' : ''}`}
      >
        {label}
        <span aria-hidden="true" className={on ? '' : 'opacity-0'}>
          {filters.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  )
}

/** Exported for the item page's riven panel, which shows one weapon rather than the table. */
export { Disposition as RivenDisposition, Price as RivenPriceCell, tradesOf }
