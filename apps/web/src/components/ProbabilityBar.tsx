import type { RelicRarity } from '@provenance/core'

const RARITY_BG: Record<RelicRarity | 'legendary', string> = {
  common: 'bg-r-common',
  uncommon: 'bg-r-uncommon',
  rare: 'bg-r-rare',
  legendary: 'bg-r-legendary',
}

interface ProbabilityBarProps {
  /** 0..1 */
  value: number
  rarity?: RelicRarity | 'legendary'
  /** Bars in a list should share a scale, or the comparison they invite is a lie. */
  max?: number
}

/**
 * A probability bar is a typographic object, not a chart: a hairline track, a flat filled
 * segment, and the number set in mono immediately adjacent (DESIGN.md § 8). No chart
 * library, no gradient, no rounded caps.
 *
 * `max` exists because drop chances in one list can span 0.5% to 40%. Scaling each bar to
 * its own width would make every row look identical; scaling them all to the largest value
 * in the set is what makes the shape carry information.
 */
export function ProbabilityBar({ value, rarity = 'common', max = 1 }: ProbabilityBarProps) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  const percent = (value * 100).toFixed(2)

  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 flex-1 bg-void-700"
        role="img"
        aria-label={`${percent} percent drop chance`}
      >
        <div
          className={`h-full ${RARITY_BG[rarity]}`}
          style={{ width: `${(ratio * 100).toFixed(3)}%` }}
        />
      </div>
      <span className="data-num w-16 shrink-0 text-right text-sm text-text">{percent}%</span>
    </div>
  )
}
