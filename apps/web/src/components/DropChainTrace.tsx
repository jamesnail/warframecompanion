import { Suspense } from 'react'
import Link from 'next/link'

import { ChainSquad } from '@/components/ChainSquad'
import { Panel, PanelHeader } from '@/components/Primitives'
import { chainRuns, type DropChain } from '@provenance/core'

/**
 * The drop chain trace: item ← relic ← the mission you actually queue, with the odds
 * compounding visibly at each hop.
 *
 * DESIGN.md § 8 names this the signature element and asks every other component to stay
 * quiet enough to let it be the memorable thing, which is why it sits directly under the
 * summary cards and above every table on the page.
 *
 * It reads top-down as an instruction — run this, crack that, get this — because the reader
 * arrived holding the item and wants to know what to queue. The mission is the answer, so it
 * is the first line; the item they searched for is the last.
 *
 * A SERVER component, deliberately. Only the squad control reads a search param, and
 * anything reading search params has to sit behind a Suspense boundary or the page cannot be
 * statically prerendered (the same trap /browse, /relics and /rivens document). Wrapping the
 * whole trace would have kept the most important component on a 6,000-page indexable site
 * out of the static HTML entirely, so the boundary is drawn as tightly as possible: the
 * route, the odds and the solo cost are all prerendered, and only the squad-adjusted figure
 * arrives on hydration.
 */
export function DropChainTrace({ chain }: { chain: DropChain }) {
  const { relic, source } = chain
  if (source === undefined) return null

  const solo = chainRuns(chain, 1)

  return (
    <Panel className="mt-6">
      <PanelHeader
        title="Best route"
        aside={relic === undefined ? 'direct drop' : `via ${relic.tier}`}
      />

      <div className="px-3 py-4 sm:px-5">
        <ol className="relative">
          {/* The rail runs between the first and last marker, not past them. */}
          <span
            className="absolute top-2 bottom-2 left-[3px] w-px bg-gold-dim"
            aria-hidden="true"
          />

          <Hop
            kicker="Run"
            title={source.name}
            href={source.href}
            detail={source.kind}
            figure={`${(source.chance * 100).toFixed(2)}%`}
            figureNote="per run"
          />

          {relic !== undefined && (
            <Hop
              kicker="Crack"
              title={relic.name}
              href={`/item/${relic.id}`}
              detail={`${relic.tier} · ${relic.refinement}${relic.vaulted ? ' · vaulted' : ''}`}
              figure={`${(relic.chance * 100).toFixed(2)}%`}
              figureNote="per relic"
            />
          )}

          <Hop kicker="Get" title={chain.itemName} href={undefined} detail={undefined} last />
        </ol>

        {/* The fallback is the solo answer, which is the correct answer for most readers and
            is never wrong — only less specific than what hydration replaces it with. */}
        <Suspense fallback={<SoloCost solo={solo} />}>
          <ChainSquad chain={chain} />
        </Suspense>
      </div>
    </Panel>
  )
}

export function SoloCost({ solo }: { solo: number }) {
  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <div className="label">Expected runs</div>
      <div className="data-num mt-1 text-lg text-gold">{formatRuns(solo)}</div>
    </div>
  )
}

export function formatRuns(runs: number): string {
  return Number.isFinite(runs) ? Math.ceil(runs).toLocaleString() : '—'
}

function Hop({
  kicker,
  title,
  href,
  detail,
  figure,
  figureNote,
  last = false,
}: {
  kicker: string
  title: string
  href: string | undefined
  detail: string | undefined
  figure?: string
  figureNote?: string
  last?: boolean
}) {
  return (
    <li className={`relative flex gap-3 ${last ? '' : 'pb-5'}`}>
      <span
        className="relative z-10 mt-1.5 size-[7px] shrink-0 rotate-45 border border-gold bg-void-800"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="min-w-0">
          <span className="label mr-2">{kicker}</span>
          {href === undefined ? (
            <span className="text-sm text-text">{title}</span>
          ) : (
            <Link href={href} className="text-sm text-text transition-colors hover:text-gold">
              {title}
            </Link>
          )}
          {detail !== undefined && <span className="ml-2 text-xs text-text-faint">{detail}</span>}
        </span>
        {figure !== undefined && (
          <span className="data-num shrink-0 text-xs text-text-dim">
            {figure}
            {figureNote !== undefined && (
              <span className="ml-1.5 text-text-faint">{figureNote}</span>
            )}
          </span>
        )}
      </div>
    </li>
  )
}
