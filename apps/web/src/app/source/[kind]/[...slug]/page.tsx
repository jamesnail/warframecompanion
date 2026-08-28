import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import { attemptNoun, expectedRuns, perRunChance, stageLabel } from '@provenance/core'
import type { AttemptNoun, Source } from '@provenance/core'

import { PAGE, PageHeader, Panel, PanelHeader, Stat } from '@/components/Primitives'
import { getDataset } from '@/lib/data'
import { groupDrops, type DropGroup } from '@/lib/source-drops'
import { socialImage } from '@/config/site'
import {
  SOURCE_KIND_LABEL,
  needsSourcePage,
  sourceIdFromRoute,
  sourceRouteParams,
} from '@/lib/source-route'

/**
 * The forward view (DESIGN.md § 7): what one mission, enemy, bounty or syndicate drops,
 * by rotation. /item reads the drop graph backwards; without this, every source name on
 * the site is a dead end and the graph only navigates one way.
 *
 * Relics are deliberately absent — they are items too, and /item/<relic> already renders
 * their contents at every refinement level. See lib/source-route.ts.
 *
 * Tables here are uncapped, unlike /item's. There the source list is context and 20 rows is
 * plenty; here the table IS the page, and truncating the largest ones would hide the thing
 * the page exists to show.
 */

export async function generateStaticParams() {
  const { sources, itemsById } = await getDataset()
  const hasItem = (id: string): boolean => itemsById.has(id)
  return sources
    .filter((source) => needsSourcePage(source.id, hasItem))
    .map((source) => sourceRouteParams(source.id))
}

