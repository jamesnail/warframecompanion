import Link from 'next/link'
import type { Metadata } from 'next'

import { SearchTrigger } from '@/components/CommandPalette'
import { WorldStateView } from '@/components/WorldStateView'
import type { NodeIndex } from '@/lib/world'
import { getDataset } from '@/lib/data'

export const metadata: Metadata = {
  title: 'World state',
  description:
    'Live Warframe world state: open void fissures by relic tier, invasions, the sortie and archon hunt, Baro Ki’Teer, and open-world cycles.',
  alternates: { canonical: '/world' },
  openGraph: {
    title: 'Warframe world state',
    description:
      'Open void fissures by relic tier, invasions, sortie, archon hunt, Baro Ki’Teer and open-world cycles.',
    url: '/world',
  },
}

/**
 * The one live surface.
 *
 * Everything else on this site is built from committed static JSON. World state cannot be:
 * fissures expire in one to three hours and Baro is present two days in fourteen, so a daily
 * build would publish a page that is wrong most of the time. The shell is prerendered like
 * every other page (constraint 4) and the data arrives in a client island from WFCD's status
 * API, which sends open CORS headers and therefore needs no server route.
 *
 * This is also where the Factions tile ended up. Static node ownership is published for only
 * about half the star chart, but faction ACTIVITY — who you fight in each open fissure, who
 * is invading whom, who the sortie and archon hunt target — is complete, and is the question
 * a player actually has.
 */
export default async function WorldPage() {
  const { sources, nodes } = await getDataset()

  /**
   * The star chart, keyed by DE's internal node id, with a source link attached ONLY where
   * this site actually has a page for that node.
   *
   * Both halves are build-time facts and ship in the HTML: the live feed identifies
   * everything as "SolNode232", and deriving the link in the browser instead would 404 on the
   * ~15% of nodes that have no unique drops and so never reach the drop tables.
   */
  const missionIds = new Set(
    sources.filter((source) => source.kind === 'mission').map((source) => source.id),
  )
  const slug = (input: string): string =>
    input
      .normalize('NFKD')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const index: NodeIndex = {}
  for (const node of nodes) {
    const candidate =
      node.planet === undefined ? undefined : `mission:${slug(node.planet)}/${slug(node.name)}`
    index[node.id] = {
      ...node,
      ...(candidate !== undefined && missionIds.has(candidate) ? { sourceId: candidate } : {}),
    }
  }

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
          <span>World</span>
        </span>
        <SearchTrigger compact />
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">World state</h1>

      <WorldStateView nodes={index} />
    </div>
  )
}
