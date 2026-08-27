import type { ReactNode } from 'react'
import type { RelicRarity } from '@provenance/core'

/** The standard content container. Chamfer, hairline frame, gold corner braces. */
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={`panel ${className}`}>{children}</section>
}

/**
 * Section heading. Display face, sentence case, sitting on a gold rule that fades out.
 *
 * The diamond before the title is the Orokin readout marker, in ornament gold rather than
 * accent gold: the accent is spent once per view, on the thing you searched for, and a page
 * with four panels would otherwise spend it four times. Decorative, so it is hidden from
 * assistive tech; the heading text is the actual label.
 */
export function PanelHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    // flex-wrap, and the title never breaks: on a narrow screen the aside drops to its own
    // line instead of being clipped, and "Direct sources" stays one phrase rather than
    // splitting across two lines to make room for it.
    <header className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-3 sm:px-5">
      <h2 className="flex items-baseline gap-2.5 font-display text-sm font-semibold whitespace-nowrap">
        <span
          className="size-1.5 shrink-0 self-center rotate-45 bg-gold-dim"
          aria-hidden="true"
        />
        {title}
      </h2>
      {aside !== undefined && <div className="label">{aside}</div>}
      <span className="rule-gold absolute inset-x-0 bottom-0" aria-hidden="true" />
    </header>
  )
}

/**
 * Page header. The hero at the top of every route: kicker, title, optional lede, actions.
 *
 * This is the one place the accent gold is guaranteed to appear, which is what makes
 * "once per view" enforceable everywhere else.
 */
export function PageHeader({
  kicker,
  title,
  lede,
  actions,
}: {
  kicker?: ReactNode
  title: string
  lede?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="relative pb-6">
      {kicker !== undefined && <div className="label mb-2">{kicker}</div>}
      <h1 className="font-display text-xl font-bold tracking-tight text-gold sm:text-2xl">
        {title}
      </h1>
      {lede !== undefined && (
        <div className="mt-3 max-w-prose text-sm text-text-dim">{lede}</div>
      )}
      {actions !== undefined && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
      <span className="rule-gold absolute inset-x-0 bottom-0" aria-hidden="true" />
    </header>
  )
}

/**
 * A summary figure, shown above the dense table rather than inside it.
 *
 * These answer the question people arrive with — "can I farm this right now?" — so they
 * come first and the table becomes the detail behind them.
 */
export function SummaryCard({
  label,
  value,
  detail,
  tone = 'plain',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'plain' | 'accent' | 'warn'
}) {
  const valueTone =
    tone === 'accent' ? 'text-gold' : tone === 'warn' ? 'text-r-legendary' : 'text-text'
  return (
    <div className="chamfer-sm border border-hairline bg-void-800/60 px-4 py-3">
      <div className="label">{label}</div>
      <div className={`data-num mt-1.5 text-lg ${valueTone}`}>{value}</div>
      {detail !== undefined && (
        <div className="mt-1 text-xs text-text-faint">{detail}</div>
      )}
    </div>
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
 * Rarity is carried by a mark plus a word, never by colour alone — colour-blind users and
 * greyscale screenshots both need the label to survive. The mark is a diamond here rather
 * than a square, to match the Orokin geometry the panels use.
 */
export function RarityTag({ rarity }: { rarity: RelicRarity }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`size-1.5 shrink-0 rotate-45 ${RARITY_DOT[rarity]}`}
        aria-hidden="true"
      />
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
        <span className={`data-num text-lg ${accent ? 'text-gold' : 'text-text'}`}>{value}</span>
        {unit !== undefined && <span className="text-xs text-text-faint">{unit}</span>}
      </div>
    </div>
  )
}

/** The shared button/pill surface, so every control in the app hovers identically. */
export const CONTROL =
  'chamfer-sm hover-lift inline-flex items-center gap-1.5 border border-hairline bg-void-800 px-3 py-1.5 text-sm text-text-dim hover:border-gold-dim hover:text-text disabled:opacity-40'

/** The standard content column. One value, so every route lines up with every other. */
export const PAGE = 'mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10'
