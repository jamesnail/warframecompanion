import { openDB, type IDBPDatabase } from 'idb'

/**
 * The client-side dataset cache.
 *
 * Data chunks are content-addressed, so the cache key is the chunk name and the stored
 * hash tells us whether it is current. There is no expiry and no TTL: a chunk either
 * matches the live manifest hash or it does not.
 *
 * We store a handful of blobs keyed by hash and filter in memory, which is why this is
 * `idb` and not Dexie — nothing here queries IndexedDB (CLAUDE.md § Stack).
 */

const DB_NAME = 'provenance'
const DB_VERSION = 1
const CHUNKS = 'chunks'

interface StoredChunk {
  /** The manifest hash this chunk was fetched under. */
  hash: string
  data: unknown
}

let dbPromise: Promise<IDBPDatabase> | undefined

function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS)
    },
  })
  return dbPromise
}

/**
 * Every IndexedDB call is wrapped: private browsing, disabled site data and quota
 * exhaustion all throw here, and none of them should blank the page. A cache miss and a
 * broken cache must behave identically — refetch and carry on (CLAUDE.md § Errors).
 */
async function safely<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation()
  } catch {
    return fallback
  }
}

export async function readChunk<T>(name: string, hash: string): Promise<T | undefined> {
  return safely(async () => {
    const db = await getDb()
    const stored = (await db.get(CHUNKS, name)) as StoredChunk | undefined
    if (stored === undefined || stored.hash !== hash) return undefined
    return stored.data as T
  }, undefined)
}

export async function writeChunk(name: string, hash: string, data: unknown): Promise<void> {
  await safely(async () => {
    const db = await getDb()
    await db.put(CHUNKS, { hash, data } satisfies StoredChunk, name)
  }, undefined)
}

/** Drop anything not matching the current hash, so a stale build cannot accumulate. */
export async function pruneStale(hash: string): Promise<void> {
  await safely(async () => {
    const db = await getDb()
    const tx = db.transaction(CHUNKS, 'readwrite')
    for (const key of await tx.store.getAllKeys()) {
      const stored = (await tx.store.get(key)) as StoredChunk | undefined
      if (stored !== undefined && stored.hash !== hash) await tx.store.delete(key)
    }
    await tx.done
  }, undefined)
}
