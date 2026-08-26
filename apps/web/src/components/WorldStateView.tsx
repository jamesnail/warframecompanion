'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

import { Panel, PanelHeader } from '@/components/Primitives'
import { fetchWorldState } from '@/lib/client/world-state'
import {
  factionActivity,
  groupFissuresByTier,
  isStale,
  openFissures,
  payloadAgeMinutes,
  timeUntil,
  traderIsHere,
  type NodeIndex,
  type SortieLike,
  type WorldState,
} from '@/lib/world'

/**
 * Live world state.
 *
 * A client island inside a prerendered shell, like /browse and /rivens. The difference is
 * that this one has nothing useful to render before its fetch lands — the whole page IS the
 * live data — so it says so plainly rather than showing an empty frame.
 *
 * Re-fetched every 60 seconds and whenever the tab regains focus, because half the things on
 * this page expire while you are reading it.
 */

const REFRESH_MS = 60_000

type Status = 'loading' | 'ready' | 'failed'

export function WorldStateView({ nodes }: { nodes: NodeIndex }) {
  const [state, setState] = useState<WorldState | undefined>(undefined)
  const [status, setStatus] = useState<Status>('loading')
  const [now, setNow] = useState<number | undefined>(undefined)

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const next = await fetchWorldState(nodes, signal)
        setState(next)
        setStatus('ready')
        setNow(Date.now())
      } catch {
        // Only a first failure is fatal to the view; a later one keeps the last good data,
        // which is more useful than blanking a page the reader is already using.
        setStatus((current) => (current === 'ready' ? 'ready' : 'failed'))
      }
    },
    [nodes],
  )

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

  if (status === 'loading') return <p className="label mt-8">Loading world state…</p>

  if (status === 'failed' || state === undefined) {
    return (
      <Notice
        title="World state is unavailable"
        onRetry={() => {
          setStatus('loading')
          void load()
        }}
      >
        <p className="text-sm text-text-dim">
          This is the only part of the site that needs a live connection. Everything else — drop
          tables, relics, rivens — is served from here and still works.
        </p>
      </Notice>
    )
  }

  const clock = now ?? Date.now()

  /**
   * A frozen feed is not the same as a quiet one.
   *
   * A previous upstream stopped publishing for six hours with its own timestamp stuck, by
   * which point everything in it had expired and the page rendered as a wall of "expired" —
   * which reads as this site's defect and tells the reader nothing true.
   */
  if (isStale(state, clock)) {
    const age = payloadAgeMinutes(state.timestamp, clock)
    return (
      <Notice
        title="World state is not updating"
        onRetry={() => {
          void load()
        }}
      >
        <p className="text-sm text-text-dim">
          The world state feed has stopped publishing
          {age === undefined ? '' : ` — its last update was ${describeAge(age)}`}, so everything
          in it has already expired.
        </p>
        <p className="mt-2 text-sm text-text-dim">
          Nothing else here depends on it. Drop tables, relics and rivens are served from this
          site and are unaffected.
        </p>
      </Notice>
    )
  }

  const live = openFissures(state.fissures, clock)
  const factions = factionActivity({ ...state, fissures: live })
  const tiers = groupFissuresByTier(live)
  const baroHere = traderIsHere(state.voidTrader, clock)

  return (
    <div>
      {/* What each faction is doing, which is what replaced a static Factions surface: node
          ownership is published for about half the star chart, but activity is complete. */}
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
          <PanelHeader title="Void fissures" aside={`${String(live.length)} open · soonest first`} />
          {tiers.map((group) => (
            <div key={group.tier} className="border-b border-hairline/50 last:border-0">
              <div className="flex items-baseline justify-between gap-3 px-3 pt-3 sm:px-5">
                {/* The tier is the point: an open Lith fissure is how you crack Lith relics. */}
                <Link
                  href={`/relics?q=${encodeURIComponent(group.tier)}&farmable=true`}
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
                      <NodeLink node={fissure.node} planet={fissure.planet} sourceId={fissure.sourceId} />
                      <span className="ml-2 text-xs text-text-faint">
                        {[
                          fissure.missionType,
                          fissure.faction,
                          fissure.isHard ? 'Steel Path' : undefined,
                          fissure.isStorm ? 'Railjack' : undefined,
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
            {state.invasions.map((invasion) => (
              <li
                key={invasion.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline/50 px-3 py-2.5 last:border-0 sm:px-5"
              >
                <NodeLink node={invasion.node} planet={invasion.planet} sourceId={invasion.sourceId} />
                <span className="text-xs text-text-faint">
                  {invasion.attacker ?? '?'} vs {invasion.defender ?? '?'}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        {(state.sortie !== undefined || state.archonHunt !== undefined) && (
          <Panel className="min-w-0">
            <PanelHeader title="Today" aside="sortie & archon hunt" />
            <div className="space-y-4 px-3 py-4 sm:px-5">
              {state.sortie !== undefined && (
                <SortieBlock label="Sortie" sortie={state.sortie} now={clock} />
              )}
              {state.archonHunt !== undefined && (
                <div className={state.sortie === undefined ? '' : 'border-t border-hairline/50 pt-3'}>
                  <SortieBlock label="Archon Hunt" sortie={state.archonHunt} now={clock} />
                </div>
              )}
            </div>
          </Panel>
        )}

        {state.voidTrader !== undefined && (
          <Panel className="min-w-0">
            <PanelHeader
              title={state.voidTrader.character ?? 'Void Trader'}
              aside={baroHere ? 'here now' : 'away'}
            />
            <div className="px-3 py-4 sm:px-5">
              {baroHere ? (
                <>
                  <p className="text-sm text-text">At {state.voidTrader.node ?? 'a relay'}.</p>
                  <p className="mt-0.5 text-xs text-text-faint">
                    Leaves in <Expiry expiry={state.voidTrader.expiry} now={clock} inline />
                  </p>
                  {state.voidTrader.inventory.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {state.voidTrader.inventory.map((entry) => (
                        <li
                          key={entry.item}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm"
                        >
                          {/* Text, not a link: these are internal item paths trimmed to their
                              last segment, and nothing here can check they name a real page. */}
                          <span className="text-text-dim">{entry.item}</span>
                          <span className="data-num text-xs text-text-faint">
                            {entry.ducats !== undefined && `${String(entry.ducats)} ducats`}
                            {entry.ducats !== undefined && entry.credits !== undefined && ' + '}
                            {entry.credits !== undefined && `${entry.credits.toLocaleString()} cr`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-dim">
                  Next at {state.voidTrader.node ?? 'a relay'} in{' '}
                  <Expiry expiry={state.voidTrader.activation} now={clock} inline />.
                </p>
              )}
            </div>
          </Panel>
        )}
      </div>

      <p className="mt-6 text-xs text-text-faint" role="status" aria-live="polite">
        Live from Digital Extremes&rsquo; world state. Refreshes every minute; expired fissures
        are hidden.
      </p>
    </div>
  )
}

function describeAge(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  if (hours >= 1) return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`
  return `${String(minutes)} minutes ago`
}

function Notice({
  title,
  children,
  onRetry,
}: {
  title: string
  children: React.ReactNode
  onRetry: () => void
}) {
  return (
    <Panel className="mt-8">
      <PanelHeader title={title} aside="upstream" />
      <div className="max-w-prose px-3 py-4 sm:px-5">
        {children}
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

function SortieBlock({
  label,
  sortie,
  now,
}: {
  label: string
  sortie: SortieLike
  now: number
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-sm text-text">
          {label}
          {sortie.boss !== undefined && ` — ${sortie.boss}`}
        </span>
        <Expiry expiry={sortie.expiry} now={now} />
      </div>
      {sortie.variants.length > 0 && (
        <ul className="mt-1.5">
          {sortie.variants.map((variant, index) => (
            <li key={`${variant.node}-${String(index)}`} className="py-0.5 text-xs text-text-faint">
              {variant.node}
              {variant.planet !== undefined && ` (${variant.planet})`}
              {variant.missionType !== undefined && ` · ${variant.missionType}`}
              {variant.modifier !== undefined && ` · ${variant.modifier}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A node links to its source page only when that page exists.
 *
 * The star chart resolves every live node to a NAME, but this site only has a page for nodes
 * the drop tables mention — roughly 85%. Linking on a successful name lookup alone produced
 * 404s for Eurasia, Telesto and Ker, which an end-to-end check caught by fetching the links
 * the page rendered.
 */
function NodeLink({
  node,
  planet,
  sourceId,
}: {
  node: string
  planet: string | undefined
  sourceId: string | undefined
}) {
  const label = planet === undefined ? node : `${node} (${planet})`
  if (sourceId === undefined) return <span className="text-text">{label}</span>
  const at = sourceId.indexOf(':')
  const kind = sourceId.slice(0, at)
  const rest = sourceId.slice(at + 1)
  return (
    <Link
      href={`/source/${kind}/${rest.split('/').map(encodeURIComponent).join('/')}`}
      className="text-text underline decoration-hairline-strong underline-offset-2 transition-colors hover:text-orokin"
    >
      {label}
    </Link>
  )
}

function Expiry({
  expiry,
  now,
  inline = false,
}: {
  expiry: number | undefined
  now: number
  inline?: boolean
}) {
  const left = timeUntil(expiry, now)
  if (left === undefined) return null
  if (inline) return <span className="data-num">{left}</span>
  return (
    <span
      className={`data-num shrink-0 text-xs ${left === 'expired' ? 'text-text-faint' : 'text-text-dim'}`}
    >
      {left}
    </span>
  )
}
