import Link from 'next/link'

import type { RivenPrice, RivenWeapon } from '@provenance/core'

import { Panel, PanelHeader } from '@/components/Primitives'
import { isThin } from '@/lib/rivens'

/**
 * One weapon's riven facts, for its own item page.
 *
 * A server component, unlike the table: nothing here is interactive, and the weapon is known
 * at build time. Shows the full spread rather than just the median, because on a single
 * weapon's page the range IS the useful part — "250 median, 20 to 1000" tells you what you
 * are walking into in a way one number cannot.
 */
export function RivenPanel({ weapon }: { weapon: RivenWeapon }) {
  const rolls: [string, RivenPrice | undefined][] = [
    ['Unrolled', weapon.unrolled],
    ['Rerolled', weapon.rerolled],
  ]
  const traded = rolls.some(([, price]) => price !== undefined)

  return (
    <Panel className="mt-6">
      <PanelHeader
        title="Riven"
        aside={
          <Link href={`/rivens?q=${encodeURIComponent(weapon.name)}`} className="hover:text-text">
            {weapon.rivenType}
          </Link>
        }
      />

      <div className="flex flex-wrap gap-x-10 gap-y-4 px-3 py-4 sm:px-5">
        <div>
          <div className="label">Disposition</div>
          <div className="mt-1 flex items-baseline gap-2">
            {weapon.disposition === undefined ? (
              <span className="text-sm text-text-faint">Not published</span>
            ) : (
              <>
                <span className="data-num text-lg text-orokin">
                  {weapon.disposition.toFixed(2)}
                </span>
                {weapon.dispositionStars !== undefined && (
                  <>
                    <span className="text-xs text-text-faint" aria-hidden="true">
                      {'●'.repeat(weapon.dispositionStars)}
                      {'○'.repeat(5 - weapon.dispositionStars)}
                    </span>
                    <span className="sr-only">{weapon.dispositionStars} of 5</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {rolls.map(([label, price]) => (
          <div key={label}>
            <div className="label">{label}</div>
            {price === undefined ? (
              <div className="mt-1 text-sm text-text-faint">No trades</div>
            ) : (
              <div className="mt-1">
                <span className="data-num text-lg text-text">
                  {Math.round(price.median).toLocaleString()}
                </span>
                <span className="ml-1 text-xs text-text-faint">p median</span>
                <div className="data-num mt-0.5 text-xs text-text-faint">
                  {Math.round(price.min).toLocaleString()}&ndash;
                  {Math.round(price.max).toLocaleString()}p
                  {' · '}
                  <span className={isThin(price.pop) ? 'text-r-legendary' : ''}>
                    {price.pop.toLocaleString()} trade{price.pop === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="border-t border-hairline px-3 py-2.5 text-xs text-text-faint sm:px-5">
        {traded
          ? 'Medians from Digital Extremes’ weekly trade statistics. Riven prices are heavily skewed by outliers, so the median is shown rather than the mean.'
          : 'No riven for this weapon traded in the last published week. Disposition still applies.'}
      </p>
    </Panel>
  )
}
