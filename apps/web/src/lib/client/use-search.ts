'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { QueryError, QueryItem } from '@provenance/core'

import { loadBrowseDataset, loadDataset, loadPrices } from './dataset'
import { createSearchIndex, type SearchHit, type SearchIndex } from '@/lib/search-index'
import { buildItemOnlyIndex, buildQueryItems, indexById } from '@/lib/query-index'
import { runPaletteQuery } from '@/lib/search-query'

export type SearchStatus = 'loading' | 'ready' | 'failed'

/**
 * Wires the palette to the search index and the query language.
 *
 * DESIGN.md § 6 puts index building in a Comlink worker. Measured against the real dataset,
 * 4,834 items at the time, that is not worth its cost — the figures below are that one run,
 * not a live count:
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
 *
 * ---
 *
 * Two indexes, loaded in two stages. The palette boots on the 1.1 MB item chunk alone, which
 * answers every intrinsic key — `cat:`, `mr:`, `is:prime`, `has:market`. A query that asks
 * about drop PATHS (`from:relic`, `planet:earth`, `chance:>5`) needs the 3.9 MB edge chunk,
 * which is fetched the first time one is typed and not before: loading it up front to power a
 * search box would blow the two-second cold-load budget for nothing, and answering those keys
 * from an index that lacks them would be a filter that lies.
 */
export function useSearch() {
  const [status, setStatus] = useState<SearchStatus>('loading')
  const [results, setResults] = useState<SearchHit[]>([])
  // Matches BEFORE the row cap, so the palette can admit when it is showing a subset.
  const [total, setTotal] = useState(0)
  const [count, setCount] = useState(0)
  const [errors, setErrors] = useState<readonly QueryError[]>([])
  /** True while the edge chunk is on its way for a path query. */
  const [loadingPaths, setLoadingPaths] = useState(false)

  const indexRef = useRef<SearchIndex | undefined>(undefined)
  const itemsRef = useRef<ReadonlyMap<string, QueryItem>>(new Map())
  /** Set once the path facts are rolled up, so the upgrade happens at most once. */
  const hasPathsRef = useRef(false)
  const upgradingRef = useRef(false)
  const latestQuery = useRef('')

  const apply = useCallback((query: string) => {
    const index = indexRef.current
    if (index === undefined) return

    const found = runPaletteQuery(query, index, itemsRef.current)
    setResults(found.hits)
    setTotal(found.total)
    setErrors(found.errors)
    return found
  }, [])

  useEffect(() => {
    let cancelled = false

    async function boot(): Promise<void> {
      try {
        const { items } = await loadDataset()
        if (cancelled) return

        const index = createSearchIndex(items)
        indexRef.current = index
        itemsRef.current = indexById(buildItemOnlyIndex(items))
        setCount(index.size)
        setStatus('ready')

        // The palette accepts typing before the index exists; flush whatever was typed
        // while it was loading (DESIGN.md § 6). A search box that swallows your first
        // keystrokes feels broken even when it is merely early.
        if (latestQuery.current !== '') apply(latestQuery.current)
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
  }, [apply])

  /** Fetch and roll up the drop paths, once, on the first query that needs them. */
  const upgrade = useCallback(async (): Promise<void> => {
    if (hasPathsRef.current || upgradingRef.current) return
    upgradingRef.current = true
    setLoadingPaths(true)
    try {
      const [{ items, sources, edges }, prices] = await Promise.all([
        loadBrowseDataset(),
        loadPrices(),
      ])
      itemsRef.current = indexById(buildQueryItems(items, sources, edges, prices))
      hasPathsRef.current = true
      apply(latestQuery.current)
    } catch {
      // Leave the item-only index in place. The intrinsic half of the language keeps working,
      // and the path half returns nothing — which the caller reports rather than hides.
    } finally {
      upgradingRef.current = false
      setLoadingPaths(false)
    }
  }, [apply])

  const search = useCallback(
    (query: string) => {
      latestQuery.current = query

      if (query.trim() === '') {
        setResults([])
        setTotal(0)
        setErrors([])
        return
      }

      const found = apply(query)
      if (found?.needsPaths === true && !hasPathsRef.current) void upgrade()
    },
    [apply, upgrade],
  )

  return { status, results, total, search, count, errors, loadingPaths }
}
