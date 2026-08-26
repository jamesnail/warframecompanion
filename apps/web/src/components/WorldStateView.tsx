'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { Panel, PanelHeader } from '@/components/Primitives'
import { fetchWorldState } from '@/lib/client/world-state'
import {
  factionActivity,
  groupFissuresByTier,
  isStale,
  nodeToSourceId,
  openFissures,
  payloadAgeMinutes,
  timeUntil,
  traderIsHere,
  type WorldState,
} from '@/lib/world'

/**
 * Live world state.
 *
 * A client island inside a prerendered shell, like /browse and /rivens. The difference is
 * that this one has nothing useful to render before its fetch lands — the whole page IS the
 * live data — so it says so plainly rather than showing an empty frame.
 *
 * Re-fetched every 60 seconds and whenever the tab regains focus. Cheap, because the payload
 * is 184 KB behind a two-minute upstream cache, and necessary, because half the things on
 * this page expire while you are reading it.
 */

const REFRESH_MS = 60_000

type Status = 'loading' | 'ready' | 'failed'

export function WorldStateView({ missionIds }: { missionIds: string[] }) {
  // Passed from the server rather than derived, because "does this node have a page" is a
  // build-time fact and the alternative is guessing. 435 ids, ~12 KB — cheaper than the
  // 404s the guess produced.
  const known = useMemo(() => new Set(missionIds), [missionIds])
  const [state, setState] = useState<WorldState | undefined>(undefined)
  const [status, setStatus] = useState<Status>('loading')
  const [now, setNow] = useState<number | undefined>(undefined)

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const next = await fetchWorldState(signal)
      setState(next)
      setStatus('ready')
      setNow(Date.now())
    } catch {
      // Only a first failure is fatal to the view; a later one keeps the last good data,
      // which is more useful than blanking a page the reader is already using.
      setStatus((current) => (current === 'ready' ? 'ready' : 'failed'))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)

    const refresh = setInterval(() => void load(), REFRESH_MS)
    // Countdowns tick locally so they stay honest between refreshes.
    const tick = setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    const onFocus = (): void => void load()
    window.addEventListener('focus', onFocus)

    return () => {
      controller.abort()
      clearInterval(refresh)
      clearInterval(tick)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  if (status === 'loading') {
    return <p className="label mt-8">Loading world state…</p>
  }

  if (status === 'failed' || state === undefined) {
    return (
      <Panel className="mt-8">
        <div className="px-3 py-4 sm:px-5">
          <p className="text-sm text-text">World state is unavailable right now.</p>
          <p className="mt-1 max-w-prose text-sm text-text-dim">
            This is the only part of the site that needs a live connection. Everything else —
            drop tables, relics, rivens — is served from this site and still works.
          </p>
          <button
            type="button"
            onClick={() => {
              setStatus('loading')
              void load()
            }}
            className="chamfer-sm mt-3 border border-hairline px-3 py-1.5 text-sm text-text-dim transition-colors hover:border-hairline-strong hover:text-text"
          >
            Try again
          </button>
        </div>
      </Panel>
    )
  }

  const clock = now ?? Date.now()

  /**
   * A frozen feed is not the same as a quiet one.
   *
   * Upstream stopped publishing for six hours with its own timestamp stuck at a single value.
   * By then every fissure, the sortie and every open-world cycle had expired, so the page
   * rendered as a wall of "expired" — which reads as this site's bug and tells the reader
   * nothing true. Say what actually happened instead of presenting dead timers as current.
   */
  if (isStale(state.timestamp, clock)) {
    return (
      <Stale
        timestamp={state.timestamp}
        now={clock}
        onRetry={() => {
          void load()
        }}
      />
    )
  }

  const live = openFissures(state.fissures, clock)
  const factions = factionActivity({ ...state, fissures: live })
  const tiers = groupFissuresByTier(live)
  const age = payloadAgeMinutes(state.timestamp, clock)
  const baroHere = traderIsHere(state.voidTrader, clock)

  return (
    <div>
      {/* What each faction is doing, which is what replaced a static Factions surface:
          node ownership is published for about half the star chart, but activity is complete. */}
      {factions.length > 0 && (
        <Panel className="mt-8">
          <PanelHeader title="Faction activity" aside="right now" />
          <ul className="flex flex-wrap gap-x-8 gap-y-3 px-3 py-4 sm:px-5">
            {factions.map((entry) => (
              <li key={entry.faction}>
                <div className="text-sm text-text">{entry.faction}</div>
                <div className="data-num mt-0.5 text-xs text-text-faint">
                  {entry.fissures > 0 &&
                    `${String(entry.fissures)} ${entry.fissures === 1 ? 'fissure' : 'fissures'}`}
                  {entry.fissures > 0 && entry.invasions > 0 && ' · '}
                  {entry.invasions > 0 &&
                    `${String(entry.invasions)} ${entry.invasions === 1 ? 'invasion' : 'invasions'}`}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {tiers.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader
            title="Void fissures"
            aside={`${String(live.length)} open · soonest first`}
          />
          {tiers.map((group) => (
            <div key={group.tier} className="border-b border-hairline/50 last:border-0">
              <div className="flex items-baseline justify-between gap-3 px-3 pt-3 sm:px-5">
                {/* The tier is the point: an open Lith fissure is how you crack Lith relics. */}
                <Link
                  href={`/browse?q=${encodeURIComponent(group.tier)}&category=Relic`}
                  className="font-display text-sm font-semibold text-text transition-colors hover:text-orokin"
                >
                  {group.tier}
                </Link>
                <span className="label">{group.fissures.length}</span>
              </div>
              <ul className="px-3 pb-3 pt-1 sm:px-5">
                {group.fissures.map((fissure) => (
                  <li
                    key={fissure.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5 text-sm"
                  >
                    <span className="min-w-0">
                      <NodeLink node={fissure.node} known={known} />
                      <span className="ml-2 text-xs text-text-faint">
                        {[
                          fissure.missionType,
                          fissure.enemy,
                          fissure.isHard === true ? 'Steel Path' : undefined,
                          fissure.isStorm === true ? 'Railjack' : undefined,
                        ]
                          .filter((part) => part !== undefined)
                          .join(' · ')}
                      </span>
                    </span>
                    <Expiry expiry={fissure.expiry} now={clock} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Panel>
      )}

      {state.invasions.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader title="Invasions" aside={String(state.invasions.length)} />
          <ul>
            {state.invasions.map((invasion) => {
              const rewards = [
                ...(invasion.attacker?.reward?.countedItems ?? []),
                ...(invasion.defender?.reward?.countedItems ?? []),
              ]
              return (
                <li
                  key={invasion.id}
                  className="border-b border-hairline/50 px-3 py-3 last:border-0 sm:px-5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <NodeLink node={invasion.node} known={known} />
                    <span className="text-xs text-text-faint">
                      {invasion.attacker?.faction ?? '?'} vs {invasion.defender?.faction ?? '?'}
                    </span>
                  </div>
                  {rewards.length > 0 && (
                    <p className="mt-1 text-xs text-text-dim">
                      {rewards.map((reward, index) => (
                        <span key={`${reward.type}-${String(index)}`}>
                          {index > 0 && ' · '}
                          <RewardName name={reward.type} count={reward.count} />
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        {(state.sortie !== undefined || state.archonHunt !== undefined) && (
          <Panel className="min-w-0">
            <PanelHeader title="Today" aside="sortie & archon hunt" />
            <div className="space-y-4 px-3 py-4 sm:px-5">
              {state.sortie !== undefined && (
                <div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="text-sm text-text">
                      Sortie — {state.sortie.faction ?? 'Unknown'}
                      {state.sortie.boss !== undefined && `, ${state.sortie.boss}`}
                    </span>
                    <Expiry expiry={state.sortie.expiry} now={clock} />
                  </div>
                  <ul className="mt-1.5">
                    {(state.sortie.variants ?? []).map((variant, index) => (
                      <li key={index} className="py-0.5 text-xs text-text-faint">
                        {variant.node !== undefined && <NodeLink node={variant.node} known={known} small />}
                        {variant.missionType !== undefined && ` · ${variant.missionType}`}
                        {variant.modifier !== undefined && ` · ${variant.modifier}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {state.archonHunt !== undefined && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-hairline/50 pt-3">
                  <span className="text-sm text-text">
                    Archon Hunt — {state.archonHunt.faction ?? 'Unknown'}
                    {state.archonHunt.boss !== undefined && `, ${state.archonHunt.boss}`}
                  </span>
                  <Expiry expiry={state.archonHunt.expiry} now={clock} />
                </div>
              )}
            </div>
          </Panel>
        )}

        <div className="min-w-0 space-y-6">
          {state.voidTrader !== undefined && (
            <Panel>
              <PanelHeader
                title={state.voidTrader.character ?? 'Void Trader'}
                aside={baroHere ? 'here now' : 'away'}
              />
              <div className="px-3 py-4 sm:px-5">
                {baroHere ? (
                  <>
                    <p className="text-sm text-text">
                      At {state.voidTrader.location ?? 'a relay'}.
                    </p>
                    <p className="mt-0.5 text-xs text-text-faint">
                      Leaves in <Expiry expiry={state.voidTrader.expiry} now={clock} inline />
                    </p>
                    {(state.voidTrader.inventory ?? []).length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {(state.voidTrader.inventory ?? []).map((entry) => (
                          <li
                            key={entry.item}
                            className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm"
                          >
                            <RewardName name={entry.item} />
                            <span className="data-num text-xs text-text-faint">
                              {entry.ducats !== undefined && `${String(entry.ducats)} ducats`}
                              {entry.ducats !== undefined && entry.credits !== undefined && ' + '}
                              {entry.credits !== undefined &&
                                `${entry.credits.toLocaleString()} cr`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-text-dim">
                    Next at {state.voidTrader.location ?? 'a relay'} in{' '}
                    <Expiry expiry={state.voidTrader.activation} now={clock} inline />.
                  </p>
                )}
              </div>
            </Panel>
          )}

          {state.cycles.length > 0 && (
            <Panel>
              <PanelHeader title="Cycles" aside="open worlds" />
              <ul className="px-3 py-3 sm:px-5">
                {state.cycles.map((cycle) => (
                  <li
                    key={cycle.label}
                    className="flex items-baseline justify-between gap-4 py-1 text-sm"
                  >
                    <span className="text-text-dim">{cycle.label}</span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-text capitalize">{cycle.state}</span>
                      <Expiry expiry={cycle.expiry} now={clock} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <p className="mt-6 text-xs text-text-faint" role="status" aria-live="polite">
        {state.timestamp === undefined
          ? 'Live from the Warframe world state. Refreshes every minute.'
          : `Live from the Warframe world state, generated ${new Date(state.timestamp).toLocaleTimeString()}${age !== undefined && age >= 5 ? ` — ${String(age)} minutes ago` : ''}. Refreshes every minute. Expired fissures are hidden.`}
      </p>
    </div>
  )
}

/**
 * What the page says when the feed has stopped rather than gone quiet.
 *
 * Deliberately shows nothing else. Every section on this page is time-sensitive, so there is
 * no honest half-measure: a stale fissure list is not "mostly right", it is a list of things
 * that are over.
 */
function Stale({
  timestamp,
  now,
  onRetry,
}: {
  timestamp: string | undefined
  now: number
  onRetry: () => void
}) {
  const age = payloadAgeMinutes(timestamp, now)
  const hours = age === undefined ? undefined : Math.floor(age / 60)
  const label =
    age === undefined
      ? 'some time ago'
      : hours !== undefined && hours >= 1
        ? `${String(hours)} hour${hours === 1 ? '' : 's'} ago`
        : `${String(age)} minutes ago`

  return (
    <Panel className="mt-8">
      <PanelHeader title="World state is not updating" aside="upstream" />
      <div className="px-3 py-4 sm:px-5">
        <p className="max-w-prose text-sm text-text-dim">
          The Warframe world state feed last published <span className="text-text">{label}</span>,
          so everything in it — fissures, the sortie, open-world cycles — has already expired.
        </p>
        <p className="mt-2 max-w-prose text-sm text-text-dim">
          Nothing else here depends on it. Drop tables, relics and rivens are served from this
          site and are unaffected.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="chamfer-sm mt-3 border border-hairline px-3 py-1.5 text-sm text-text-dim transition-colors hover:border-hairline-strong hover:text-text"
        >
          Check again
        </button>
      </div>
    </Panel>
  )
}

/**
  * A node links to its source page only when that page exists — about 85% do.
  *
  * The rest are real mission nodes with no unique drops, so the drop tables never mention
  * them and this site has no page for them. Parsing the label is not enough to know that:
  * an early version linked on a successful parse alone and produced 404s for Eurasia,
  * Telesto and Ker, which an end-to-end check caught by fetching the links it rendered.
  */
function NodeLink({ node, known, small = false }: { node: string; known: ReadonlySet<string>; small?: boolean }) {
  const sourceId = nodeToSourceId(node)
  const className = small ? 'text-text-faint' : 'text-text'
  if (sourceId === undefined || !known.has(sourceId)) return <span className={className}>{node}</span>
  const [kind, rest] = [sourceId.slice(0, sourceId.indexOf(':')), sourceId.slice(sourceId.indexOf(':') + 1)]
  return (
    <Link
      href={`/source/${kind}/${rest.split('/').map(encodeURIComponent).join('/')}`}
      className={`${className} transition-colors hover:text-orokin`}
    >
      {node}
    </Link>
  )
}

/**
 * Reward names are text, not links.
 *
 * Tempting to slug the name and link to /item, and 13 of 15 would work — but the two that
 * fail are not an edge case: Dera Vandal and Twin Vipers Wraith parts come ONLY from
 * invasions, so they are absent from the drop tables by definition, and Baro sells things
 * that drop nowhere at all. These names arrive at runtime, so nothing here can check whether
 * the target exists, and a link that 404s is worse than a name the reader can search for.
 */
function RewardName({ name, count }: { name: string; count?: number }) {
  return <span>{count !== undefined && count > 1 ? `${String(count)}× ${name}` : name}</span>
}

function Expiry({
  expiry,
  now,
  inline = false,
}: {
  expiry: string | undefined
  now: number
  inline?: boolean
}) {
  const left = timeUntil(expiry, now)
  if (left === undefined) return null
  if (inline) return <span className="data-num">{left}</span>
  return (
    <span className={`data-num shrink-0 text-xs ${left === 'expired' ? 'text-text-faint' : 'text-text-dim'}`}>
      {left}
    </span>
  )
}
