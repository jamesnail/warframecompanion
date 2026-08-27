import type { Metadata } from 'next'

import { WorldStateView } from '@/components/WorldStateView'
import { buildNodeIndex } from '@/lib/node-index'
import { getDataset } from '@/lib/data'
import { socialImage } from '@/config/site'
import { PAGE, PageHeader } from '@/components/Primitives'

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
    images: [socialImage],
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

  // Shared with /farm, which needs the same mapping to link a fissure to its node page.
  const index = buildNodeIndex(nodes, sources)

  return (
    <div className={PAGE}>
      <PageHeader kicker="Sources" title="World state" />

      <WorldStateView nodes={index} />
    </div>
  )
}
