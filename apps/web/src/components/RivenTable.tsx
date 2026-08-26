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

import type { RivenFamily, RivenPrice, RivenType } from '@provenance/core'

import { loadRivens } from '@/lib/client/dataset'
import {
  dispositionRange,
  filterRivens,
  isThin,
  matchedWeapons,
  rivenFacets,
  sortRivens,
} from '@/lib/rivens'

const SORT_COLUMNS = ['name', 'type', 'disposition', 'unrolled', 'rerolled', 'trades'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const

const FILTER_PARSERS = {
  q: parseAsString.withDefault(''),
  type: parseAsArrayOf(parseAsString).withDefault([]),
  trades: parseAsInteger.withDefault(0),
  priced: parseAsBoolean.withDefault(false),
  multi: parseAsBoolean.withDefault(false),
  sort: parseAsStringLiteral(SORT_COLUMNS).withDefault('disposition'),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault('desc'),
}

type LoadState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; families: RivenFamily[] }

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
        if (!cancelled) setState({ status: 'ready', families: rivens })
      } catch {
        if (!cancelled) setState({ status: 'failed' })
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const all = state.status === 'ready' ? state.families : []

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
          multiOnly: filters.multi,
        }),
        filters.sort,
        filters.dir,
      ),
    [all, filters.q, filters.type, filters.trades, filters.priced, filters.multi, filters.sort, filters.dir],
  )

  const active =
    filters.q !== '' || filters.type.length > 0 || filters.trades > 0 || filters.priced || filters.multi

  const weaponCount = all.reduce((total, family) => total + family.weapons.length, 0)

  return (
    <div>
      <div className="panel p-4 sm:p-5">
        <label className="block">
          <span className="sr-only">Filter by weapon name</span>
          <input
            type="search"
            value={filters.q}
            onChange={(event) => void setFilters({ q: event.target.value })}
            placeholder="Search any weapon — variants find their riven…"
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
                  onClick={() =>
                    void setFilters({
                      type: on
                        ? filters.type.filter((entry) => entry !== type)
                        : [...filters.type, type],
                    })
                  }
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

          <label className="flex items-center gap-2 text-sm text-text-dim">
            <input
              type="checkbox"
              checked={filters.multi}
              onChange={(event) => void setFilters({ multi: event.target.checked })}
              className="size-4 accent-orokin"
            />
            Covers several weapons
          </label>

          {/* The honesty control: the priciest medians here each come from one sale. */}
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
            : `${visible.length.toLocaleString()} of ${all.length.toLocaleString()} rivens · ${weaponCount.toLocaleString()} weapons`}
      </p>

      <div className="panel mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Riven mods by weapon family, with each covered weapon&rsquo;s disposition and last
            week&rsquo;s observed trade prices
          </caption>
          <thead>
            <tr className="border-b border-hairline text-left">
              <Header column="name" label="Riven" filters={filters} setFilters={setFilters} />
              <Header column="disposition" label="Disp." filters={filters} setFilters={setFilters} align="right" />
              <Header column="unrolled" label="Unrolled" filters={filters} setFilters={setFilters} align="right" />
              <Header column="rerolled" label="Rerolled" filters={filters} setFilters={setFilters} align="right" />
            </tr>
          </thead>
          <tbody>
            {visible.map((family) => (
              <FamilyRow key={family.id} family={family} query={filters.q} />
            ))}
          </tbody>
        </table>

        {state.status === 'ready' && visible.length === 0 && (
          <p className="px-3 py-8 text-sm text-text-faint sm:px-5">
            No riven matches. Try lowering the minimum trades, or clearing the type filter.
          </p>
        )}
      </div>
    </div>
  )
}

function FamilyRow({ family, query }: { family: RivenFamily; query: string }) {
  const range = dispositionRange(family)
  // Only when the query hit a covered weapon rather than the family name itself — that is
  // the case where the reader would otherwise wonder why this row came back.
  const hits = matchedWeapons(family, query).filter((name) => name !== family.name)

  return (
    <tr className="border-b border-hairline/50 last:border-0">
      <th scope="row" className="px-2 py-3 text-left font-normal sm:px-5 sm:py-2.5">
        <span className="text-text">{family.name}</span>
        <span className="label ml-2">{family.rivenType}</span>

        {/* The fact the family model exists to show: one mod, several weapons. Mapped
            unconditionally rather than indexing weapons[0], which the schema guarantees is
            present but the type checker cannot know under noUncheckedIndexedAccess. */}
        <span className="mt-0.5 block text-xs text-text-faint">
          {family.weapons.length > 1 && 'Fits '}
          {family.weapons.map((weapon, index) => (
            <span key={weapon.id}>
              {index > 0 && ', '}
              <WeaponName weapon={weapon} />
            </span>
          ))}
        </span>

        {hits.length > 0 && (
          <span className="mt-0.5 block text-xs text-orokin">matched {hits.join(', ')}</span>
        )}
      </th>

      <td className="data-num px-2 py-3 text-right sm:px-5 sm:py-2.5">
        {range === undefined ? (
          <span className="text-xs text-text-faint">—</span>
        ) : (
          <span className="text-text">
            {range.low === range.high
              ? range.low.toFixed(2)
              : `${range.low.toFixed(2)}–${range.high.toFixed(2)}`}
          </span>
        )}
      </td>

      <td className="px-2 py-3 text-right sm:px-5 sm:py-2.5">
        <Price price={family.unrolled} />
      </td>
      <td className="px-2 py-3 text-right sm:px-5 sm:py-2.5">
        <Price price={family.rerolled} />
      </td>
    </tr>
  )
}

/** Linked only where the drop data knows the weapon; most are bought, never dropped. */
function WeaponName({ weapon }: { weapon: RivenFamily['weapons'][number] }) {
  const label = (
    <>
      {weapon.name}
      {weapon.disposition !== undefined && (
        <span className="data-num ml-1 text-text-dim">{weapon.disposition.toFixed(2)}</span>
      )}
    </>
  )
  if (weapon.itemId === undefined) return <span>{label}</span>
  return (
    <Link href={`/item/${weapon.itemId}`} className="transition-colors hover:text-orokin">
      {label}
    </Link>
  )
}

/**
 * Median leads, sample size rides underneath. Riven prices are violently skewed, and a
 * sample under three is called out rather than presented as a price.
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
  column: (typeof SORT_COLUMNS)[number]
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
        onClick={() =>
          void setFilters(
            on ? { dir: filters.dir === 'asc' ? 'desc' : 'asc' } : { sort: column, dir: 'desc' },
          )
        }
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
