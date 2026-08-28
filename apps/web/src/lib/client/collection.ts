/**
 * What the player owns, and what they are trying to get.
 *
 * The first user-owned data in the app, and it sets the pattern the riven tracker will
 * reuse (DESIGN.md § 9): IndexedDB, no account, no server, explicit JSON export/import as
 * the entire backup story. CLAUDE.md constraint 1 — this data exists in one browser and
 * nowhere else, and the UI has to say so rather than implying a sync that does not exist.
 *
 * TWO sets, not one. `owned` is inventory; `tracked` is intent, and it has to be stated
 * rather than inferred. /farm originally derived "what you are working on" from owned parts
 * — any set where you held at least one component — which looked reasonable until you tick
 * a shared component: Orokin Cell is a component of 177 sets, so owning one put 177 sets on
 * the plan. Intent cannot be guessed from inventory, so the user names it.
 *
 * Exposed as an external store rather than React state because several surfaces read it at
 * once and they must never disagree about whether a part is ticked.
 */

import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@provenance/core'

import { COLLECTION, getDb, safely } from './db'

const OWNED_KEY = 'owned'
const TRACKED_KEY = 'tracked'

/**
 * Stable empty set for the server render and the pre-hydration client render.
 *
 * useSyncExternalStore requires a snapshot that is referentially stable when nothing has
 * changed; returning a fresh `new Set()` here would re-render forever.
 */
const EMPTY: ReadonlySet<string> = new Set()

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

/** One persisted set of ids. Two of these exist; everything else here is shared. */
interface IdSet {
  key: string
  value: ReadonlySet<string>
}

const ownedSet: IdSet = { key: OWNED_KEY, value: EMPTY }
const trackedSet: IdSet = { key: TRACKED_KEY, value: EMPTY }

async function persist(store: IdSet, next: ReadonlySet<string>): Promise<void> {
  store.value = next
  emit()
  // Written after the in-memory update so a storage failure — private browsing, exhausted
  // quota — still leaves the UI responsive for the session. It degrades to "not saved",
  // never to "the click did nothing" (CLAUDE.md § Errors).
  await safely(async () => {
    const db = await getDb()
    await db.put(COLLECTION, [...next].sort((a, b) => a.localeCompare(b)), store.key)
  }, undefined)
}

export function getOwned(): ReadonlySet<string> {
  return ownedSet.value
}

export function getTracked(): ReadonlySet<string> {
  return trackedSet.value
}

/** The server has no collection, and neither does the client until IDB answers. Both must
 *  render the same thing or React reports a hydration mismatch on every page with a toggle. */
export function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY
}

export function isLoaded(): boolean {
  return loaded
}

/** Read both sets into memory. Safe to call repeatedly; only the first does work. */
export async function hydrate(): Promise<void> {
  if (loaded) return
  const stored = await safely(async () => {
    const db = await getDb()
    return {
      owned: (await db.get(COLLECTION, OWNED_KEY)) as unknown,
      tracked: (await db.get(COLLECTION, TRACKED_KEY)) as unknown,
    }
  }, undefined)

  loaded = true
  // Only replace a snapshot if there is something to say, so a hydrate that finds an empty
  // collection does not hand every subscriber a new-but-equal Set.
  const owned = normalizeIds(stored?.owned)
  if (owned.length > 0) ownedSet.value = new Set(owned)
  const tracked = normalizeIds(stored?.tracked)
  if (tracked.length > 0) trackedSet.value = new Set(tracked)
  emit()
}

export async function setOwned(itemId: string, isOwned: boolean): Promise<void> {
  const next = new Set(ownedSet.value)
  if (isOwned) next.add(itemId)
  else next.delete(itemId)
  await persist(ownedSet, next)
}

export async function setTracked(itemId: string, isTracked: boolean): Promise<void> {
  const next = new Set(trackedSet.value)
  if (isTracked) next.add(itemId)
  else next.delete(itemId)
  await persist(trackedSet, next)
}

export async function clearAll(): Promise<void> {
  await persist(ownedSet, new Set())
  await persist(trackedSet, new Set())
}

export async function replaceAll(file: CollectionData): Promise<void> {
  await persist(ownedSet, new Set(file.owned))
  await persist(trackedSet, new Set(file.tracked))
}

export async function mergeIn(file: CollectionData): Promise<void> {
  await persist(ownedSet, new Set([...ownedSet.value, ...file.owned]))
  await persist(trackedSet, new Set([...trackedSet.value, ...file.tracked]))
}

export interface CollectionData {
  owned: string[]
  tracked: string[]
}

/**
 * The export envelope. Versioned from the start: this file is the user's only backup, and a
 * format change later must be able to tell what it is reading.
 *
 * Version 3 added `settings`. Settings ride in the same file rather than a second one because
 * they are the same kind of thing — work the user did that exists in one browser — and a
 * backup that restored the collection but not the theme, the mastery rank and the modes would
 * be restoring half of what they set up.
 */
export interface CollectionExport extends CollectionData {
  format: 'provenance-collection'
  /**
   * 1 had no `tracked`, 2 had no `settings`. Both still import: an older file simply tracks
   * nothing and leaves the current preferences alone.
   */
  version: 3
  exportedAt: string
  settings: Settings
}

export function toExport(
  data: CollectionData,
  now: string,
  settings: Settings = DEFAULT_SETTINGS,
): CollectionExport {
  const sorted = (ids: readonly string[]): string[] =>
    [...ids].sort((a, b) => a.localeCompare(b))
  return {
    format: 'provenance-collection',
    version: 3,
    exportedAt: now,
    owned: sorted(data.owned),
    tracked: sorted(data.tracked),
    settings,
  }
}

/**
 * Settings out of an imported file, or undefined when the file predates them.
 *
 * Undefined and "defaults" are deliberately different: a version 2 file says nothing about
 * preferences, and importing one must LEAVE the viewer's current theme alone rather than
 * silently resetting it to Orokin.
 */
export function importedSettings(input: unknown): Settings | undefined {
  if (typeof input !== 'object' || input === null || !('settings' in input)) return undefined
  const raw = input.settings
  if (typeof raw !== 'object' || raw === null) return undefined
  return normalizeSettings(raw)
}

/**
 * Read an exported file back.
 *
 * Deliberately lenient about everything except the shape of the id lists: an import that
 * rejects a file the user cannot repair has destroyed their backup for them. Unknown fields
 * are ignored and a newer `version` is still read, because the lists are the payload and
 * they are lists of strings in every version there will ever be.
 *
 * A bare array is accepted as the owned list, which is what a version 1 file's `owned` field
 * held and what a user hand-editing one is most likely to produce.
 */
export function normalizeIds(input: unknown): string[] {
  const raw =
    Array.isArray(input) ? input
    : typeof input === 'object' && input !== null && 'owned' in input ? input.owned
    : undefined

  if (!Array.isArray(raw)) return []
  return [
    ...new Set(raw.filter((entry): entry is string => typeof entry === 'string' && entry !== '')),
  ]
}

/** Both lists out of an imported file. Version 1 files yield an empty `tracked`. */
export function normalizeImport(input: unknown): CollectionData {
  const tracked =
    typeof input === 'object' && input !== null && 'tracked' in input
      ? normalizeIds(input.tracked)
      : []
  return { owned: normalizeIds(input), tracked }
}
