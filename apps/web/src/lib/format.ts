/**
 * "168 min" is arithmetic; "2h 48m" is a decision. Anything past an hour gets split,
 * because that is the unit players actually plan an evening in.
 */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—'
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes.toFixed(0)}m`

  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
