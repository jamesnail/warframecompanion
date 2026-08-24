import { z } from 'zod'

import { Item, Manifest } from '@provenance/core'

import { pruneStale, readChunk, writeChunk } from './store'

/**
 * Boot sequence (DESIGN.md § 6):
 *   1. fetch manifest.json (~700 bytes, must-revalidate)
 *   2. compare its hash against what IndexedDB holds
 *   3. match -> hydrate from IDB; mismatch or empty -> fetch the hashed chunk and store it
 *
 * Only `items` is loaded here. The palette searches names, and pulling the 2 MB edge list
 * to power a search box would blow the two-second cold-load budget for no benefit. The
 * store is generic, so /browse can add the chunks it needs in a later phase.
 */

export interface ClientDataset {
  manifest: z.infer<typeof Manifest>
  items: z.infer<typeof Item>[]
}

/**
 * Parsed, not cast. CLAUDE.md requires external data to go through Zod at the boundary,
 * and this is a boundary even though we generated the file: a half-written deploy or a
 * stale CDN object would otherwise be cast to Manifest and pin the cache on a hash that
 * does not exist. Failing here degrades to "search unavailable", which is honest.
 */
async function fetchParsed<T>(url: string, schema: { parse: (input: unknown) => T }): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> HTTP ${String(response.status)}`)
  return schema.parse(await response.json())
}

export async function loadDataset(): Promise<ClientDataset> {
  // Same-origin only. The client never talks to Digital Extremes (CLAUDE.md constraint 2).
  const manifest = await fetchParsed('/data/manifest.json', Manifest)

  const filename = manifest.files.items
  if (filename === undefined) throw new Error('manifest has no items chunk')

  const cached = await readChunk<z.infer<typeof Item>[]>('items', manifest.hash)
  if (cached !== undefined) return { manifest, items: cached }

  const items = await fetchParsed(`/data/${filename}`, z.array(Item))

  // Written after the data is in hand, so a failed fetch cannot leave a half-populated
  // cache that looks current. Pruning is fire-and-forget; it must never delay first paint.
  void writeChunk('items', manifest.hash, items).then(() => pruneStale(manifest.hash))

  return { manifest, items }
}
