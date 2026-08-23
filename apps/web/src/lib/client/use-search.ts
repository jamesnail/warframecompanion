'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { loadDataset } from './dataset'
import { createSearchIndex, type SearchHit, type SearchIndex } from '@/lib/search-index'

export type SearchStatus = 'loading' | 'ready' | 'failed'

/**
 * Wires the palette to the search index.
 *
 * DESIGN.md § 6 puts index building in a Comlink worker. Measured against the real
 * dataset (4834 items) that is not worth its cost:
 *
 *     index build   5.94 ms   (once)
 *     search avg    0.157 ms  per query
 *     search worst  0.188 ms
 *
 * At a sixth of a millisecond per keystroke, moving this off the main thread saves nothing
 * observable even allowing an order of magnitude for a mid-range phone — it stays within a
 * tenth of one frame. Turbopack also declines to compile a .ts worker referenced through
 * `new Worker(new URL(...))`: it emits the raw TypeScript as a static asset, so the build
 * passes and search breaks only in production.
 *
 * createSearchIndex is deliberately pure and worker-ready. Revisit when /browse needs to
 * index the 30k edge list, or if search latency ever approaches a frame.
 */
export function useSearch() {
  const [status, setStatus] = useState<SearchStatus>('loading')
  const [results, setResults] = useState<SearchHit[]>([])
  const [count, setCount] = useState(0)

  const indexRef = useRef<SearchIndex | undefined>(undefined)
  const latestQuery = useRef('')

  useEffect(() => {
    let cancelled = false

    async function boot(): Promise<void> {
      try {
        const { items } = await loadDataset()
        if (cancelled) return

        const index = createSearchIndex(items)
        indexRef.current = index
        setCount(index.size)
        setStatus('ready')

        // The palette accepts typing before the index exists; flush whatever was typed
        // while it was loading (DESIGN.md § 6). A search box that swallows your first
        // keystrokes feels broken even when it is merely early.
        if (latestQuery.current !== '') setResults(index.search(latestQuery.current))
      } catch {
        // A missing dataset hides the palette's results; it must not blank the page
        // (CLAUDE.md § Errors).
        if (!cancelled) setStatus('failed')
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const search = useCallback((query: string) => {
    latestQuery.current = query

    if (query.trim() === '') {
      setResults([])
      return
    }

    const index = indexRef.current
    if (index === undefined) return // still loading; the flush above will catch up

    setResults(index.search(query))
  }, [])

  return { status, results, search, count }
}
