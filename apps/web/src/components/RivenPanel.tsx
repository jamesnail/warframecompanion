import Link from 'next/link'

import type { RivenFamily, RivenPrice } from '@provenance/core'

import { Panel, PanelHeader } from '@/components/Primitives'
import { isThin } from '@/lib/rivens'

/**
 * The riven facts for one weapon's page.
 *
 * A server component, unlike the table: nothing here is interactive and the weapon is known
 * at build time. Shows the full price spread rather than just the median, because on a single
 * weapon's page the range IS the useful part.
 *
 * The panel is careful about whose numbers these are. Disposition belongs to THIS weapon; the
 * price belongs to the riven mod, which fits every weapon in the family. On a Cernos Prime
 * page that means a 1.25 disposition beside a price for "Cernos" rivens — stating that plainly
 * is the whole point, because a reader who assumed the price was for a "Cernos Prime riven"
 * would go looking for a mod that does not exist.
 */
export function RivenPanel({
  family,
  weaponId,
}: {
  family: RivenFamily
  /** Which member of the family this page is for. */
  weaponId: string
}) {
  const self = family.weapons.find((weapon) => weapon.itemId === weaponId) ?? family.weapons[0]
  const others = family.weapons.filter((weapon) => weapon !== self)
  const rolls: [string, RivenPrice | undefined][] = [
    ['Unrolled', family.unrolled],
    ['Rerolled', family.rerolled],
  ]
  const traded = rolls.some(([, price]) => price !== undefined)

  return (
    <Panel className="mt-6">
      <PanelHeader
        title="Riven"
        aside={
          <Link href={`/rivens?q=${encodeURIComponent(family.name)}`} className="hover:text-text">
            {family.rivenType}
          </Link>
        }
      />

      <div className="flex flex-wrap gap-x-10 gap-y-4 px-3 py-4 sm:px-5">
        <div>
          <div className="label">Disposition</div>
          <div className="mt-1 flex items-baseline gap-2">
            {self?.disposition === undefined ? (
              <span className="text-sm text-text-faint">Not published</span>
            ) : (
              <>
                <span className="data-num text-lg text-orokin">{self.disposition.toFixed(2)}</span>
                {self.dispositionStars !== undefined && (
                  <>
                    <span className="text-xs text-text-faint" aria-hidden="true">
                      {'●'.repeat(self.dispositionStars)}
                      {'○'.repeat(5 - self.dispositionStars)}
                    </span>
                    <span className="sr-only">{self.dispositionStars} of 5</span>
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

      {/* The fact that makes the price legible: it is not this weapon's riven, it is the
          family's, and the same mod fits every weapon named here. */}
      {others.length > 0 && (
        <p className="border-t border-hairline px-3 py-2.5 text-xs text-text-dim sm:px-5">
          A <span className="text-text">{family.name}</span> riven — the same mod also fits{' '}
          {others.map((weapon, index) => (
            <span key={weapon.id}>
              {index > 0 && (index === others.length - 1 ? ' and ' : ', ')}
              {/* Underlined where a page exists, plain where it does not — several variants
                  are bought rather than dropped, so the drop tables never mention them and
                  this site has nothing to link to. Drawing the difference stops the plain
                  ones reading as broken links. */}
              {weapon.itemId === undefined ? (
                <span
                  className="text-text"
                  title={`${weapon.name} is not in the drop tables — no page here`}
                >
                  {weapon.name}
                </span>
              ) : (
                <Link
                  href={`/item/${weapon.itemId}`}
                  className="text-text underline decoration-hairline-strong underline-offset-2 transition-colors hover:text-orokin"
                >
                  {weapon.name}
                </Link>
              )}
              {weapon.disposition !== undefined && (
                <span className="data-num text-text-faint"> {weapon.disposition.toFixed(2)}</span>
              )}
            </span>
          ))}
          . Each keeps its own disposition.
        </p>
      )}

      <p className="border-t border-hairline px-3 py-2.5 text-xs text-text-faint sm:px-5">
        {traded
          ? 'Medians from Digital Extremes’ weekly trade statistics. Riven prices are heavily skewed by outliers, so the median is shown rather than the mean.'
          : 'No riven for this weapon traded in the last published week. Disposition still applies.'}
      </p>
    </Panel>
  )
}
