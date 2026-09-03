import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import { PAGE, PageHeader, Panel, PanelHeader, Stat } from '@/components/Primitives'
import { BasisLegend, ResourceBasisTag } from '@/components/ResourceBasisTag'
import { getDataset } from '@/lib/data'
import { sourceHref } from '@/lib/source-route'
import { socialImage } from '@/config/site'

/**
 * One place, and everything it is farmed for.
 *
 * Two kinds of row, deliberately not merged. The curated ones say what the planet is FOR —
 * Earth is where you go for Ferrite and Neurodes — and the reward-table ones say what its
 * mission and bounty tables additionally pay, with a published chance. Ranking them together
 * on chance would bury Ferrite, which has no chance at all here, under a credit cache.
 */

async function findPlanet(params: Promise<{ slug: string }>) {
  const { slug } = await params
  const { planets } = await getDataset()
  return planets.find((planet) => planet.slug === slug)
}

export async function generateStaticParams() {
  const { planets } = await getDataset()
  return planets.map((planet) => ({ slug: planet.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const planet = await findPlanet(params)
  if (planet === undefined) return { title: 'Not found' }

  const description = `Every resource farmed on ${planet.name} in Warframe, and what drops it.`
  return {
    title: `${planet.name} resources`,
    description,
    alternates: { canonical: `/planet/${planet.slug}` },
    openGraph: {
      title: `${planet.name} resources`,
      description,
      url: `/planet/${planet.slug}`,
      images: [socialImage],
    },
  }
}

export default async function PlanetPage({ params }: { params: Promise<{ slug: string }> }) {
  const planet = await findPlanet(params)
  if (planet === undefined) notFound()

  const { itemsById, sourcesById } = await getDataset()

  const curated = planet.resources.filter((row) => row.basis !== 'reward-table')
  const derived = planet.resources.filter((row) => row.basis === 'reward-table')

  return (
    <div className={PAGE}>
      <PageHeader
        kicker={
          <Link href="/planets" className="transition-colors hover:text-text">
            Planets
          </Link>
        }
        title={planet.name}
        {...(planet.factions.length > 0
          ? { lede: <p>{planet.factions.join(' · ')}</p> }
          : {})}
      />

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
        <Stat label="Resources" value={planet.resources.length.toLocaleString()} />
        <Stat label="Farmed for" value={curated.length.toLocaleString()} accent />
        {/* An open world has no star-chart nodes, and "0 missions" would read as a defect
            rather than as the true statement that Cetus is not a node. */}
        {planet.nodes > 0 && <Stat label="Missions" value={planet.nodes.toLocaleString()} />}
      </div>

      {curated.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader title="Farmed here" aside={`${String(curated.length)} resources`} />
          <ul>
            {curated.map((row) => (
              <li
                key={row.itemId}
                className="hover-edge flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline/50 px-3 py-3 last:border-0 transition-colors hover:bg-void-800 sm:px-5 sm:py-2.5"
              >
                <Link
                  href={`/item/${row.itemId}`}
                  className="text-sm text-text transition-colors hover:text-gold"
                >
                  {itemsById.get(row.itemId)?.name ?? row.itemId}
                </Link>
                <ResourceBasisTag
                  basis={row.basis}
                  {...(row.faction === undefined ? {} : { faction: row.faction })}
                />
              </li>
            ))}
          </ul>
          <BasisLegend />
        </Panel>
      )}

      {derived.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader
            title="Also in the reward tables"
            aside={`${String(derived.length)} · by drop rate`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Resources listed in {planet.name}&rsquo;s mission and bounty reward tables,
                highest drop rate first
              </caption>
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th scope="col" className="label px-3 py-2 font-normal sm:px-5">
                    Resource
                  </th>
                  <th scope="col" className="label px-3 py-2 font-normal sm:px-5">
                    Best source
                  </th>
                  <th scope="col" className="label px-3 py-2 text-right font-normal sm:px-5">
                    Chance
                  </th>
                </tr>
              </thead>
              <tbody>
                {derived.map((row) => {
                  const source =
                    row.sourceId === undefined ? undefined : sourcesById.get(row.sourceId)
                  return (
                    <tr
                      key={row.itemId}
                      className="border-b border-hairline/50 last:border-0 transition-colors hover:bg-void-800"
                    >
                      <th
                        scope="row"
                        className="px-3 py-3 text-left font-normal sm:px-5 sm:py-2.5"
                      >
                        <Link
                          href={`/item/${row.itemId}`}
                          className="text-text transition-colors hover:text-gold"
                        >
                          {itemsById.get(row.itemId)?.name ?? row.itemId}
                        </Link>
                        {/* Units per drop decides more than the rate does on a resource
                            row — 350 at 4% beats 10 at 20%. */}
                        {row.quantity !== undefined && (
                          <span className="data-num ml-2 text-xs text-text-dim">
                            ×
                            {row.quantity[0] === row.quantity[1]
                              ? row.quantity[0].toLocaleString()
                              : `${row.quantity[0].toLocaleString()}–${row.quantity[1].toLocaleString()}`}
                          </span>
                        )}
                      </th>
                      <td className="px-3 py-3 text-text-dim sm:px-5 sm:py-2.5">
                        {source === undefined || row.sourceId === undefined ? (
                          '—'
                        ) : (
                          <Link
                            href={sourceHref(row.sourceId, (id) => itemsById.has(id))}
                            className="transition-colors hover:text-gold"
                          >
                            {source.name}
                          </Link>
                        )}
                      </td>
                      <td className="data-num px-3 py-3 text-right text-text sm:px-5 sm:py-2.5">
                        {row.chance === undefined ? '—' : `${(row.chance * 100).toFixed(2)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  )
}
