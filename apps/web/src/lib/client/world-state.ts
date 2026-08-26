import { parseWorldState, type WorldState } from '@/lib/world'

/**
 * The one runtime call this site makes to anything it does not host.
 *
 * WFCD's status API, not Digital Extremes'. It sends `access-control-allow-origin: *`, so
 * this needs no proxy and leaves constraint 3's single server-side escape hatch unspent.
 * Everything about the drop graph still comes from committed static files under /data.
 *
 * Nothing is cached in IndexedDB. The chunk cache exists because content-addressed data is
 * immutable; world state is the opposite — a cached fissure list is a wrong fissure list,
 * and the upstream `max-age=120` is already the right amount of caching.
 */
const ENDPOINT = 'https://api.warframestat.us/pc'

/** Long enough that a slow response gives up rather than leaving a spinner forever. */
const TIMEOUT_MS = 10_000

export async function fetchWorldState(signal?: AbortSignal): Promise<WorldState> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined =
    signal === undefined ? timeout : AbortSignal.any([signal, timeout])

  const response = await fetch(ENDPOINT, { signal: combined })
  if (!response.ok) throw new Error(`world state -> HTTP ${String(response.status)}`)
  // parseWorldState never throws; it discards what it cannot read, section by section.
  return parseWorldState(await response.json())
}
