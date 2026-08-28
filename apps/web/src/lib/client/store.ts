/**
 * The client-side dataset cache.
 *
 * Data chunks are content-addressed, so the cache key is the chunk name and the stored
 * VERSION tells us whether it is current. There is no expiry and no TTL: a chunk either
 * matches the version the manifest names or it does not.
 *
 * The version is the chunk's own FILENAME — `edges.6dd4839bb36b.json` — rather than the
 * manifest hash. Those were the same thing until prices arrived. Prices change every time
 * the market moves, so they carry a hash of their own; keying on the manifest hash would
 * have meant a price tick invalidating all 5 MB of unchanged drop data every day, which is
 * exactly what content-addressing exists to prevent. A filename already contains its hash,
 * so this is strictly finer-grained and nothing is lost.
 *
 * We store a handful of blobs keyed by name and filter in memory, which is why this is
 * `idb` and not Dexie — nothing here queries IndexedDB (CLAUDE.md § Stack).
 */

import { CHUNKS, getDb, safely } from './db'

interface StoredChunk {
  /** The filename this chunk was fetched as. Contains the content hash. */
  hash: string
  data: unknown
}

export async function readChunk<T>(name: string, version: string): Promise<T | undefined> {
  return safely(async () => {
    const db = await getDb()
    const stored = (await db.get(CHUNKS, name)) as StoredChunk | undefined
    if (stored === undefined || stored.hash !== version) return undefined
    return stored.data as T
  }, undefined)
}

export async function writeChunk(name: string, version: string, data: unknown): Promise<void> {
  await safely(async () => {
    const db = await getDb()
    await db.put(CHUNKS, { hash: version, data } satisfies StoredChunk, name)
  }, undefined)
}

/**
 * Drop anything the current manifest does not name, so a stale build cannot accumulate.
 *
 * Takes every live version rather than one, because the chunks no longer share a version:
 * prices move on their own. Passing a single hash here would have deleted the price chunk on
 * every load and re-fetched it forever — a cache that silently never hits.
 */
export async function pruneStale(versions: readonly string[]): Promise<void> {
  const live = new Set(versions)
  await safely(async () => {
    const db = await getDb()
    const tx = db.transaction(CHUNKS, 'readwrite')
    for (const key of await tx.store.getAllKeys()) {
      const stored = (await tx.store.get(key)) as StoredChunk | undefined
      if (stored !== undefined && !live.has(stored.hash)) await tx.store.delete(key)
    }
    await tx.done
  }, undefined)
}
