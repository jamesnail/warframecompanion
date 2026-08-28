/**
 * What one attempt at a source is called.
 *
 * Every effort figure on the site — "expected runs", "best chance / run", the third table
 * column — counts repetitions of a single act. For a mission or a bounty that act is a run.
 * For an enemy it is a kill, and calling it a run is wrong in a way players notice: nobody
 * queues one Corrupted Heavy Gunner, and "expected runs: 51" for a mod that drops from an
 * eximus unit reads as fifty-one missions when it means fifty-one bodies.
 *
 * So the noun follows the source kind. Only `enemy` is a kill; everything else is a run,
 * including `cache` and `transient`, where the thing being repeated really is the mission
 * you queue to reach the objective.
 *
 * The lowercase forms are the primitives — `attemptLabel` and `attemptColumn` exist so two
 * pages cannot drift on the casing of the same word.
 */

export interface AttemptNoun {
  /** "run" / "kill" — for "best chance / run". */
  one: string
  /** "runs" / "kills" — for "expected runs". */
  many: string
  /** "Run" / "Kill" — the imperative, for the chain trace's step kicker. */
  imperative: string
  /** "Runs" / "Kills" — for a column heading, so no two call sites case it differently. */
  column: string
}

const RUN: AttemptNoun = { one: 'run', many: 'runs', imperative: 'Run', column: 'Runs' }
const KILL: AttemptNoun = { one: 'kill', many: 'kills', imperative: 'Kill', column: 'Kills' }

/** The noun for one source kind. Unknown or absent kinds fall back to the run, which is the
 *  common case and the only safe guess. */
export function attemptNoun(kind: string | undefined): AttemptNoun {
  return kind === 'enemy' ? KILL : RUN
}

/**
 * The noun for a set of source kinds, or `undefined` where they disagree.
 *
 * 492 of the 3,829 items with a source mix enemy drops with mission or bounty drops, so a
 * table listing every source of one item genuinely has no single noun for its effort column.
 * Callers handle that case rather than picking one and being wrong on half the rows.
 */
export function attemptNounFor(kinds: Iterable<string>): AttemptNoun | undefined {
  let seen: AttemptNoun | undefined
  for (const kind of kinds) {
    const noun = attemptNoun(kind)
    if (seen === undefined) seen = noun
    else if (seen !== noun) return undefined
  }
  return seen
}

/**
 * The noun for a count. A 100%-drop boss is one kill, not "1 kills".
 *
 * Pre-existing bug, found while adding the kill/run split: /farm read "1 runs for the
 * cheapest" on any guaranteed drop and nobody had noticed because the word was a literal.
 */
export function attemptPlural(count: number, noun: AttemptNoun): string {
  return count === 1 ? noun.one : noun.many
}

/** "Expected runs" / "Expected kills". */
export function attemptLabel(prefix: string, noun: AttemptNoun): string {
  return `${prefix} ${noun.many}`
}

/**
 * The heading for an effort column.
 *
 * Where the rows disagree the heading names both, in the order the row's own detail line
 * already distinguishes them — every row on those tables is tagged "Enemy" or with its
 * mission type, so the reader has the discriminator in front of them. Naming both beats
 * inventing a third neutral noun ("attempts", "tries") that appears nowhere else in the
 * game's vocabulary.
 */
export function attemptColumn(kinds: Iterable<string>): string {
  return attemptNounFor(kinds)?.column ?? 'Runs / kills'
}
