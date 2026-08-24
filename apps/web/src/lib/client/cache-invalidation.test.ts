import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The cache is keyed on the manifest hash, so the hash is load-bearing: if it is ever
 * `undefined`, every stored chunk is written under `undefined` and every subsequent
 * lookup MATCHES it. The result is a cache that reports a hit forever and never fetches
 * a new build again — silent, permanent staleness that looks perfectly healthy.
 *
 * That is why the client boundary Zod-parses rather than casting. These tests pin both
 * halves: a malformed manifest must fail loudly, and a well-formed one must still
 * invalidate when the hash changes.
 */

// In-memory stand-in for IndexedDB so the real store.ts runs unmodified.
const table = new Map<string, unknown>()
vi.mock('idb', () => ({
  openDB: () =>
    Promise.resolve({
      get: (_store: string, key: string) => Promise.resolve(table.get(key)),
      put: (_store: string, value: unknown, key: string) => {
        table.set(key, value)
        return Promise.resolve()
      },
      transaction: () => ({
        store: {
          getAllKeys: () => Promise.resolve([...table.keys()]),
          get: (key: string) => Promise.resolve(table.get(key)),
          delete: (key: string) => {
            table.delete(key)
            return Promise.resolve()
          },
        },
        done: Promise.resolve(),
      }),
      objectStoreNames: { contains: () => true },
      createObjectStore: () => undefined,
    }),
}))

const { loadDataset } = await import('./dataset')

const ITEMS_V1 = [{ id: 'a', name: 'Old Item', category: 'Resource', tradable: false }]
const ITEMS_V2 = [{ id: 'b', name: 'New Item from daily rebuild', category: 'Resource', tradable: false }]

function stub(manifest: unknown, items: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(url === '/data/manifest.json' ? manifest : items),
      }),
    ),
  )
}

const manifestWithout = (hash: unknown, file: string) => ({
  ...(hash === undefined ? {} : { hash }),
  builtAt: '2026-08-22T00:00:00.000Z',
  files: { items: file },
  upstream: {},
  attributions: [],
  counts: { items: 1, sources: 0, edges: 0 },
})

beforeEach(() => {
  table.clear()
  vi.unstubAllGlobals()
})

describe('cache invalidation', () => {
  it('rejects a manifest with no hash instead of caching under undefined', async () => {
    stub(manifestWithout(undefined, 'items.v1.json'), ITEMS_V1)
    // Failing here surfaces as "search unavailable", which is honest. Accepting it would
    // pin the cache on `undefined` and serve v1 forever.
    await expect(loadDataset()).rejects.toThrow()
    expect(table.get('items')).toBeUndefined()
  })

  it('rejects a manifest whose hash is the wrong type', async () => {
    stub(manifestWithout(12345, 'items.v1.json'), ITEMS_V1)
    await expect(loadDataset()).rejects.toThrow()
  })

  it('still serves a new build when the hash changes', async () => {
    const good = (hash: string, file: string) => manifestWithout(hash, file)

    stub(good('h1', 'items.h1.json'), ITEMS_V1)
    const first = await loadDataset()
    expect(first.items).toEqual(ITEMS_V1)
    await new Promise((resolve) => setTimeout(resolve, 0)) // let the write land

    stub(good('h2', 'items.h2.json'), ITEMS_V2)
    const second = await loadDataset()
    expect(second.items).toEqual(ITEMS_V2)
  })

  it('serves from cache without refetching when the hash is unchanged', async () => {
    stub(manifestWithout('h1', 'items.h1.json'), ITEMS_V1)
    await loadDataset()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const refetch = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            url === '/data/manifest.json' ? manifestWithout('h1', 'items.h1.json') : ITEMS_V2,
          ),
      }),
    )
    vi.stubGlobal('fetch', refetch)

    const second = await loadDataset()
    expect(second.items).toEqual(ITEMS_V1)
    expect(refetch.mock.calls.map((call) => call[0])).toEqual(['/data/manifest.json'])
  })
})
