'use client'

import { useEffect, useSyncExternalStore } from 'react'

import { DEFAULT_SETTINGS, type Settings } from '@provenance/core'

import {
  getServerSnapshot,
  getSettings,
  hydrate,
  isLoaded,
  resetSettings,
  subscribe,
  update,
} from './settings'

/**
 * Read the viewer's preferences, and keep every mounted surface in step with them.
 *
 * `ready` matters for the same reason it does on the collection: every page is prerendered
 * with the defaults, so a control that rendered its real state immediately would flash the
 * default and then correct itself. Theme, density and motion are exempt — the pre-paint
 * script has already put those on `<html>`, so they are right in the first frame and this
 * hook is only how the CONTROLS learn about them.
 */
export function useSettings(): {
  settings: Settings
  ready: boolean
  set: (patch: Partial<Settings>) => void
  reset: () => void
} {
  const settings = useSyncExternalStore(subscribe, getSettings, getServerSnapshot)
  const ready = useSyncExternalStore(subscribe, isLoaded, alwaysFalse)

  useEffect(() => {
    void hydrate()
  }, [])

  return {
    settings,
    ready,
    set: (patch) => {
      void update(patch)
    },
    reset: () => {
      void resetSettings()
    },
  }
}

/**
 * The subset that is safe to read before hydration, because the pre-paint script has already
 * applied it to the document. A surface that needs the density to size a virtualized row can
 * use this without waiting and without flashing.
 */
export function useAppliedSettings(): Settings {
  const settings = useSyncExternalStore(subscribe, getSettings, getServerSnapshot)
  useEffect(() => {
    void hydrate()
  }, [])
  return settings
}

/** Hoisted so the server snapshot is referentially stable across renders. */
function alwaysFalse(): boolean {
  return false
}

export { DEFAULT_SETTINGS }
