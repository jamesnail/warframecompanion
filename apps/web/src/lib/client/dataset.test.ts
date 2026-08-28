import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadDataset } from './dataset'

/**
 * The boot sequence is where the caching logic actually lives: fetch the manifest, compare
 * its hash to what IndexedDB holds, and refetch only on a miss. Getting the comparison
 * backwards would either never cache or never update, and both look fine in a browser
 * until the daily rebuild lands.
 */

const readChunk = vi.hoisted(() => vi.fn())
const writeChunk = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)))
const pruneStale = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)))

vi.mock('./store', () => ({ readChunk, writeChunk, pruneStale }))

const MANIFEST = {
  hash: 'abc123',
  builtAt: '2026-08-22T00:00:00.000Z',
  files: { items: 'items.abc123.json' },
  upstream: {},
  attributions: [],
  counts: { items: 2, sources: 0, edges: 0 },
}

const ITEMS = [
  { id: 'forma-blueprint', name: 'Forma Blueprint', category: 'Blueprint', tradable: false },
  { id: 'orokin-cell', name: 'Orokin Cell', category: 'Resource', tradable: false },
]

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn((url: string) => {
    const body = routes[url]
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  readChunk.mockReset()
  writeChunk.mockClear()
  pruneStale.mockClear()
})

describe('loadDataset', () => {
  it('fetches the chunk on a cache miss and stores it under its FILENAME', async () => {
    readChunk.mockResolvedValue(undefined)
    const fetchMock = mockFetch({
      '/data/manifest.json': MANIFEST,
      '/data/items.abc123.json': ITEMS,
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadDataset()

    expect(result.items).toHaveLength(2)
    expect(result.manifest.hash).toBe('abc123')
    expect(fetchMock).toHaveBeenCalledWith('/data/items.abc123.json')
    // The filename, not the manifest hash: prices carry a hash of their own, so keying the
    // cache on the manifest hash would invalidate all 5 MB of drop data on every price tick.
    expect(writeChunk).toHaveBeenCalledWith('items', 'items.abc123.json', ITEMS)
  })

  it('uses the cache and does NOT refetch the chunk on a hit', async () => {
    readChunk.mockResolvedValue(ITEMS)
    const fetchMock = mockFetch({ '/data/manifest.json': MANIFEST })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadDataset()

    expect(result.items).toHaveLength(2)
    // The manifest is always fetched — it is how a new hash is discovered — but the
    // chunk must not be.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/data/manifest.json')
    expect(writeChunk).not.toHaveBeenCalled()
  })

  it('asks the store for the version the live manifest names, not a stored one', async () => {
    readChunk.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      mockFetch({ '/data/manifest.json': MANIFEST, '/data/items.abc123.json': ITEMS }),
    )

    await loadDataset()

    expect(readChunk).toHaveBeenCalledWith('items', 'items.abc123.json')
  })

  it('throws when the manifest cannot be fetched', async () => {
    readChunk.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', mockFetch({}))

    await expect(loadDataset()).rejects.toThrow(/manifest\.json/)
  })

  it('throws when the manifest names no items chunk', async () => {
    readChunk.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', mockFetch({ '/data/manifest.json': { ...MANIFEST, files: {} } }))

    await expect(loadDataset()).rejects.toThrow(/no items chunk/)
  })
})
