import Link from 'next/link'

import { isStale, type Insight } from '@provenance/core'

import { Panel, PanelHeader } from '@/components/Primitives'
import { sourceHref } from '@/lib/source-route'

/**
 * Community knowledge, rendered so it can never be mistaken for measured data.
 *
 * Three things carry that weight, and all three are load-bearing rather than decorative:
 *
 *  1. The panel is headed "community knowledge", in the same place a data panel puts its row
 *     count. A reader who takes in only the header still knows what they are reading.
 *  2. Every claim names its source and its date. In a live-service game a route from two
 *     updates ago is simply wrong, and the date is the only thing that lets a reader judge
 *     that for themselves — so it is shown, never hidden behind a link.
 *  3. A claim past the staleness threshold says so in words, because a date alone asks the
 *     reader to do arithmetic they should not have to do.
 *
 * Dates read as "updated" only where the source publishes its own last-edited timestamp.
 * Where it does not, this says "read on", which is a weaker claim and must not be dressed up
 * as the stronger one.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** "2026-08-09" -> "9 Aug 2026". Built by hand rather than via toLocaleDateString, which
 *  would render differently on the build machine than in the reader's browser. */
function readable(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return iso
  return `${String(day)} ${MONTHS[month - 1] ?? ''} ${String(year)}`
}

export function InsightList({
  insights,
  hasItem,
  now,
}: {
  insights: readonly Insight[]
  hasItem: (id: string) => boolean
  /** Passed in rather than read here, so every panel on a page agrees and the build is
   *  deterministic — a component calling Date.now() would make the prerendered HTML depend
   *  on the minute it was generated. */
  now: Date
}) {
  return (
    <ul>
      {insights.map((insight, index) => {
        const { citation } = insight
        const stale = isStale(citation, now)
        const stamp = citation.updated ?? citation.retrieved
        return (
          <li
            key={`${citation.url}-${String(index)}`}
            className="border-b border-hairline/50 px-3 py-4 last:border-0 sm:px-5"
          >
            <p className="max-w-prose text-sm text-text-dim">{insight.text}</p>

            {insight.nodes !== undefined && insight.nodes.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-x-2 gap-y-1.5">
                {insight.nodes.map((node) => (
                  <li key={node.name}>
                    {node.sourceId === undefined ? (
                      <span className="chamfer-sm border border-hairline px-2 py-0.5 text-xs text-text-faint">
                        {node.name}
                      </span>
                    ) : (
                      /* Linked to the real drop table, so a claim about a node is one the
                         reader can go and check against published numbers. */
                      <Link
                        href={sourceHref(node.sourceId, hasItem)}
                        className="chamfer-sm block border border-hairline px-2 py-0.5 text-xs text-text-dim transition-colors hover:border-gold-dim hover:text-gold"
                      >
                        {node.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2.5 text-xs text-text-faint">
              <a
                href={citation.url}
                target="_blank"
                rel="noreferrer noopener"
                className="transition-colors hover:text-gold"
              >
                {citation.title}
                <span aria-hidden="true"> ↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              {' · '}
              {citation.updated === undefined ? 'read' : 'updated'} {readable(stamp)}
              {stale && (
                <span className="text-warn">
                  {' · '}may be out of date
                </span>
              )}
            </p>
          </li>
        )
      })}
    </ul>
  )
}

export function InsightPanel({
  title,
  insights,
  hasItem,
  now,
  className,
}: {
  title: string
  insights: readonly Insight[]
  hasItem: (id: string) => boolean
  now: Date
  className?: string
}) {
  if (insights.length === 0) return null
  return (
    <Panel className={className ?? 'mt-6'}>
      <PanelHeader title={title} aside="community knowledge" />
      <InsightList insights={insights} hasItem={hasItem} now={now} />
    </Panel>
  )
}
