/**
 * What the player already owns.
 *
 * The first user-owned data in the app, and it sets the pattern the riven tracker will
 * reuse (DESIGN.md § 9): IndexedDB, no account, no server, explicit JSON export/import as
 * the entire backup story. CLAUDE.md constraint 1 — this data exists in one browser and
 * nowhere else, and the UI has to say so rather than implying a sync that does not exist.
 *
 * Exposed as an external store rather than React state because two surfaces read it at once
 * — the recipe table and the header progress — and they must never disagree about whether a
 * part is ticked.
 */

import { COLLECTION, getDb, safely } from './db'

const OWNED_KEY = 'owned'

/**
 * Stable empty set for the server render and the pre-hydration client render.
 *
 * useSyncExternalStore requires a snapshot that is referentially stable when nothing has
 * changed; returning a fresh `new Set()` here would re-render forever.
 */
const EMPTY: ReadonlySet<string> = new Set()

let owned: ReadonlySet<string> = EMPTY
let loaded = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): ReadonlySet<string> {
  return owned
}

/** The server has no collection, and neither does the client until IDB answers. Both must
 *  render the same thing or React reports a hydration mismatch on every page with a toggle. */
export function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY
}

export function isLoaded(): boolean {
  return loaded
}

/** Read the collection into memory. Safe to call repeatedly; only the first does work. */
export async function hydrate(): Promise<void> {
  if (loaded) return
  const stored = await safely(async () => {
    const db = await getDb()
    return (await db.get(COLLECTION, OWNED_KEY)) as unknown
  }, undefined)

  loaded = true
  const ids = normalizeIds(stored)
  // Only replace the snapshot if there is something to say, so a hydrate that finds an
  // empty collection does not hand every subscriber a new-but-equal Set.
  if (ids.length > 0) owned = new Set(ids)
  emit()
}

async function persist(next: ReadonlySet<string>): Promise<void> {
  owned = next
  emit()
  // Written after the in-memory update so a storage failure — private browsing, exhausted
  // quota — still leaves the UI responsive for the session. It degrades to "not saved",
  // never to "the click did nothing" (CLAUDE.md § Errors).
  await safely(async () => {
    const db = await getDb()
    await db.put(COLLECTION, [...next].sort((a, b) => a.localeCompare(b)), OWNED_KEY)
  }, undefined)
}

export async function setOwned(itemId: string, isOwned: boolean): Promise<void> {
  const next = new Set(owned)
  if (isOwned) next.add(itemId)
  else next.delete(itemId)
  await persist(next)
}

export async function clearAll(): Promise<void> {
  await persist(new Set())
}

export async function replaceAll(ids: readonly string[]): Promise<void> {
  await persist(new Set(ids))
}

export async function mergeIn(ids: readonly string[]): Promise<void> {
  await persist(new Set([...owned, ...ids]))
}

/** The export envelope. Versioned from the start: this file is the user's only backup, and
 *  a format change later must be able to tell what it is reading. */
export interface CollectionExport {
  format: 'provenance-collection'
  version: 1
  exportedAt: string
  owned: string[]
}

export function toExport(ids: ReadonlySet<string>, now: string): CollectionExport {
  return {
    format: 'provenance-collection',
    version: 1,
    exportedAt: now,
    owned: [...ids].sort((a, b) => a.localeCompare(b)),
  }
}

/**
 * Read an exported file back.
 *
 * Deliberately lenient about everything except the shape of the id list: an import that
 * rejects a file the user cannot repair has destroyed their backup for them. Unknown fields
 * are ignored and a newer `version` is still read, because the id list is the payload and
 * it is a list of strings in every version there will ever be.
 */
export function normalizeIds(input: unknown): string[] {
  const raw =
    Array.isArray(input) ? input
    : typeof input === 'object' && input !== null && 'owned' in input ? input.owned
    : undefined

  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((entry): entry is string => typeof entry === 'string' && entry !== ''))]
}
