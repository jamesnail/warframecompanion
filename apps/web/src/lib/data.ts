import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { DropEdge, Item, Manifest, RelicDetail, Source } from '@provenance/core'

/**
 * Build-time data access.
 *
 * This reads the committed JSON off disk during `next build` so that pages can be
 * statically prerendered. It is NOT the client runtime path — the browser gets its data
 * from /data/*.json via IndexedDB (DESIGN.md § 6), which lands in Phase 3. Nothing here
 * runs in a request.
 */

const DATA_DIR = join(process.cwd(), 'public', 'data')

export interface Dataset {
  manifest: Manifest
  items: Item[]
  sources: Source[]
  edges: DropEdge[]
  relics: RelicDetail[]
  itemsById: Map<string, Item>
  sourcesById: Map<string, Source>
  /** The reverse index — the whole point of the tool. */
  edgesByItem: Map<string, DropEdge[]>
  relicsByReward: Map<string, RelicDetail[]>
}

let cached: Promise<Dataset> | undefined

async function readChunk<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(join(DATA_DIR, filename), 'utf8')) as T
}

async function load(): Promise<Dataset> {
  const manifest = await readChunk<Manifest>('manifest.json')

  const [items, sources, edges, relics] = await Promise.all([
    readChunk<Item[]>(manifest.files.items ?? ''),
    readChunk<Source[]>(manifest.files.sources ?? ''),
    readChunk<DropEdge[]>(manifest.files.edges ?? ''),
    readChunk<RelicDetail[]>(manifest.files.relics ?? ''),
  ])

  const itemsById = new Map(items.map((item) => [item.id, item]))
  const sourcesById = new Map(sources.map((source) => [source.id, source]))

  const edgesByItem = new Map<string, DropEdge[]>()
  for (const edge of edges) {
    const list = edgesByItem.get(edge.itemId)
    if (list === undefined) edgesByItem.set(edge.itemId, [edge])
    else list.push(edge)
  }

  const relicsByReward = new Map<string, RelicDetail[]>()
  for (const relic of relics) {
    for (const reward of relic.rewards) {
      const list = relicsByReward.get(reward.itemId)
      if (list === undefined) relicsByReward.set(reward.itemId, [relic])
      else list.push(relic)
    }
  }

  return { manifest, items, sources, edges, relics, itemsById, sourcesById, edgesByItem, relicsByReward }
}

/** Memoised so 2000+ statically generated pages parse the dataset once, not once each. */
export function getDataset(): Promise<Dataset> {
  cached ??= load()
  return cached
}
