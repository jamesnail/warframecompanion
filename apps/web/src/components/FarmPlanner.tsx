'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { parseAsInteger, useQueryState } from 'nuqs'

import { Panel, PanelHeader, SummaryCard } from '@/components/Primitives'
import { fetchWorldState } from '@/lib/client/world-state'
import { useCollection } from '@/lib/client/use-collection'
import { buildNeeds, groupByAction, trackedTargets, type FarmAction, type Need, type TrackedSet } from '@/lib/farm'
import { sourceHref } from '@/lib/source-route'
import { openFissures, timeUntil, type Fissure, type NodeIndex } from '@/lib/world'
import type { DropChain } from '@provenance/core'

/**
 * What to farm right now.
 *
 * The page answers one question — "what do I queue next" — and answers it with ACTIONS
 * rather than a list of missing parts. A list of eleven parts is just the collection page
 * re-sorted; the useful fact is that three of those parts sit behind Neo relics and one Neo
 * fissure run counts toward all three.
 *
 * Everything here is the viewer's own: the collection comes from IndexedDB and the fissures
 * from the live feed, so nothing is prerendered and nothing is shared. The chains are the
 * one build-time input, and they are the same ones the item pages show.
 */

const SQUAD_SIZES = [1, 2, 3, 4] as const
const REFRESH_MS = 60_000

export function FarmPlanner({
  sets,
  chains,
  nodes,
}: {
  sets: TrackedSet[]
  chains: Record<string, DropChain>
  nodes: NodeIndex
}) {
  const { owned, tracked, ready } = useCollection()
  const [squad, setSquad] = useQueryState('squad', parseAsInteger.withDefault(1))
  const players = SQUAD_SIZES.includes(squad as (typeof SQUAD_SIZES)[number]) ? squad : 1

  const [fissures, setFissures] = useState<Fissure[] | undefined>(undefined)
  const [now, setNow] = useState<number>(() => Date.now())

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const state = await fetchWorldState(nodes, signal)
        setFissures(state.fissures)
        setNow(Date.now())
      } catch {
        // The plan still works without fissures — every route just falls back to "farm the
        // relic", which is what you would do anyway. An empty array is the honest value:
        // "no fissure is known to be open", not "the page is broken".
        setFissures([])
      }
    },
    [nodes],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const refresh = setInterval(() => void load(), REFRESH_MS)
    const tick = setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    return () => {
      controller.abort()
      clearInterval(refresh)
      clearInterval(tick)
    }
  }, [load])

  if (!ready) return <p className="label mt-8">Reading your collection…</p>

  const targets = trackedTargets(sets, tracked)

  if (tracked.size === 0) {
    return (
      <p className="mt-8 max-w-prose text-sm text-text-dim">
        Nothing on the farm list. Open a set or a part —{' '}
        <Link href="/item/braton-prime" className="text-text transition-colors hover:text-gold">
          Braton Prime
        </Link>{' '}
        for instance — and add it, and this page will plan the rest.
      </p>
    )
  }

  const live = fissures === undefined ? [] : openFissures(fissures, now)
  const openTiers = new Set(live.map((fissure) => fissure.tier))
  const byTier = new Map<string, Fissure[]>()
  for (const fissure of live) {
    const list = byTier.get(fissure.tier)
    if (list === undefined) byTier.set(fissure.tier, [fissure])
    else list.push(fissure)
  }

  const needs = buildNeeds(sets, tracked, owned, chains, openTiers, players)
  const actions = groupByAction(needs)
  const actionable = needs.filter((need) => need.status !== 'blocked').length

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="On the list" value={tracked.size.toLocaleString()} />
        <SummaryCard label="Parts needed" value={needs.length.toLocaleString()} />
        <SummaryCard
          label="Farmable"
          value={actionable.toLocaleString()}
          tone={actionable > 0 ? 'accent' : 'warn'}
        />
        <SquadPicker
          players={players}
          onPick={(size) => {
            void setSquad(size === 1 ? null : size)
          }}
        />
      </div>

      {actions.length === 0 ? (
        <p className="mt-8 max-w-prose text-sm text-text-dim">
          {targets.length > 0 || tracked.size > 0
            ? 'Everything on the farm list is owned, or has no known source.'
            : 'Nothing to plan.'}
        </p>
      ) : (
        actions.map((action) => (
          <ActionCard
            key={action.key}
            action={action}
            fissures={byTier.get(action.title.replace(' fissure', '')) ?? []}
            now={now}
            pending={fissures === undefined}
          />
        ))
      )}
    </>
  )
}

