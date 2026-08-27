import { chainRuns, chainStatus, compareChains, type ChainStatus, type DropChain } from '@provenance/core'

/**
 * Turning a collection into a plan.
 *
 * The organising idea is that a plan lists ACTIONS, not items. A list of eleven missing
 * prime parts is a restatement of the collection page; what a player actually needs to know
 * is which single thing to queue next, and one queued thing usually serves several needs at
 * once — three of the parts you are missing may all sit behind Neo relics, and one Neo
 * fissure run counts toward all three.
 *
 * So needs are computed per item and then grouped by the action that advances them. The
 * ranking rules themselves live in `@provenance/core` and are shared with the item page's
 * trace, so the plan can never recommend a route the item page disagrees with.
 */

export interface TrackedSet {
  id: string
  name: string
  components: { itemId: string; count: number }[]
}

export interface Need {
  chain: DropChain
  status: ChainStatus
  /** Expected runs at the reader's squad size. */
  runs: number
  /** Names of the in-progress sets still waiting on this part. */
  wantedBy: string[]
}

export type ActionKind = 'fissure' | 'source' | 'blocked'

export interface FarmAction {
  key: string
  kind: ActionKind
  /** What to do: "Neo fissure", or the mission's own name. */
  title: string
  href: string | undefined
  needs: Need[]
  /** Cheapest need in the group — what the group sorts on. */
  runs: number
}

/**
 * Which sets count as "in progress".
 *
 * Owning at least one part and not all of them. A set you have never touched is not a plan,
 * it is the entire game; a finished set is done. This mirrors what /collection tracks, so
 * the two pages never disagree about what you are working on.
 */
export function inProgress(sets: readonly TrackedSet[], owned: ReadonlySet<string>): TrackedSet[] {
  return sets.filter((set) => {
    let have = 0
    for (const component of set.components) if (owned.has(component.itemId)) have++
    return have > 0 && have < set.components.length
  })
}

/**
 * Every part still needed across the sets in progress, costed and deduplicated.
 *
 * A part wanted by two different sets is one need, not two — you farm it once — but both
 * set names are kept, because "this also finishes Mesa Prime" is exactly the kind of thing
 * that decides what someone does next.
 */
export function buildNeeds(
  sets: readonly TrackedSet[],
  owned: ReadonlySet<string>,
  chains: Readonly<Record<string, DropChain>>,
  openTiers: ReadonlySet<string>,
  players = 1,
): Need[] {
  const byItem = new Map<string, Need>()

  for (const set of inProgress(sets, owned)) {
    for (const component of set.components) {
      if (owned.has(component.itemId)) continue

      const existing = byItem.get(component.itemId)
      if (existing !== undefined) {
        existing.wantedBy.push(set.name)
        continue
      }

      const chain = chains[component.itemId]
      if (chain === undefined) continue

      byItem.set(component.itemId, {
        chain,
        status: chainStatus(chain, openTiers),
        runs: chainRuns(chain, players),
        wantedBy: [set.name],
      })
    }
  }

  const needs = [...byItem.values()]
  for (const need of needs) need.wantedBy.sort((a, b) => a.localeCompare(b))
  needs.sort(compareChains)
  return needs
}

/**
 * Group needs into the actions that advance them.
 *
 * Three shapes, because the action genuinely differs:
 *
 *  - `fissure` — a fissure of this tier is open. The action is "run any open Neo fissure",
 *    so every need behind a Neo relic collapses into one card regardless of which relic.
 *  - `source` — no fissure open, so the action is farming the relic (or the item) from a
 *    specific mission, and the grouping key is that mission.
 *  - `blocked` — nothing to run. One group, because there is one thing to say about it.
 */
export function groupByAction(needs: readonly Need[]): FarmAction[] {
  const actions = new Map<string, FarmAction>()

  const push = (key: string, make: () => Omit<FarmAction, 'needs' | 'runs'>, need: Need): void => {
    const existing = actions.get(key)
    if (existing === undefined) {
      actions.set(key, { ...make(), needs: [need], runs: need.runs })
      return
    }
    existing.needs.push(need)
    if (need.runs < existing.runs) existing.runs = need.runs
  }

  for (const need of needs) {
    if (need.status === 'blocked') {
      push('blocked', () => ({ key: 'blocked', kind: 'blocked', title: 'Vaulted', href: undefined }), need)
      continue
    }

    if (need.status === 'now' && need.chain.relic !== undefined) {
      const tier = need.chain.relic.tier
      push(
        `fissure:${tier}`,
        () => ({ key: `fissure:${tier}`, kind: 'fissure', title: `${tier} fissure`, href: '/world' }),
        need,
      )
      continue
    }

    const source = need.chain.source
    const key = `source:${source?.id ?? 'unknown'}`
    push(
      key,
      () => ({
        key,
        kind: 'source',
        title: source?.name ?? 'Unknown source',
        href: source?.href,
      }),
      need,
    )
  }

  const ordered = [...actions.values()]
  for (const action of ordered) action.needs.sort(compareChains)

  // Fissures first — they expire. Then cheapest action. Blocked always last.
  const rank: Record<ActionKind, number> = { fissure: 0, source: 1, blocked: 2 }
  ordered.sort((a, b) => {
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind]
    if (a.runs !== b.runs) return a.runs - b.runs
    return a.title.localeCompare(b.title)
  })
  return ordered
}
