/**
 * "168 min" is arithmetic; "2h 48m" is a decision. Anything past an hour gets split,
 * because that is the unit players actually plan an evening in.
 *
 * Minutes are rounded ONCE, up front. Rounding the remainder separately produced "1h 60m"
 * for 119.7 and "23h 60m" for 1439.6 — the carry never propagated.
 */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—'
  if (minutes < 0.5) return '<1m'

  const total = Math.round(minutes)
  if (total < 60) return `${total}m`

  const hours = Math.floor(total / 60)
  const rest = total % 60

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const restHours = hours % 24
    return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/**
 * Ceiling for counts derived from probabilities.
 *
 * relicsNeeded(0.1) computes 1 / (1 - 0.9^1), which is 10.000000000000002 rather than 10,
 * so a plain Math.ceil reported 11 relics beside a printed "10.00%". Snapping to 12
 * significant digits first absorbs that without affecting genuinely fractional values.
 */
export function ceilCount(value: number): number {
  if (!Number.isFinite(value)) return value
  return Math.ceil(Number(value.toPrecision(12)))
}
