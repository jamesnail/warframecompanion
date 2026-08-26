'use client'

import { useEffect, useSyncExternalStore } from 'react'

import {
  getServerSnapshot,
  getSnapshot,
  hydrate,
  isLoaded,
  setOwned,
  subscribe,
} from './collection'

/**
 * Read the collection, and keep every mounted surface in step with it.
 *
 * useSyncExternalStore rather than useState + context: the recipe table and the header
 * progress read the same set, and a context provider would have to wrap a statically
 * prerendered tree just to share four booleans. The store is a module, so the two agree by
 * construction.
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
  owned: ReadonlySet<string>
  ready: boolean
  toggle: (itemId: string, next: boolean) => void
} {
  const owned = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const ready = useSyncExternalStore(subscribe, isLoaded, alwaysFalse)

  useEffect(() => {
    void hydrate()
  }, [])

  return {
    owned,
    ready,
    toggle: (itemId, next) => {
      void setOwned(itemId, next)
    },
  }
}

/** Hoisted so the server snapshot is referentially stable across renders. */
function alwaysFalse(): boolean {
  return false
}
