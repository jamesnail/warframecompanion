import { Suspense } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { REFINEMENT_ORDER, REFINEMENT_TABLE, SLOTS_PER_RELIC } from '@provenance/core'
import type { RelicRarity } from '@provenance/core'

import { SearchTrigger } from '@/components/CommandPalette'
import { Panel, PanelHeader, RarityTag } from '@/components/Primitives'
import { RelicTable } from '@/components/RelicTable'
import { getDataset } from '@/lib/data'

export const metadata: Metadata = {
  title: 'Void Relics',
  description:
    'Every Void Relic, what it contains, which are still farmable, and how refining changes the odds.',
  alternates: { canonical: '/relics' },
  openGraph: {
    title: 'Void Relics',
    description: 'Every Void Relic, what it contains, and which are still farmable.',
    url: '/relics',
  },
}

const RARITIES: RelicRarity[] = ['common', 'uncommon', 'rare']

/** Same trick the item page uses: six columns do not fit a 360px phone, and Radiant — the
 *  one number people come for — was the one falling off the right edge. */
const REFINEMENT_ABBR: Record<string, string> = {
  intact: 'Int',
  exceptional: 'Exc',
  flawless: 'Flw',
  radiant: 'Rad',
}

/**
 * The relic browser (DESIGN.md § 7): vaulted filtering and refinement comparison.
 *
 * Distinct from /browse?category=Relic, which answers "where do relics drop from" — a row
 * there is one edge, so a relic appears once per place it drops. Here a row is one RELIC and
 * the question is the other way round: what is inside it, and can I still get it.
 *
 * The search matches CONTENTS as well as names, which is the actual use: you go looking for
 * a part, not for a relic.
 *
 * Names are handed down from the server rather than fetched. The page needs 1,366 display
 * names out of a 1 MB item table; shipping 35 KB of them in the HTML beats pulling the
 * megabyte to read 3% of it.
 */
export default async function RelicsPage() {
  const { relics, itemsById } = await getDataset()

  const names: Record<string, string> = {}
  for (const relic of relics) {
    names[relic.id] ??= itemsById.get(relic.id)?.name ?? relic.id
    for (const reward of relic.rewards) {
      names[reward.itemId] ??= itemsById.get(reward.itemId)?.name ?? reward.itemId
    }
  }

  const farmable = relics.filter((relic) => !relic.vaulted).length

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-6 sm:py-16">
      <nav className="label mb-6 flex items-center justify-between gap-4">
        <span>
          <Link href="/" className="transition-colors hover:text-text">
            Provenance
          </Link>
          <span className="mx-2 text-hairline-strong" aria-hidden="true">
            /
          </span>
          <span>Relics</span>
        </span>
        <SearchTrigger compact />
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">Void Relics</h1>
      <p className="mt-2 max-w-prose text-sm text-text-dim">
        {relics.length.toLocaleString()} relics, of which{' '}
        <strong className="text-text">{farmable.toLocaleString()}</strong> are still dropped by
        something. Search matches what is inside a relic as well as its name — look for the
        part, not the relic.
      </p>

      {/* The refinement comparison, stated once. It is a property of the SYSTEM, not of any
          individual relic: every common sits at the same odds as every other common. Putting
          it in each row would repeat one table 771 times. */}
      <Panel className="mt-8">
        <PanelHeader title="What refining buys you" aside="chance per slot" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Chance of each rarity tier at each refinement level, and how many slots of each a
              relic has
            </caption>
            <thead>
              <tr className="border-b border-hairline text-left">
                <th scope="col" className="label px-3 py-2 font-normal sm:px-5">
                  Rarity
                </th>
                {/* Secondary: how many of the six slots this rarity occupies. First thing to
                    go on a narrow screen, because the chances are what the table is for. */}
                <th scope="col" className="label hidden px-2 py-2 text-right font-normal sm:table-cell">
                  Slots
                </th>
                {REFINEMENT_ORDER.map((refinement) => (
                  <th
                    key={refinement}
                    scope="col"
                    // aria-label, NOT an sr-only span: sr-only is position:absolute, so it
                    // escapes the overflow-x-auto container and grows the document instead of
                    // being clipped. That is what put 13px of real overflow on this page.
                    aria-label={refinement}
                    className="label px-2 py-2 text-right font-normal last:pr-3 sm:px-3 sm:last:pr-5"
                  >
                    <span aria-hidden="true" className="sm:hidden">
                      {REFINEMENT_ABBR[refinement]}
                    </span>
                    <span aria-hidden="true" className="hidden capitalize sm:inline">
                      {refinement}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RARITIES.map((rarity) => (
                <tr key={rarity} className="border-b border-hairline/50 last:border-0">
                  <th scope="row" className="px-3 py-2.5 text-left font-normal sm:px-5">
                    <RarityTag rarity={rarity} />
                  </th>
                  <td className="data-num hidden px-2 py-2.5 text-right text-text-faint sm:table-cell">
                    {SLOTS_PER_RELIC[rarity]}
                  </td>
                  {REFINEMENT_ORDER.map((refinement) => {
                    const chance = REFINEMENT_TABLE[refinement][rarity]
                    const best = rarity === 'common' ? refinement === 'intact' : refinement === 'radiant'
                    return (
                      <td
                        key={refinement}
                        className={`data-num px-2 py-2.5 text-right last:pr-3 sm:px-3 sm:last:pr-5 ${
                          best ? 'text-text' : 'text-text-faint'
                        }`}
                      >
                        {(chance * 100).toFixed(2)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* The part people get wrong: refining is not a straight upgrade. */}
        <p className="border-t border-hairline px-3 py-2.5 text-xs text-text-faint sm:px-5">
          Refining is a trade, not an upgrade. It moves odds from the common slots to the rare
          one, so if you are farming a common reward an Intact relic is your best chance and
          Radiant is your worst.
        </p>
      </Panel>

      <div className="mt-8">
        {/* Required, not decorative: a component reading search params cannot be prerendered
            without a Suspense boundary. */}
        <Suspense fallback={<p className="label">Loading…</p>}>
          <RelicTable names={names} />
        </Suspense>
      </div>
    </div>
  )
}
