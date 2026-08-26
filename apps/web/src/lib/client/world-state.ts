import { parseWorldState, type NodeIndex, type WorldState } from '@/lib/world'

/**
 * The one runtime call this site makes to anything it does not host.
 *
 * Digital Extremes' own `worldState`, mirrored minutely by browse.wf, which sends
 * `access-control-allow-origin: *` — so this needs no proxy and leaves constraint 3's single
 * server-side escape hatch unspent. Everything about the drop graph still comes from
 * committed static files under /data.
 *
 * Taking DE's payload rather than a parsed summary is deliberate. The parsed mirror this
 * replaced (api.warframestat.us) froze for six hours with its own timestamp stuck, which took
 * the whole page down with it; a mirror of the source has one less thing between us and the
 * truth. Invasions come from a second endpoint on the same host because DE keeps them
 * elsewhere.
 *
 * Nothing is cached in IndexedDB. The chunk cache exists because content-addressed data is
 * immutable; world state is the opposite, and the upstream `max-age` is already the right
 * amount of caching.
 */
const WORLD_STATE = 'https://oracle.browse.wf/worldState.min.json'
const INVASIONS = 'https://oracle.browse.wf/invasions'

/** Long enough that a slow response gives up rather than leaving a spinner forever. */
const TIMEOUT_MS = 10_000

export async function fetchWorldState(index: NodeIndex, signal?: AbortSignal): Promise<WorldState> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])

  const [state, invasions] = await Promise.all([
    fetchJson(WORLD_STATE, combined),
    // Invasions are a nicety, not the page. Losing them must not lose the fissures.
    fetchJson(INVASIONS, combined).catch(() => undefined),
  ])

  // parseWorldState never throws; it discards what it cannot read, section by section.
  return parseWorldState(state, invasions, index)
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url} -> HTTP ${String(response.status)}`)
  return response.json()
}
