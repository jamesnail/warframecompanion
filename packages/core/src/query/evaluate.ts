import { keyDef, termNeedsPaths } from './keys'
import type { Query, QueryItem, QueryPath, Term } from './types'

/**
 * Compile a parsed query into two matchers, one per grain.
 *
 * Predicates compile ONCE per query, not once per row: this returns an array of closures and
 * the row loop calls them. Over the 28,020-row edge table that is the difference between
 * ~0.4 ms per keystroke and something you can feel.
 */

export interface CompileOptions {
  /**
   * How to treat bare words.
   *
   * `'match'` tests them as substrings of the haystack — right for a table filter, where you
   * are narrowing a set you can already see and a fuzzy hit returns rows you did not ask for
   * and cannot explain.
   *
   * `'ignore'` leaves them out, for a caller that has already applied its own matcher. The
   * palette does this: it runs uFuzzy over names first, because there you are recalling one
   * name out of 4,875 and a typo should still find it.
   */
  words?: 'match' | 'ignore'
}

export interface CompiledQuery {
  /** How many terms actually compiled. Zero means "no constraint", so callers can skip work. */
  size: number
  matchItem: (item: QueryItem) => boolean
  matchPath: (path: QueryPath) => boolean
}

const ALWAYS = (): boolean => true

/**
 * Whether this query can be answered from items alone, or needs the drop-edge chunk.
 *
 * Lets the palette stay on its 1.1 MB item chunk for `is:prime cat:warframe` and fetch the
 * rest only when someone types `from:relic` — rather than either loading 5 MB up front or
 * silently returning nothing for half the language.
 */
export function queryNeedsPaths(query: Query): boolean {
  return query.terms.some(
    (term) => term.type === 'predicate' && termNeedsPaths(term.key, term.value),
  )
}

export function compileQuery(query: Query, options: CompileOptions = {}): CompiledQuery {
  const words = options.words ?? 'match'

  const itemTests: ((item: QueryItem) => boolean)[] = []
  const pathTests: ((path: QueryPath) => boolean)[] = []

  for (const term of query.terms) {
    if (term.type === 'word') {
      if (words === 'ignore') continue
      const needle = term.text
      itemTests.push(negate(term, (item) => item.haystack.includes(needle)))
      pathTests.push(negate(term, (path) => path.haystack.includes(needle)))
      continue
    }

    const definition = keyDef(term.key)
    // Unreachable for a query that came from parseQuery, which rejects unknown keys — but a
    // hand-built Query must not silently widen the result set to everything.
    if (definition === undefined) continue

    const value = term.value
    itemTests.push(negate(term, (item) => definition.item(item, value)))

    // A key with no path evaluator is item-only (mr:), and a path inherits its item's answer.
    // `definition.path` is the narrower reading where one exists.
    const onPath = definition.path
    pathTests.push(
      onPath === undefined
        ? negate(term, (path) => definition.item(pathAsItem(path), value))
        : negate(term, (path) => onPath(path, value)),
    )
  }

  return {
    size: itemTests.length,
    matchItem: itemTests.length === 0 ? ALWAYS : (item) => itemTests.every((test) => test(item)),
    matchPath: pathTests.length === 0 ? ALWAYS : (path) => pathTests.every((test) => test(path)),
  }
}

function negate<T>(term: Term, test: (value: T) => boolean): (value: T) => boolean {
  return term.negated ? (value) => !test(value) : test
}

/**
 * A path viewed as a one-path item, so an item-only key can be evaluated against a row.
 *
 * The sets are singletons rather than empty: `from:relic` reaching this way must still answer
 * for the path's own source. This is only ever called for keys with no path evaluator, so it
 * is off the hot loop for every key that has one.
 */
function pathAsItem(path: QueryPath): QueryItem {
  return {
    id: '',
    name: path.itemName,
    haystack: path.haystack,
    category: path.category,
    tradable: path.tradable,
    hasMarket: path.hasMarket,
    isPrime: path.isPrime,
    isSet: path.isSet,
    masteryReq: path.masteryReq,
    vaulted: path.vaulted,
    kinds: new Set([path.kind.toLowerCase()]),
    planets: new Set(path.planet === undefined ? [] : [path.planet.toLowerCase()]),
    tiers: new Set(path.tier === undefined ? [] : [path.tier.toLowerCase()]),
    rotations: new Set(path.rotation === undefined ? [] : [path.rotation.toLowerCase()]),
    sourceText: path.haystack,
    bestChance: path.chance,
  }
}
