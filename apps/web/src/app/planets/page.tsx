import Link from 'next/link'
import type { Metadata } from 'next'

import { PAGE, PageHeader, Panel, PanelHeader } from '@/components/Primitives'
import { getDataset } from '@/lib/data'
import { socialImage } from '@/config/site'

/**
 * The star chart as a farming index: which place is farmed for what.
 *
 * "What does Earth drop" is a question this tool could not answer for its whole life, and
 * not for want of a page — the drop tables genuinely do not contain the answer. See
 * DESIGN.md § 16 for why, and packages/sources/src/planets.ts for what had to be curated to
 * make it answerable.
 *
 * Prerendered like everything else. This and /planet/[slug] are indexable, which is the
 * point: "warframe earth resources" is a real search and /browse cannot serve it, because
 * /browse renders on the client.
 */

export const metadata: Metadata = {
  title: 'Resources by planet',
  description:
    'What every planet in Warframe is farmed for — resources by place, with the faction that drops them.',
  alternates: { canonical: '/planets' },
  openGraph: {
    title: 'Resources by planet',
    description: 'What every planet in Warframe is farmed for.',
    url: '/planets',
    images: [socialImage],
  },
}

/** How many resource names each card previews before it stops. Enough to recognise the
 *  planet by its list; the page itself has the rest. */
const PREVIEW = 6

export default async function PlanetsPage() {
  const { planets, itemsById } = await getDataset()
  const name = (id: string): string => itemsById.get(id)?.name ?? id

  return (
    <div className={PAGE}>
      <PageHeader
        kicker="Sources"
        title="Resources by planet"
        lede={
          <p>
            What each place is farmed for, and who drops it. Open-world resources are listed
            too — nothing drops them, so they appear in no drop table at any grain.
          </p>
        }
      />

      <Panel className="mt-8">
        <PanelHeader
          title="Star chart"
          aside={`${String(planets.length)} places`}
        />
        <ul className="grid grid-cols-1 sm:grid-cols-2">
          {planets.map((planet) => {
            // The curated rows are what the place is FOR; the reward-table rows are what its
            // tables happen to also pay. A card has room for one of those, so it shows the
            // first.
            const headline = planet.resources.filter((row) => row.basis !== 'reward-table')
            const preview = (headline.length > 0 ? headline : planet.resources).slice(0, PREVIEW)
            return (
              <li
                key={planet.slug}
                className="border-b border-hairline/50 last:border-0 sm:odd:border-r"
              >
                <Link
                  href={`/planet/${planet.slug}`}
                  className="hover-edge block px-3 py-3 transition-colors hover:bg-void-800 sm:px-5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="text-sm text-text">{planet.name}</span>
                    <span className="data-num shrink-0 text-xs text-text-faint">
                      {planet.resources.length.toLocaleString()}
                      <span className="sr-only"> resources</span>
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-text-faint">
                    {preview.map((row) => name(row.itemId)).join(' · ')}
                    {preview.length < (headline.length > 0 ? headline.length : planet.resources.length)
                      ? ' …'
                      : ''}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}
