'use client'

import { useEffect, useState } from 'react'

import { Panel, PanelHeader } from '@/components/Primitives'
import { allPhasesAt, type CyclePosition } from '@provenance/core'
import type { Zariman } from '@/lib/world'

/**
 * Open-world cycles.
 *
 * Four of the five are arithmetic on the reader's own clock — no fetch, no upstream, nothing
 * that can go stale or 500. That is why this renders above the live sections and stays on
 * screen even when the world state feed is down or frozen: when the rest of the page is
 * apologising, this part is still correct.
 *
 * The fifth, the Zariman, is live data and simply absent when the feed is. See the note at
 * the top of `packages/core/src/cycles.ts` for why it cannot be computed like the others.
 *
 * Rendered only after mount. Every page here is prerendered at build time, so a phase
 * baked into the HTML would be hours stale by the time anyone read it — the placeholder is
 * shorter-lived than a wrong answer.
 */

/** Cycles are short — Orb Vallis is warm for 6m40s — so seconds are load-bearing here. */
const TICK_MS = 1000

export function CyclesPanel({ zariman }: { zariman: Zariman | undefined }) {
  const [now, setNow] = useState<number | undefined>(undefined)

  useEffect(() => {
    setNow(Date.now())
    const tick = setInterval(() => {
      setNow(Date.now())
    }, TICK_MS)
    return () => {
      clearInterval(tick)
    }
  }, [])

  return (
    <Panel className="mt-8">
      <PanelHeader title="Open-world cycles" aside="computed, not fetched" />
      {now === undefined ? (
        <p className="label px-3 py-4 sm:px-5">Reading your clock…</p>
      ) : (
        <ul>
          {allPhasesAt(now).map((position) => (
            <CycleRow key={position.cycle.id} position={position} />
          ))}
          {zariman !== undefined && (
            <Row
              location="Zariman"
              phase={zariman.faction}
              remainingMs={zariman.endsAt - now}
              next={undefined}
            />
          )}
        </ul>
      )}
    </Panel>
  )
}

function CycleRow({ position }: { position: CyclePosition }) {
  return (
    <Row
      location={position.cycle.location}
      phase={position.phase.name}
      remainingMs={position.remainingMs}
      next={position.next.name}
    />
  )
}

function Row({
  location,
  phase,
  remainingMs,
  next,
}: {
  location: string
  phase: string
  remainingMs: number
  next: string | undefined
}) {
  return (
    <li className="hover-edge flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-hairline/50 px-3 py-2.5 last:border-0 hover:bg-void-800 sm:px-5">
      <span className="min-w-0">
        <span className="text-sm text-text">{location}</span>
        <span className="ml-2 text-sm text-gold">{phase}</span>
      </span>
      <span className="data-num text-xs text-text-faint">
        {/* No aria-live: a countdown that re-announces every second is unusable with a
            screen reader, and the phase name beside it already carries the useful fact. */}
        {countdown(remainingMs)}
        {next !== undefined && <span className="ml-2 text-text-faint/80">→ {next}</span>}
      </span>
    </li>
  )
}

/**
 * "1h 12m", "41m 16s", "48s". Hours drop seconds — nobody reads the seconds digit on a
 * two-hour Duviri mood, and a field that changes every second draws the eye for nothing.
 */
export function countdown(ms: number): string {
  if (ms <= 0) return 'now'
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`
  if (minutes > 0) return `${String(minutes)}m ${String(seconds)}s`
  return `${String(seconds)}s`
}
