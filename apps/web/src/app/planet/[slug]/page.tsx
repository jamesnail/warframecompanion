import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import type { PlanetResource } from '@provenance/core'

import { PAGE, PageHeader, Panel, PanelHeader, RarityTag, Stat } from '@/components/Primitives'
import { BasisLegend } from '@/components/ResourceBasisTag'
import { InsightPanel } from '@/components/InsightPanel'
import { getDataset } from '@/lib/data'
import { sourceHref } from '@/lib/source-route'
import { socialImage } from '@/config/site'

/**
 * One place, and everything it is farmed for.
 *
 * Three kinds of row, deliberately not merged. The REGION pool is what enemies and containers
 * here drop — the answer to "what does Earth drop", and the thing DE's tables cannot say.
 * GATHERED rows are mined or fished and are dropped by nothing at all. REWARD TABLE rows are
 * read straight from this place's own missions and bounties and carry a published chance.
 *
 * Ranking them together on chance would bury Ferrite, which has no chance on Earth at all,
 * under a credit cache — which is exactly what the first version of this page did.
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
  const hasItem = (id: string): boolean => itemsById.has(id)
  const name = (id: string): string => itemsById.get(id)?.name ?? id

  const region = planet.resources.filter((row) => row.basis === 'region')
  const gathered = planet.resources.filter((row) => row.basis === 'gathered')
  const derived = planet.resources.filter((row) => row.basis === 'reward-table')

  // Gathered rows group under the method that yields them — mining ore, fishing, and so on —
  // because "how" is the actionable half and the list is otherwise a wall of names.
  const byMethod = new Map<string, PlanetResource[]>()
  for (const row of gathered) {
    const key = row.method ?? 'Gathered'
    byMethod.set(key, [...(byMethod.get(key) ?? []), row])
  }

  // A page dated once, at build time, so every panel agrees and the HTML is deterministic.
  const now = new Date()

  return (
    <div className={PAGE}>
      <PageHeader
        kicker={
          <Link href="/planets" className="transition-colors hover:text-text">
            Planets
          </Link>
        }
        title={planet.name}
        {...(planet.factions.length > 0 ? { lede: <p>{planet.factions.join(' · ')}</p> } : {})}
      />

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
        <Stat label="Resources" value={planet.resources.length.toLocaleString()} />
        <Stat
          label={gathered.length > 0 && region.length === 0 ? 'Gathered here' : 'In the drop pool'}
          value={(region.length > 0 ? region.length : gathered.length).toLocaleString()}
          accent
        />
        {/* An open world has no star-chart nodes, and "0 missions" would read as a defect
            rather than as the true statement that Cetus is not a node. */}
        {planet.nodes > 0 && <Stat label="Missions" value={planet.nodes.toLocaleString()} />}
      </div>

      {region.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader
            title="Region drop pool"
            aside={`${String(region.length)} resources`}
          />
          <p className="max-w-prose px-3 pt-3 text-xs text-text-faint sm:px-5">
            What enemies and containers here drop. Every region has a small fixed pool, and a
            thin one concentrates your rolls — which is why the pool matters more than the node.
          </p>
          <ul className="mt-1">
            {region.map((row) => (
              <li
                key={row.itemId}
                className="hover-edge flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline/50 px-3 py-3 transition-colors last:border-0 hover:bg-void-800 sm:px-5 sm:py-2.5"
              >
                <Link
                  href={`/item/${row.itemId}`}
                  className="text-sm text-text transition-colors hover:text-gold"
                >
                  {name(row.itemId)}
                </Link>
                {row.rarity !== undefined && <RarityTag rarity={row.rarity} />}
              </li>
            ))}
          </ul>
          <BasisLegend />
        </Panel>
      )}

      {gathered.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader title="Gathered here" aside={`${String(gathered.length)} resources`} />
          <p className="max-w-prose px-3 pt-3 text-xs text-text-faint sm:px-5">
            Mined, fished or picked. Nothing drops these, so they appear in no drop table at
            any grain.
          </p>
          <ul className="mt-1">
            {[...byMethod].map(([method, rows]) => (
              <li key={method} className="border-b border-hairline/50 px-3 py-3 last:border-0 sm:px-5">
                <div className="label">{method}</div>
                <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1.5">
                  {rows.map((row) => (
                    <Link
                      key={row.itemId}
                      href={`/item/${row.itemId}`}
                      className="chamfer-sm border border-hairline px-2 py-0.5 text-xs text-text-dim transition-colors hover:border-gold-dim hover:text-gold"
                    >
                      {name(row.itemId)}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {region.length === 0 && <BasisLegend />}
        </Panel>
      )}

      <InsightPanel title="How this is farmed" insights={planet.insights} hasItem={hasItem} now={now} />

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
                      className="border-b border-hairline/50 transition-colors last:border-0 hover:bg-void-800"
                    >
                      <th scope="row" className="px-3 py-3 text-left font-normal sm:px-5 sm:py-2.5">
                        <Link
                          href={`/item/${row.itemId}`}
                          className="text-text transition-colors hover:text-gold"
                        >
                          {name(row.itemId)}
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
                            href={sourceHref(row.sourceId, hasItem)}
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
