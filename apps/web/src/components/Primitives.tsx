import type { ReactNode } from 'react'
import type { RelicRarity } from '@provenance/core'

/** The standard content container. Chamfer + hairline, nothing else — no shadow, no glow. */
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={`panel ${className}`}>{children}</section>
}

/** Section heading. Display face, sentence case, sitting on a hairline. */
export function PanelHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <header className="flex items-baseline justify-between gap-4 border-b border-hairline px-5 py-3">
      <h2 className="font-display text-sm font-semibold">{title}</h2>
      {aside !== undefined && <div className="label shrink-0">{aside}</div>}
    </header>
  )
}

const RARITY_TEXT: Record<RelicRarity, string> = {
  common: 'text-r-common',
  uncommon: 'text-r-uncommon',
  rare: 'text-r-rare',
}

const RARITY_DOT: Record<RelicRarity, string> = {
  common: 'bg-r-common',
  uncommon: 'bg-r-uncommon',
  rare: 'bg-r-rare',
}

/**
 * Rarity is carried by a dot plus a word, never by colour alone — colour-blind users and
 * greyscale screenshots both need the label to survive.
 */
export function RarityTag({ rarity }: { rarity: RelicRarity }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-1.5 shrink-0 ${RARITY_DOT[rarity]}`} aria-hidden="true" />
      <span className={`text-xs capitalize ${RARITY_TEXT[rarity]}`}>{rarity}</span>
    </span>
  )
}

/** A labelled readout. The number leads, the unit follows quietly. */
export function Stat({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string
  value: string
  unit?: string
  accent?: boolean
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`data-num text-lg ${accent ? 'text-orokin' : 'text-text'}`}>{value}</span>
        {unit !== undefined && <span className="text-xs text-text-faint">{unit}</span>}
      </div>
    </div>
  )
}
