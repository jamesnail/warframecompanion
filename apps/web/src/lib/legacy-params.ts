/**
 * One-shot translation of `/browse`'s old six-param filter state into query text.
 *
 * Those URLs are shareable by design — that is the whole point of CLAUDE.md constraint 5 — so
 * some of them exist in bookmarks and in chat logs. They have to keep resolving to the view
 * they described.
 *
 * This runs once on mount and is then replaced in history. It is deliberately NOT a permanent
 * compatibility layer sitting in the filter path: two ways to express the same filter, both
 * live, is how the URL stops being the source of truth.
 */

export interface LegacyParams {
  q?: string | null
  category?: string[] | null
  kind?: string[] | null
  min?: number | null
  tradable?: boolean | null
  farmable?: boolean | null
}

const LEGACY_KEYS = ['category', 'kind', 'min', 'tradable', 'farmable'] as const

/** Whether a URL carries any pre-query filter state worth translating. */
export function hasLegacyParams(params: URLSearchParams): boolean {
  return LEGACY_KEYS.some((key) => params.has(key))
}

/** A value needs quoting when it contains a space — "Sanctuary Onslaught (Elite)" does. */
function term(key: string, value: string): string {
  return /\s/.test(value) ? `${key}:"${value.toLowerCase()}"` : `${key}:${value.toLowerCase()}`
}

/**
 * Query text equivalent to a legacy filter set.
 *
 * Two of the six do not translate as a single term:
 *
 * - `category` and `kind` were multi-select ORs, and the language has no OR. One value
 *   translates exactly; several cannot, so the FIRST is kept and the rest are reported. Losing
 *   a filter silently would be worse than dropping to a broader view and saying so.
 * - `min` was a fraction and `chance:` is a percentage, so it is scaled here rather than
 *   carried across at 100× its meaning.
 */
export function toQueryText(params: LegacyParams): { query: string; dropped: string[] } {
  const terms: string[] = []
  const dropped: string[] = []

  if (params.q !== undefined && params.q !== null && params.q !== '') terms.push(params.q)

  const categories = params.category ?? []
  const first = categories[0]
  if (first !== undefined) {
    terms.push(term('cat', first))
    if (categories.length > 1) dropped.push(...categories.slice(1).map((value) => `cat:${value}`))
  }

  const kinds = params.kind ?? []
  const firstKind = kinds[0]
  if (firstKind !== undefined) {
    terms.push(term('from', firstKind))
    if (kinds.length > 1) dropped.push(...kinds.slice(1).map((value) => `from:${value}`))
  }

  if (params.min != null && params.min > 0) {
    // Stored 0..1, typed as a percentage. Trailing zeroes trimmed so 0.05 reads as >=5.
    const percent = Number((params.min * 100).toFixed(4))
    terms.push(`chance:>=${String(percent)}`)
  }

  if (params.tradable === true) terms.push('is:tradable')
  // "Farmable now" was the negation all along: hide paths through a vaulted relic.
  if (params.farmable === true) terms.push('-is:vaulted')

  return { query: terms.join(' '), dropped }
}

/** Reads the legacy shape straight off a URL, for the one-shot migration on mount. */
export function readLegacyParams(params: URLSearchParams): LegacyParams {
  const list = (key: string): string[] =>
    (params.get(key) ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value !== '')

  const min = Number(params.get('min'))

  return {
    q: params.get('q'),
    category: list('category'),
    kind: list('kind'),
    min: Number.isFinite(min) ? min : 0,
    tradable: params.get('tradable') === 'true',
    farmable: params.get('farmable') === 'true',
  }
}
