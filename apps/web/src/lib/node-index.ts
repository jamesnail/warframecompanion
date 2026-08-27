import type { SolNode, Source } from '@provenance/core'

import type { NodeIndex } from './world'

/**
 * The star chart, keyed by DE's internal node id, with a source link attached ONLY where
 * this site actually has a page for that node.
 *
 * Both halves are build-time facts and ship in the HTML: the live feed identifies everything
 * as "SolNode232", and deriving the link in the browser instead would 404 on the ~15% of
 * nodes that have no unique drops and so never reach the drop tables.
 *
 * Shared by /world and /farm. It was inlined in /world first; a second copy in the planner
 * would have been two slug functions that must agree forever or half the fissure links break
 * on one page and not the other.
 */
export function buildNodeIndex(nodes: readonly SolNode[], sources: readonly Source[]): NodeIndex {
  const missionIds = new Set(
    sources.filter((source) => source.kind === 'mission').map((source) => source.id),
  )

  const index: NodeIndex = {}
  for (const node of nodes) {
    const candidate =
      node.planet === undefined ? undefined : `mission:${slug(node.planet)}/${slug(node.name)}`
    index[node.id] = {
      ...node,
      ...(candidate !== undefined && missionIds.has(candidate) ? { sourceId: candidate } : {}),
    }
  }
  return index
}

function slug(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
