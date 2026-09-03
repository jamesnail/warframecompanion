import type { ResourceBasis } from '@provenance/core'

/**
 * Where a resource claim came from, and how rare it is in that place.
 *
 * The planet pages assert things DE never published, so the reader is told which rows those
 * are rather than left to assume every figure traces back to a drop table (DESIGN.md § 16).
 *
 * Deliberately quiet. Gold is spent once per view on the thing the reader searched for, and
 * a provenance mark is never that thing — these are hairline chips in dim text, legible when
 * looked at and invisible when scanning down the resource names.
 */

const LABEL: Record<ResourceBasis, string> = {
  region: 'Region',
  gathered: 'Gathered',
  'reward-table': 'Reward table',
}

const TITLE: Record<ResourceBasis, string> = {
  region:
    'In this region’s drop pool: what enemies and containers here drop. A real game mechanic, ' +
    'documented by the WARFRAME Wiki — DE publishes what an enemy drops but never where it spawns.',
  gathered:
    'Mined, fished or picked here. Nothing drops these, so they appear in no drop table at ' +
    'any grain.',
  'reward-table':
    'Listed in this place’s own mission or bounty reward tables, with a chance published by ' +
    'Digital Extremes.',
}

export function ResourceBasisTag({ basis }: { basis: ResourceBasis }) {
  return (
    <span
      title={TITLE[basis]}
      className={`chamfer-sm border px-1.5 py-0.5 text-[0.6875rem] whitespace-nowrap ${
        basis === 'reward-table'
          ? 'border-hairline text-text-faint'
          : 'border-gold-dim/60 text-text-dim'
      }`}
    >
      {LABEL[basis]}
    </span>
  )
}

/** Stated once under a planet's resource list rather than repeated on every row. */
export function BasisLegend() {
  return (
    <p className="max-w-prose px-3 py-2.5 text-xs text-text-faint sm:px-5">
      <strong className="text-text-dim">Region</strong> and{' '}
      <strong className="text-text-dim">gathered</strong> rows come from the WARFRAME Wiki, not
      from a Digital Extremes feed: DE&rsquo;s drop tables record what an enemy drops and never
      where it spawns, so no feed can produce them.{' '}
      <strong className="text-text-dim">Reward table</strong> rows are read straight from this
      place&rsquo;s own mission and bounty tables and carry a published chance.
    </p>
  )
}