function SquadPicker({ players, onPick }: { players: number; onPick: (size: number) => void }) {
  return (
    <div className="chamfer-sm border border-hairline bg-void-800/60 px-4 py-3">
      <div className="label">Squad</div>
      <div className="mt-1.5 flex gap-1.5">
        {SQUAD_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={players === size}
            onClick={() => {
              onPick(size)
            }}
            className={`chamfer-sm size-7 border text-xs transition-colors ${
              players === size
                ? 'border-gold bg-void-700 text-gold'
                : 'border-hairline text-text-faint hover:border-gold-dim hover:text-text'
            }`}
          >
            {size}
            <span className="sr-only"> player{size === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ActionCard({
  action,
  fissures,
  now,
  pending,
}: {
  action: FarmAction
  fissures: Fissure[]
  now: number
  pending: boolean
}) {
  const parts = `${String(action.needs.length)} part${action.needs.length === 1 ? '' : 's'}`

  return (
    <Panel className="mt-6">
      <PanelHeader
        title={action.kind === 'blocked' ? 'Vaulted — trade for these' : action.title}
        aside={
          action.kind === 'blocked'
            ? parts
            : `${parts} · ${Math.ceil(action.runs).toLocaleString()} runs for the cheapest`
        }
      />

      {/* Where to go, for an action that expires. Capped: a tier can have five open
          fissures and the plan only needs to prove one exists. */}
      {action.kind === 'fissure' && fissures.length > 0 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 border-b border-hairline/50 px-3 py-2.5 sm:px-5">
          {fissures.slice(0, 4).map((fissure) => (
            <li key={fissure.id} className="text-xs text-text-dim">
              {fissure.sourceId === undefined ? (
                <span>{fissure.node}</span>
              ) : (
                <Link
                  // A source id is namespaced and its rest may contain slashes; the shared
                  // helper is the only thing that round-trips it correctly. A mission is
                  // never a relic, so the relic lookup can answer false.
                  href={sourceHref(fissure.sourceId, () => false)}
                  className="transition-colors hover:text-gold"
                >
                  {fissure.node}
                </Link>
              )}
              <span className="data-num ml-2 text-text-faint">{timeUntil(fissure.expiry, now)}</span>
            </li>
          ))}
          {fissures.length > 4 && (
            <li className="text-xs text-text-faint">
              +{fissures.length - 4} more on{' '}
              <Link href="/world" className="underline underline-offset-4 hover:text-gold">
                world state
              </Link>
            </li>
          )}
        </ul>
      )}

      {action.kind === 'fissure' && pending && (
        <p className="label px-3 py-2.5 sm:px-5">Checking open fissures…</p>
      )}

      <ul>
        {action.needs.map((need) => (
          <NeedRow key={need.chain.itemId} need={need} blocked={action.kind === 'blocked'} />
        ))}
      </ul>
    </Panel>
  )
}

function NeedRow({ need, blocked }: { need: Need; blocked: boolean }) {
  const { chain } = need
  return (
    <li className="hover-edge border-b border-hairline/50 px-3 py-3 last:border-0 hover:bg-void-800 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link
          href={`/item/${chain.itemId}`}
          className="text-sm text-text transition-colors hover:text-gold"
        >
          {chain.itemName}
        </Link>
        {!blocked && (
          <span className="data-num shrink-0 text-xs text-text-dim">
            {Number.isFinite(need.runs) ? Math.ceil(need.runs).toLocaleString() : '—'}
            <span className="ml-1.5 text-text-faint">runs</span>
          </span>
        )}
      </div>

      {/* The trace, compressed to one line. The full version lives on the item page; this is
          enough to see WHY the plan says what it says without leaving the plan. */}
      <div className="mt-1 text-xs text-text-faint">
        {chain.relic === undefined
          ? chain.source?.name
          : `${chain.source?.name ?? '?'} → ${chain.relic.name} → ${chain.itemName}`}
      </div>

      {need.wantedBy.length > 0 && (
        <div className="mt-1 text-xs text-text-faint/80">Finishes {need.wantedBy.join(', ')}</div>
      )}
    </li>
  )
}
