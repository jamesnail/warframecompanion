import { z } from 'zod'

import { DropEdge, Item, Manifest, MarketPrice, RelicDetail, RivenFamily, Source } from '@provenance/core'

import { pruneStale, readChunk, writeChunk } from './store'

/**
 * Boot sequence (DESIGN.md § 6):
 *   1. fetch manifest.json (~700 bytes, must-revalidate)
 *   2. compare its hash against what IndexedDB holds
 *   3. match -> hydrate from IDB; mismatch or empty -> fetch the hashed chunk and store it
 *
 * Chunks are loaded per surface, not all at once. The palette searches names and needs only
 * `items` (833 KB); pulling the 3.8 MB edge list to power a search box would blow the
 * two-second cold-load budget for nothing. /browse asks for the edges explicitly, because
 * that is the page whose whole job is to show them.
 */

export interface ClientDataset {
  manifest: z.infer<typeof Manifest>
  items: z.infer<typeof Item>[]
}

export interface BrowseDataset extends ClientDataset {
  sources: z.infer<typeof Source>[]
  edges: z.infer<typeof DropEdge>[]
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

/**
 * Chunk loads in flight, keyed by filename.
 *
 * The cache only helps a caller that arrives after someone else has finished writing it, and
 * on a cold load nobody has. /browse mounts the ⌘K palette and the table together; the palette
 * wants `items` and so does the table, both miss the empty store in the same tick, and the
 * 833 KB item chunk was fetched twice — measured, on the heaviest page on the site.
 *
 * Keyed by filename rather than by chunk name because the filename contains the content hash,
 * so two callers sharing an entry are provably asking for the same bytes. That is also what
 * makes the cast below sound: a given file is only ever parsed by one schema.
 */
const chunkInFlight = new Map<string, Promise<unknown>>()

/**
 * One content-addressed chunk, from IndexedDB if it is current and from the network if not.
 *
 * The write is fire-and-forget: a cache that fails to persist must behave like a cache
 * miss, never like an error, because private browsing and exhausted quota both throw here.
 */
async function loadChunk<T>(
  manifest: z.infer<typeof Manifest>,
  name: string,
  schema: { parse: (input: unknown) => T[] },
): Promise<T[]> {
  const filename = manifest.files[name]
  if (filename === undefined) throw new Error(`manifest has no ${name} chunk`)

  const pending = chunkInFlight.get(filename)
  if (pending !== undefined) return pending as Promise<T[]>

  const work = (async (): Promise<T[]> => {
    // Versioned by filename, not by manifest hash: prices carry their own hash so that a
    // price tick does not invalidate 5 MB of unchanged drop data (see store.ts).
    const cached = await readChunk<T[]>(name, filename)
    if (cached !== undefined) return cached

    const rows = await fetchParsed(`/data/${filename}`, schema)

    // Written after the data is in hand, so a failed fetch cannot leave a half-populated
    // cache that looks current. Pruning must never delay first paint.
    void writeChunk(name, filename, rows).then(() => pruneStale(Object.values(manifest.files)))

    return rows
  })()

  chunkInFlight.set(filename, work)
  try {
    return await work
  } finally {
    // Dropped on settle, success or failure. Holding it would turn this into a second cache
    // in front of the real one, with none of its versioning.
    chunkInFlight.delete(filename)
  }
}

/**
 * Concurrent callers share one request; sequential ones do not.
 *
 * /browse asks for the browse dataset and the prices together, and each used to fetch the
 * manifest itself — two requests for the same 700 bytes, in the same tick, on the page with
 * the heaviest load already. The promise is cached only while it is in flight and cleared as
 * soon as it settles, which is the whole fix: a manifest held for the life of the tab would
 * pin the session to one build, and the manifest is precisely the file that exists to tell a
 * client a new build has shipped.
 */
let inFlight: Promise<z.infer<typeof Manifest>> | undefined

async function loadManifest(): Promise<z.infer<typeof Manifest>> {
  if (inFlight !== undefined) return inFlight
  // Same-origin only. The client never talks to Digital Extremes (CLAUDE.md constraint 2).
  const request = fetchParsed('/data/manifest.json', Manifest)
  inFlight = request
  try {
    return await request
  } finally {
    // Cleared on failure too, so one network blip does not cache a rejected promise and make
    // every later load fail with it.
    inFlight = undefined
  }
}

/**
 * The riven table — 132 KB, and the only chunk /rivens needs.
 *
 * Deliberately not bundled with the item table: dispositions and weekly trade prices are a
 * self-contained dataset keyed by weapon name, and most of the weapons in it — 467 of 724 at
 * the last count — have no catalogue item at all, because they are bought rather than dropped.
 */
export async function loadRivens(): Promise<{
  manifest: z.infer<typeof Manifest>
  rivens: z.infer<typeof RivenFamily>[]
}> {
  const manifest = await loadManifest()
  const rivens = await loadChunk(manifest, 'rivens', z.array(RivenFamily))
  return { manifest, rivens }
}

/**
 * The relic table — 294 KB, and all /relics needs.
 *
 * The item chunk is deliberately NOT pulled alongside it: the page needs 1,366 display names
 * out of a 1 MB table, so the server hands those down in the HTML instead. Fetching a
 * megabyte to read 35 KB of it would be the expensive way to be consistent.
 */
export async function loadRelicDetails(): Promise<{
  manifest: z.infer<typeof Manifest>
  relics: z.infer<typeof RelicDetail>[]
}> {
  const manifest = await loadManifest()
  const relics = await loadChunk(manifest, 'relics', z.array(RelicDetail))
  return { manifest, relics }
}

/**
 * Live trade prices — a small chunk, and the only one that is genuinely optional.
 *
 * Returns an empty map rather than throwing when the chunk is absent. Prices are the one
 * dataset the pipeline is allowed to skip (the market API is a third party and its outage is
 * not a reason to stop shipping drop data), so the client has to treat "no prices" as a
 * normal state and hide the feature — not as an error that blanks the page.
 */
export async function loadPrices(): Promise<Map<string, z.infer<typeof MarketPrice>>> {
  try {
    const manifest = await loadManifest()
    if (manifest.files.prices === undefined) return new Map()
    const rows = await loadChunk(manifest, 'prices', z.array(MarketPrice))
    return new Map(rows.map((row) => [row.itemId, row]))
  } catch {
    return new Map()
  }
}

/** Items only — what the ⌘K palette needs. */
export async function loadDataset(): Promise<ClientDataset> {
  const manifest = await loadManifest()
  const items = await loadChunk(manifest, 'items', z.array(Item))
  return { manifest, items }
}

/**
 * Items, sources and edges — what /browse needs.
 *
 * Fetched in parallel, and every one of them is content-addressed and immutable, so the
 * second visit to /browse costs no network at all.
 */
export async function loadBrowseDataset(): Promise<BrowseDataset> {
  const manifest = await loadManifest()
  const [items, sources, edges] = await Promise.all([
    loadChunk(manifest, 'items', z.array(Item)),
    loadChunk(manifest, 'sources', z.array(Source)),
    loadChunk(manifest, 'edges', z.array(DropEdge)),
  ])
  return { manifest, items, sources, edges }
}
