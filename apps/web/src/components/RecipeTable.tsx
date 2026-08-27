'use client'

import Link from 'next/link'

import { Panel, PanelHeader } from '@/components/Primitives'
import { useCollection } from '@/lib/client/use-collection'
import { progressOf } from '@/lib/collection'

/**
 * What an assembled item needs, and how much of it you already have.
 *
 * A client island inside an otherwise statically prerendered page (CLAUDE.md constraint 4):
 * the rows and their drop rates are computed at build time and passed in as plain data, and
 * the only thing that happens in the browser is reading four booleans out of IndexedDB.
 */

export interface RecipeRow {
  itemId: string
  name: string
  count: number
  relicCount: number
  bestRelic: number | undefined
  directName: string | undefined
  directChance: number | undefined
  /** No live source at all right now: every relic holding it is out of rotation. */
  vaulted: boolean
}

export function RecipeTable({ rows, itemName }: { rows: RecipeRow[]; itemName: string }) {
  const { owned, ready, toggle } = useCollection()
  const progress = progressOf(rows, owned)

  // Counted over what you still NEED. Once a vaulted part is ticked off it stops being an
  // obstacle, and warning about it anyway would be nagging about a solved problem.
  const blocked = rows.filter((row) => row.vaulted && !(ready && owned.has(row.itemId)))

  return (
    <Panel className="mt-10">
      <PanelHeader
        title="Needs"
        aside={
          // Neutral until IndexedDB answers, or a page that loads with three parts ticked
          // flashes "0 of 5" first and corrects itself, which reads as data loss.
          ready
            ? `${String(progress.owned)} of ${String(progress.total)} owned`
            : `${String(rows.length)} ${rows.length === 1 ? 'component' : 'components'}`
        }
      />

      {ready && progress.complete ? (
        <p className="border-b border-hairline px-3 py-2.5 text-sm text-gold sm:px-5">
          Every component owned. Ready to build.
        </p>
      ) : (
        blocked.length > 0 && (
          <p className="border-b border-hairline px-3 py-2.5 text-sm text-text-dim sm:px-5">
            <span className="text-r-legendary">
              {blocked.length === 1 ? "One part you still need is vaulted" : `${String(blocked.length)} parts you still need are vaulted`}
            </span>
            {" — "}
            this set cannot be finished by farming until{" "}
            {blocked.length === 1 ? "it returns" : "they return"}. Trading is the only route.
          </p>
        )
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Components required to build {itemName}, where each one comes from, and which you
            have marked as owned
          </caption>
          <thead>
            <tr className="border-b border-hairline text-left">
              <th scope="col" className="label px-3 py-2 font-normal sm:px-5">
                <span className="sr-only">Owned</span>
                <span aria-hidden="true">Have</span>
              </th>
              <th scope="col" className="label px-1 py-2 font-normal">
                Component
              </th>
              <th scope="col" className="label px-3 py-2 text-right font-normal sm:px-5">
                Qty
              </th>
              <th scope="col" className="label px-3 py-2 text-right font-normal sm:px-5">
                Best source
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const have = ready && owned.has(row.itemId)
              return (
                <tr key={row.itemId} className="border-b border-hairline/50 last:border-0 transition-colors hover:bg-void-800">
                  <td className="py-3 pl-3 pr-1 sm:py-2.5 sm:pl-5">
                    <input
                      type="checkbox"
                      checked={have}
                      disabled={!ready}
                      onChange={(event) => {
                        toggle(row.itemId, event.target.checked)
                      }}
                      // The name is in the row already, but a bare checkbox is announced as
                      // "checkbox, unchecked" with no indication of what it governs.
                      aria-label={`Owned: ${row.name}`}
                      className="size-4 accent-gold disabled:opacity-40"
                    />
                  </td>
                  <th scope="row" className="px-1 py-3 text-left font-normal sm:py-2.5">
                    <Link
                      href={`/item/${row.itemId}`}
                      className={`transition-colors hover:text-gold ${
                        have ? 'text-text-faint line-through' : 'text-text'
                      }`}
                    >
                      {row.name}
                    </Link>
                  </th>
                  <td className="data-num px-3 py-3 text-right text-text sm:px-5 sm:py-2.5">
                    ×{row.count.toLocaleString()}
                  </td>
                  <td className="px-3 py-3 text-right text-xs text-text-faint sm:px-5 sm:py-2.5">
                    {/* Stacked, not inline: "Corrupted Vor 75.00%" wrapped mid-phrase at
                        360px and split the source name from its own number. */}
                    {row.vaulted ? (
                      <>
                        <span className="block text-r-legendary">Vaulted</span>
                        <span className="block">
                          {row.relicCount.toLocaleString()}{" "}
                          {row.relicCount === 1 ? "relic" : "relics"}, none live
                        </span>
                      </>
                    ) : row.relicCount > 0 ? (
                      <>
                        <span className="block text-text-dim">
                          {row.relicCount.toLocaleString()}{' '}
                          {row.relicCount === 1 ? 'relic' : 'relics'}
                        </span>
                        {row.bestRelic !== undefined && (
                          <span className="data-num block">
                            {(row.bestRelic * 100).toFixed(2)}%
                          </span>
                        )}
                      </>
                    ) : row.directName !== undefined ? (
                      <>
                        <span className="block text-text-dim">{row.directName}</span>
                        {row.directChance !== undefined && (
                          <span className="data-num block">
                            {(row.directChance * 100).toFixed(2)}%
                          </span>
                        )}
                      </>
                    ) : (
                      'No source recorded'
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/**
 * The same toggle for a single item, used on a part's own page.
 *
 * Rendered as a button rather than a checkbox because here it is a standalone action with a
 * visible label, not a row in a form.
 */
export function OwnedToggle({ itemId, itemName }: { itemId: string; itemName: string }) {
  const { owned, ready, toggle } = useCollection()
  const have = ready && owned.has(itemId)

  return (
    <button
      type="button"
      disabled={!ready}
      aria-pressed={have}
      onClick={() => {
        toggle(itemId, !have)
      }}
      className={`chamfer-sm border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
        have
          ? 'border-gold bg-void-700 text-gold'
          : 'border-hairline text-text-dim hover:border-hairline-strong hover:text-text'
      }`}
    >
      {have ? '✓ Owned' : 'Mark as owned'}
      <span className="sr-only"> — {itemName}</span>
    </button>
  )
}

/**
 * Put a set or a part on the farm list.
 *
 * Separate from OwnedToggle because they mean different things and one cannot be derived
 * from the other: owning is inventory, tracking is intent. /farm used to infer intent from
 * inventory — every set holding a component you owned — and owning a single Orokin Cell put
 * 177 sets on the plan.
 */
export function TrackToggle({ itemId, itemName }: { itemId: string; itemName: string }) {
  const { tracked, ready, toggleTracked } = useCollection()
  const on = ready && tracked.has(itemId)

  return (
    <button
      type="button"
      disabled={!ready}
      aria-pressed={on}
      onClick={() => {
        toggleTracked(itemId, !on)
      }}
      className={`chamfer-sm border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
        on
          ? 'border-gold bg-void-700 text-gold'
          : 'border-hairline text-text-dim hover:border-hairline-strong hover:text-text'
      }`}
    >
      {on ? '✓ Farming' : 'Add to farm list'}
      <span className="sr-only"> — {itemName}</span>
    </button>
  )
}
