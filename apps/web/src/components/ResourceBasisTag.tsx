import type { ResourceBasis } from '@provenance/core'

/**
 * Where a planet-resource claim came from.
 *
 * The planet pages are the first surface on this site that asserts something DE never
 * published, so the reader is told which rows those are rather than being left to assume
 * every number here traces back to a drop table (DESIGN.md § 16).
 *
 * Deliberately quiet: gold is spent once per view on the thing the reader searched for, and
 * a provenance mark is not that thing. These are hairline chips in dim text, legible when
 * looked at and invisible when scanning the resource names.
 */

const LABEL: Record<ResourceBasis, string> = {
  exclusive: 'Local',
  faction: 'Faction',
  'reward-table': 'Reward table',
}

const TITLE: Record<ResourceBasis, string> = {
  exclusive: 'Found here and nowhere else. Community knowledge — DE publishes no such list.',
  faction:
    'Dropped by this faction’s units wherever they are fought. The factions holding this ' +
    'planet come from the star chart; what they drop is community knowledge.',
  'reward-table':
    'Listed in this planet’s own mission or bounty reward tables, with a published chance.',
}

export function ResourceBasisTag({ basis, faction }: { basis: ResourceBasis; faction?: string }) {
  const label = basis === 'faction' && faction !== undefined ? faction : LABEL[basis]
  return (
    <span
      title={TITLE[basis]}
      className={`chamfer-sm border px-1.5 py-0.5 text-[0.6875rem] whitespace-nowrap ${
        basis === 'reward-table'
          ? 'border-hairline text-text-faint'
          : 'border-gold-dim/60 text-text-dim'
      }`}
    >
      {label}
    </span>
  )
}

/** The one-line explanation that sits under a planet's resource table. Stated once per page
 *  rather than repeated on every row. */
export function BasisLegend() {
  return (
    <p className="max-w-prose px-3 py-2.5 text-xs text-text-faint sm:px-5">
      <strong className="text-text-dim">Local</strong> and faction rows are community
      knowledge, not published data — DE&rsquo;s drop tables record what an enemy drops and
      never where it spawns, so no feed can produce them.{' '}
      <strong className="text-text-dim">Reward table</strong> rows are read straight from this
      planet&rsquo;s own mission and bounty tables and carry a published chance.
    </p>
  )
}
