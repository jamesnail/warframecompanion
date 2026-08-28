import { attemptNoun, type AttemptNoun } from './attempts'
import type { Refinement, RelicRarity } from './types'
import { perRunChance, runsForRelicPath } from './probability'
import type { DropEdge } from './types'

/**
 * The drop chain: item ← relic ← the mission you actually queue.
 *
 * DESIGN.md § 8 calls this the signature element, and § 11 calls phase 5 "the one that
 * matters". The probability engine for it (`composeThroughRelic`, `runsForRelicPath`,
 * `shareChance`) shipped with phase 5 and then sat unused by any surface for a month — the
 * item page showed which relics hold a part and what each refinement pays, and stopped
 * there, leaving the reader to click into a relic and do the multiplication themselves.
 *
 * This module is the missing half: the shape of a whole route, and the rules for ranking
 * routes against each other. It stays pure — no graph traversal, no I/O. Callers resolve
 * the graph and hand the numbers in.
 */

export interface ChainRelic {
  id: string
  name: string
  /** "Lith", "Meso", "Neo", "Axi", "Requiem"… — matched against open fissures. */
  tier: string
  rarity: RelicRarity
  vaulted: boolean
  /** The refinement that maximises this rarity's odds — not always Radiant. */
  refinement: Refinement
  /** Chance this relic pays the item, at `refinement`. */
  chance: number
}

export interface ChainSource {
  id: string
  name: string
  kind: string
  /** Per-run chance this source drops the next link — the relic, or the item when direct. */
  chance: number
  /** Present only where the site has a page for it; a chain must never invent a link. */
  href: string | undefined
}

export interface DropChain {
  itemId: string
  itemName: string
  /** Absent when the item drops directly. */
  relic: ChainRelic | undefined
  /** Absent when nothing known drops the item, or the relic, at all. */
  source: ChainSource | undefined
  /** Expected mission runs for one copy, solo. Infinity where no route exists. */
  runs: number
}

/**
 * What one attempt at a chain is called.
 *
 * A direct chain takes its source's noun — kill an enemy, run a mission. A relic chain does
 * NOT, even when an enemy drops the relic: `chainRuns` there is a composite of farming the
 * relic and then cracking it at a fissure, and the fissure is a mission you queue. Calling
 * that total "kills" would name half of it. "Runs" names the act the number ends on.
 */
export function chainNoun(chain: DropChain): AttemptNoun {
  return chain.relic === undefined ? attemptNoun(chain.source?.kind) : attemptNoun('mission')
}

/**
 * How actionable a chain is right now.
 *
 * - `now` — a fissure of this relic's tier is open, so the route is available this minute
 *   and will not be later. This is the only status that expires.
 * - `ready` — farmable whenever: a direct drop, or a relic in rotation with no fissure open
 *   for its tier at the moment.
 * - `blocked` — vaulted, or no known source. Nothing to do but trade.
 */
export type ChainStatus = 'now' | 'ready' | 'blocked'

export const CHAIN_STATUS_ORDER: readonly ChainStatus[] = ['now', 'ready', 'blocked']

export function chainStatus(chain: DropChain, openTiers: ReadonlySet<string>): ChainStatus {
  if (chain.source === undefined) return 'blocked'
  if (chain.relic === undefined) return 'ready'
  if (chain.relic.vaulted) return 'blocked'
  return openTiers.has(chain.relic.tier) ? 'now' : 'ready'
}

/**
 * Expected runs at a given squad size.
 *
 * Only the relic hop benefits from a share — each player opens their own relic and the squad
 * takes the best reward — so a direct drop returns the same number for any squad size rather
 * than pretending four people farming together quarters your personal run count.
 */
export function chainRuns(chain: DropChain, players: number): number {
  if (chain.source === undefined) return Number.POSITIVE_INFINITY
  if (chain.relic === undefined) {
    return chain.source.chance > 0 ? 1 / chain.source.chance : Number.POSITIVE_INFINITY
  }
  return runsForRelicPath(chain.source.chance, chain.relic.chance, players)
}

/**
 * Ranking: what to do first.
 *
 * Status leads, because an open fissure is the only thing here with a deadline — a route
 * that is 20% cheaper but available all week loses to one that closes in forty minutes.
 * Cost breaks ties, and the name breaks those, so the order is total and a re-render cannot
 * reshuffle equal rows.
 */
export function compareChains(
  a: { chain: DropChain; status: ChainStatus; runs: number },
  b: { chain: DropChain; status: ChainStatus; runs: number },
): number {
  const byStatus =
    CHAIN_STATUS_ORDER.indexOf(a.status) - CHAIN_STATUS_ORDER.indexOf(b.status)
  if (byStatus !== 0) return byStatus
  if (a.runs !== b.runs) return a.runs - b.runs
  return a.chain.itemName.localeCompare(b.chain.itemName)
}

/**
 * The cheapest route to an item, given every edge that yields it and every edge that yields
 * the relics holding it.
 *
 * "Cheapest" is expected solo runs, which is the only unit that compares a direct drop to a
 * relic chain at all. Squad size is deliberately not a parameter here: it changes which
 * chain is cheapest only in degenerate cases, and recomputing the whole graph per squad size
 * would make the item page's build cost four times what it needs to be. The chosen chain is
 * re-costed for the reader's squad size at render time by `chainRuns`.
 */
export function bestChain(
  itemId: string,
  itemName: string,
  candidates: readonly {
    relic: ChainRelic | undefined
    /** Edges that drop the relic — or the item itself, for a direct candidate. */
    source: ChainSource | undefined
  }[],
): DropChain {
  let best: DropChain | undefined
  for (const candidate of candidates) {
    const chain: DropChain = {
      itemId,
      itemName,
      relic: candidate.relic,
      source: candidate.source,
      runs: 0,
    }
    chain.runs = chainRuns(chain, 1)
    if (best === undefined || betterThan(chain, best)) best = chain
  }
  return best ?? { itemId, itemName, relic: undefined, source: undefined, runs: Number.POSITIVE_INFINITY }
}

/**
 * Farmable beats cheap.
 *
 * A vaulted relic is not a route — you cannot obtain the relic at all — so however good its
 * odds, it must never be presented as the best way to get something you could otherwise farm
 * today. Ranking on expected runs alone would do exactly that, and would do it most often on
 * prime parts, where the vaulted relics are usually the ones with the kind reward slot.
 */
function betterThan(candidate: DropChain, incumbent: DropChain): boolean {
  const candidateVaulted = candidate.relic?.vaulted === true
  const incumbentVaulted = incumbent.relic?.vaulted === true
  if (candidateVaulted !== incumbentVaulted) return !candidateVaulted
  return candidate.runs < incumbent.runs
}

/** The best per-run chance among the edges that drop something, with its edge. */
export function bestEdge(edges: readonly DropEdge[]): { edge: DropEdge; chance: number } | undefined {
  let best: { edge: DropEdge; chance: number } | undefined
  for (const edge of edges) {
    const chance = perRunChance(edge)
    if (best === undefined || chance > best.chance) best = { edge, chance }
  }
  return best
}
