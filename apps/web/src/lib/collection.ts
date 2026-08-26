/**
 * Set-completion math, kept pure so the numbers can be tested without a browser.
 *
 * A recipe's progress is counted in DISTINCT components, not in units. "Orokin Cell ×10"
 * is one thing to go and get; counting it as ten would make every prime weapon read as 7%
 * complete when the only real work left is one resource run, and would rank a set needing
 * 10 Cells above one needing four unfarmed prime parts.
 */

export interface RecipeComponent {
  itemId: string
  count: number
}

export interface SetProgress {
  owned: number
  total: number
  /** 0..1. Total is never 0 for a real recipe, but a guard beats a NaN in the UI. */
  fraction: number
  complete: boolean
  /** Component ids still needed, in the recipe's own order. */
  missing: string[]
}

export function progressOf(
  components: readonly RecipeComponent[],
  owned: ReadonlySet<string>,
): SetProgress {
  const missing = components.filter((c) => !owned.has(c.itemId)).map((c) => c.itemId)
  const total = components.length
  const have = total - missing.length
  return {
    owned: have,
    total,
    fraction: total === 0 ? 0 : have / total,
    complete: total > 0 && missing.length === 0,
    missing,
  }
}

/**
 * Order sets by how close they are to done, nearest first.
 *
 * Ties break on fewest components remaining and then on name, so the list is a total order
 * and does not reshuffle between renders. A set with nothing owned sorts last rather than
 * first: the point of the view is "what can I finish", not "what could I start".
 */
export function byClosest<T extends { name: string; progress: SetProgress }>(a: T, b: T): number {
  if (a.progress.complete !== b.progress.complete) return a.progress.complete ? -1 : 1
  if (a.progress.owned === 0 !== (b.progress.owned === 0)) return a.progress.owned === 0 ? 1 : -1
  if (b.progress.fraction !== a.progress.fraction) return b.progress.fraction - a.progress.fraction
  const remaining = a.progress.missing.length - b.progress.missing.length
  if (remaining !== 0) return remaining
  return a.name.localeCompare(b.name)
}