async function findSource(
  params: Promise<{ kind: string; slug: string[] }>,
): Promise<Source | undefined> {
  const { kind, slug } = await params
  const { sourcesById } = await getDataset()
  // Decoded, because sourceHref percent-encodes each segment and a few source slugs
  // contain characters that survive slugging.
  return sourcesById.get(sourceIdFromRoute(kind, slug.map(decodeURIComponent)))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string; slug: string[] }>
}): Promise<Metadata> {
  const source = await findSource(params)
  if (source === undefined) return { title: 'Not found' }

  const where = [source.planet, source.missionType].filter((part) => part !== undefined).join(', ')
  const description =
    where === ''
      ? `Everything ${source.name} drops in Warframe, with drop rates.`
      : `Everything ${source.name} (${where}) drops in Warframe, with drop rates.`
  const { kind, slug } = await params
  const path = `/source/${kind}/${slug.map(encodeURIComponent).join('/')}`
  return {
    title: `${source.name} drop table`,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${source.name} drop table`,
      description,
      url: path,
      images: [socialImage],
    },
  }
}

export default async function SourcePage({
  params,
}: {
  params: Promise<{ kind: string; slug: string[] }>
}) {
  const source = await findSource(params)
  if (source === undefined) notFound()

  const { itemsById, edgesBySource } = await getDataset()
  const edges = edgesBySource.get(source.id) ?? []
  const groups = groupDrops(source, edges, itemsById, stageLabel)

  const meta = [
    source.planet,
    source.missionType,
    source.faction,
    source.levelRange === undefined
      ? undefined
      : `Level ${String(source.levelRange[0])}–${String(source.levelRange[1])}`,
    source.isSteelPath === true ? 'Steel Path' : undefined,
  ].filter((part) => part !== undefined)

  /**
   * Syndicate offerings are guaranteed purchases, not RNG. A "Chance" column reading
   * 100.00% on all 188 rows of the Holdfasts table is noise in the shape of data, so where
   * nothing is random the two columns that describe randomness are dropped and the rank and
   * price the player actually chooses between get the space instead.
   */
  const guaranteed = edges.length > 0 && edges.every((edge) => edge.chance === 1)

  const noun = attemptNoun(source.kind)
  const distinct = new Set(edges.map((edge) => edge.itemId)).size
  const best = edges.reduce((top, edge) => Math.max(top, perRunChance(edge)), 0)

  return (
    <div className={PAGE}>
      <PageHeader
        kicker={
          /* The index, not /browse?kind= — this one is prerendered, so it is a link a
             crawler can follow back up. */
          <Link href={`/source/${source.kind}`} className="transition-colors hover:text-text">
            {SOURCE_KIND_LABEL[source.kind]}
          </Link>
        }
        title={source.name}
        {...(meta.length > 0 ? { lede: <p>{meta.join(' · ')}</p> } : {})}
      />

      {edges.length === 0 ? (
        <p className="mt-6 max-w-prose text-sm text-text-dim">No drops recorded for this source.</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
          <Stat
            label={guaranteed ? 'Offerings' : 'Distinct drops'}
            value={distinct.toLocaleString()}
          />
          {guaranteed ? (
            <Stat label="Chance" value="Guaranteed" />
          ) : (
            // One source, so one noun: an enemy's table counts kills, a mission's runs.
            <Stat
              label={`Best chance / ${noun.one}`}
              value={(best * 100).toFixed(2)}
              unit="%"
              accent
            />
          )}
          {/* Only where the source actually splits. The noun comes from the group titles so
              a Spy mission reads "Vaults", not "Rotations". */}
          {groups.length > 1 && (
            <Stat label={groupNoun(groups)} value={String(groups.length)} />
          )}
        </div>
      )}

      {groups.map((group) => (
        <DropTable
          key={group.key}
          group={group}
          sourceName={source.name}
          noun={noun}
          guaranteed={guaranteed}
          single={groups.length === 1}
        />
      ))}
    </div>
  )
}

/** "Rotation A" -> "Rotations", "Vault A" -> "Vaults". The titles are already correct for
 *  the mission type (stages.ts), so the plural is taken from them rather than re-derived. */
function groupNoun(groups: DropGroup[]): string {
  const first = groups[0]?.title.split(' ')[0] ?? 'Rotation'
  return `${first}s`
}

function DropTable({
  group,
  sourceName,
  noun,
  guaranteed,
  single,
}: {
  group: DropGroup
  sourceName: string
  noun: AttemptNoun
  guaranteed: boolean
  single: boolean
}) {
  return (
    <Panel className="mt-6">
      <PanelHeader
        title={group.title}
        aside={`${group.rows.length.toLocaleString()} ${
          group.rows.length === 1 ? 'row' : 'rows'
        }${guaranteed ? '' : ' · by drop rate'}`}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {single ? `Everything ${sourceName} drops` : `${group.title} rewards from ${sourceName}`}
            {guaranteed ? '' : ', highest drop rate first'}
          </caption>
          <thead>
            <tr className="border-b border-hairline text-left">
              <th scope="col" className="label px-3 py-2 font-normal sm:px-5">
                Item
              </th>
              {guaranteed ? (
                <th scope="col" className="label px-3 py-2 text-right font-normal sm:px-5">
                  Cost
                </th>
              ) : (
                <>
                  <th scope="col" className="label px-3 py-2 text-right font-normal sm:px-5">
                    Chance
                  </th>
                  <th scope="col" className="label px-3 py-2 text-right font-normal sm:px-5">
                    {noun.column}
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row, index) => (
              <tr
                key={`${row.itemId}-${String(index)}`}
                className="border-b border-hairline/50 last:border-0 transition-colors hover:bg-void-800"
              >
                <th scope="row" className="px-3 py-3 text-left font-normal sm:px-5 sm:py-2.5">
                  <Link
                    href={`/item/${row.itemId}`}
                    className="text-text transition-colors hover:text-gold"
                  >
                    {row.itemName}
                  </Link>
                  {/* Units per drop. On a resource table this decides more than the rate
                      does — 350 Plastids at 4% beats 10 at 20%. */}
                  {row.quantity[1] > 1 && (
                    <span className="data-num ml-2 text-xs text-text-dim">
                      ×
                      {row.quantity[0] === row.quantity[1]
                        ? row.quantity[0].toLocaleString()
                        : `${row.quantity[0].toLocaleString()}–${row.quantity[1].toLocaleString()}`}
                    </span>
                  )}
                  <span className="mt-0.5 block text-xs text-text-faint">
                    {[row.category, guaranteed ? undefined : row.detail]
                      .filter((part) => part !== undefined)
                      .join(' · ')}
                  </span>
                </th>
                {guaranteed ? (
                  <td className="data-num px-3 py-3 text-right text-text-dim sm:px-5 sm:py-2.5">
                    {row.detail ?? '—'}
                  </td>
                ) : (
                  <>
                    <td className="data-num px-3 py-3 text-right text-text sm:px-5 sm:py-2.5">
                      {(row.chance * 100).toFixed(2)}%
                    </td>
                    <td className="data-num px-3 py-3 text-right text-text-faint sm:px-5 sm:py-2.5">
                      ~{expectedRuns(row.chance).toFixed(0)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
