import { openDB, type IDBPDatabase } from 'idb'

/**
 * The single IndexedDB connection, and the single place the version is declared.
 *
 * This is not tidiness. `openDB` throws VersionError if it is called with a version LOWER
 * than the one already open, so two modules each opening 'provenance' at their own version
 * is a bug that only appears in whichever order the user happens to visit pages in. One
 * schema, one version, one connection — every store is declared here.
 *
 * Bump DB_VERSION when adding a store, and add it to `upgrade` unconditionally: the callback
 * runs for a fresh database and for every intermediate upgrade, so each store creation has
 * to be guarded by its own existence check rather than by a version comparison.
 */

/**
 * DO NOT RENAME, including if the product is renamed.
 *
 * This string is where every viewer's collection, farm list and settings physically live. A
 * rebrand that changed it would not migrate anything — it would silently open a new, empty
 * database while the real one sat untouched under the old name, and every user would find
 * their collection gone with no error to explain it. The product name lives in `site.ts`;
 * this is storage, and storage keys outlive names.
 */
const DB_NAME = 'provenance'
const DB_VERSION = 2

export const CHUNKS = 'chunks'
export const COLLECTION = 'collection'

let dbPromise: Promise<IDBPDatabase> | undefined

export function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS)
      if (!db.objectStoreNames.contains(COLLECTION)) db.createObjectStore(COLLECTION)
    },
  })
  return dbPromise
}

/**
 * Every IndexedDB call is wrapped: private browsing, disabled site data and quota
 * exhaustion all throw, and none of them should blank the page. A cache miss and a broken
 * cache must behave identically (CLAUDE.md § Errors).
 */
export async function safely<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation()
  } catch {
    return fallback
  }
}
