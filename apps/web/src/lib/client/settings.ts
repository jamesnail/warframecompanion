import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@provenance/core'

import { COLLECTION, getDb, safely } from './db'

/**
 * Viewer preferences, as an external store.
 *
 * Same shape as the collection store next door, for the same reason: several surfaces read
 * these at once and must never disagree about whether compact mode is on.
 *
 * ---
 *
 * TWO places, one record. IndexedDB is the store of record — that is what CLAUDE.md
 * constraint 1 requires and what the export reads. localStorage holds a MIRROR, and it exists
 * for exactly one job: theme, density and motion have to be on `<html>` before the first
 * paint, and IndexedDB cannot be read synchronously. A pre-paint script reading IDB is not a
 * thing that can exist, so the alternative is a flash of the wrong theme on every navigation.
 *
 * The mirror is never authoritative. On hydrate, IDB wins; if the two disagree — an import in
 * another tab, a mirror written by an older build — the mirror is rewritten from IDB. If
 * localStorage is unavailable (private browsing, blocked site data), everything still works
 * and the first paint is simply the default theme.
 */

const SETTINGS_KEY = 'settings'

/**
 * DO NOT RENAME, including if the product is renamed — same reason as `DB_NAME` in db.ts.
 *
 * It is duplicated as a string literal in the pre-paint script in `layout.tsx`, because that
 * script runs before any module loads and cannot import this. Changing one without the other
 * makes every reload flash the default theme, which is the exact failure the script exists to
 * prevent. If this ever has to change, change both.
 */
export const MIRROR_KEY = 'provenance:settings'

let current: Settings = DEFAULT_SETTINGS
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

export function getSettings(): Settings {
  return current
}

/** The server has no preferences, and neither does the client until IDB answers. Both must
 *  render the same thing or React reports a hydration mismatch on every page. */
export function getServerSnapshot(): Settings {
  return DEFAULT_SETTINGS
}

export function isLoaded(): boolean {
  return loaded
}

/**
 * The attributes the pre-paint script sets, kept here so the script and the store cannot
 * drift apart about what an attribute is called.
 */
export function applyToDocument(settings: Settings): void {
  const root = document.documentElement
  root.dataset.theme = settings.theme
  root.dataset.density = settings.density
  // Resolved, exactly as the pre-paint script resolves it: `system` means "ask the OS", and
  // choosing it back must not overrule a viewer whose OS asked for less movement.
  root.dataset.motion =
    settings.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'reduced'
      : 'system'
}

function writeMirror(settings: Settings): void {
  try {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(settings))
  } catch {
    // Blocked site data. The preference still applies for this session; it just will not
    // survive a reload without a flash, which is a degradation and not a failure.
  }
}

/** Read both stores, prefer IDB, and repair the mirror if it disagreed. */
export async function hydrate(): Promise<void> {
  if (loaded) return

  const stored = await safely(async () => {
    const db = await getDb()
    return (await db.get(COLLECTION, SETTINGS_KEY)) as unknown
  }, undefined)

  loaded = true
  if (stored !== undefined) {
    current = normalizeSettings(stored)
    applyToDocument(current)
    writeMirror(current)
  } else {
    // Nothing in IDB yet. Adopt whatever the pre-paint script already applied, so a viewer
    // whose IDB write failed still keeps their theme across reloads.
    const mirrored = readMirror()
    if (mirrored !== undefined) current = mirrored
  }
  emit()
}

export function readMirror(): Settings | undefined {
  try {
    const raw = window.localStorage.getItem(MIRROR_KEY)
    return raw === null ? undefined : normalizeSettings(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/**
 * Apply a change to one or more fields.
 *
 * The document and the mirror update first and the database after, so a storage failure
 * degrades to "not saved" rather than to "the click did nothing" (CLAUDE.md § Errors).
 */
export async function update(patch: Partial<Settings>): Promise<void> {
  current = { ...current, ...patch }
  applyToDocument(current)
  writeMirror(current)
  emit()

  await safely(async () => {
    const db = await getDb()
    await db.put(COLLECTION, current, SETTINGS_KEY)
  }, undefined)
}

/** Used by import, which replaces every field at once. */
export async function replaceSettings(settings: Settings): Promise<void> {
  await update(settings)
}

export async function resetSettings(): Promise<void> {
  await update(DEFAULT_SETTINGS)
}
