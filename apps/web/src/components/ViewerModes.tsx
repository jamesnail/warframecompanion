'use client'

import { useAppliedSettings } from '@/lib/client/use-settings'

/**
 * The three places a viewer preference changes what a page shows.
 *
 * All client islands inside otherwise-static pages, and all of them ADDITIVE or subtractive on
 * chrome only — none of them changes a number, a row count or a drop rate. A preference that
 * altered the data would be a filter, and filters live in the URL (CLAUDE.md constraint 5).
 *
 * Each renders nothing until IndexedDB has answered, so the prerendered HTML and the first
 * client render agree and React reports no hydration mismatch.
 */

/**
 * Hides trading surfaces under "drops only".
 *
 * Children are passed down from a server component, so the market link stays server-rendered
 * and in the static HTML — this only decides whether it is shown. That matters for the 99% of
 * viewers who never turn this on: they get identical HTML and no extra work.
 */
export function TradeOnly({ children }: { children: React.ReactNode }) {
  const { dropsOnly } = useAppliedSettings()
  if (dropsOnly) return null
  return <>{children}</>
}

/**
 * The item's mastery requirement, and whether it is above the viewer's.
 *
 * Shown only once the viewer has said what their rank is — that is what the setting is for,
 * and an MR badge on every page for everyone would be a change to the tool rather than a
 * preference. It marks; it never hides. The parts are farmable at any rank; only equipping
 * the finished thing is gated, so hiding the page would answer the wrong question.
 */
export function MasteryBadge({ masteryReq }: { masteryReq: number | undefined }) {
  const { masteryRank } = useAppliedSettings()
  if (masteryReq === undefined || masteryRank === null) return null

  const above = masteryReq > masteryRank
  return (
    <span
      className={`chamfer-sm data-num border px-2 py-1 text-xs ${
        above ? 'border-r-legendary text-r-legendary' : 'border-hairline text-text-dim'
      }`}
    >
      MR {masteryReq}
      {/* The separator is real text, not margin. Spacing it with `ml` alone left the
          accessible name reading "MR 8above yours". */}
      {above && <span className="ml-1.5">· above yours</span>}
    </span>
  )
}

/**
 * A short explainer, shown only in new player mode.
 *
 * Deliberately inline and next to the thing it explains rather than collected on a glossary
 * page nobody visits. Off by default because the tool's voice is instrumentation, and a
 * returning player does not need to be told what vaulting is every time they look something
 * up (CLAUDE.md § Copy).
 */
export function NewPlayerNote({ children }: { children: React.ReactNode }) {
  const { newPlayer } = useAppliedSettings()
  if (!newPlayer) return null
  return (
    <p className="mt-3 max-w-prose border-l-2 border-gold-dim pl-3 text-sm text-text-dim">
      {children}
    </p>
  )
}
