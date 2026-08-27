'use client'

import { useEffect, useSyncExternalStore } from 'react'

import {
  getOwned,
  getServerSnapshot,
  getTracked,
  hydrate,
  isLoaded,
  setOwned,
  setTracked,
  subscribe,
} from './collection'

/**
 * Read the collection, and keep every mounted surface in step with it.
 *
 * useSyncExternalStore rather than useState + context: several surfaces read the same sets,
 * and a context provider would have to wrap a statically prerendered tree just to share a
 * few booleans. The store is a module, so they agree by construction.
 *
 * `ready` is not cosmetic. Every page is prerendered with an empty collection, so a toggle
 * that rendered its real state immediately would flash unchecked on load; surfaces use this
 * to stay neutral until IndexedDB has actually answered.
 *
 * Readiness is read from the store rather than tracked here, because the store sets it
 * BEFORE it notifies. A local flag set in hydrate().then() would be assigned after the
 * notification that was supposed to publish it, and every subscriber would see it stale.
 */
export function useCollection(): {
  /** Parts in hand. */
  owned: ReadonlySet<string>
  /** Sets and items the player has said they are going for. Intent, not inventory. */
  tracked: ReadonlySet<string>
  ready: boolean
  toggle: (itemId: string, next: boolean) => void
  toggleTracked: (itemId: string, next: boolean) => void
} {
  const owned = useSyncExternalStore(subscribe, getOwned, getServerSnapshot)
  const tracked = useSyncExternalStore(subscribe, getTracked, getServerSnapshot)
  const ready = useSyncExternalStore(subscribe, isLoaded, alwaysFalse)

  useEffect(() => {
    void hydrate()
  }, [])

  return {
    owned,
    tracked,
    ready,
    toggle: (itemId, next) => {
      void setOwned(itemId, next)
    },
    toggleTracked: (itemId, next) => {
      void setTracked(itemId, next)
    },
  }
}

/** Hoisted so the server snapshot is referentially stable across renders. */
function alwaysFalse(): boolean {
  return false
}
