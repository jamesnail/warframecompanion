/**
 * The query language's data model: what a parsed query is, and what it is evaluated against.
 *
 * Two projections, because the language is defined over ITEMS and lifted to paths — see the
 * design doc § 3. The short version: all 50 prime Warframes have zero drop edges of their own,
 * so a language evaluated only over edges returns nothing for "prime warframes", which is the
 * question the feature exists to answer.
 *
 * Both projections are declared here rather than in `apps/web` so `packages/core` stays free of
 * view models while still owning every predicate.
 */

/** A numeric comparison, as written. `chance:>5` parses to `{ op: '>', value: 5 }`. */
export interface Comparison {
  op: '<' | '<=' | '>' | '>='
  value: number
}

export type TermValue =
  | { kind: 'text'; text: string }
  | { kind: 'compare'; compare: Comparison }

export type Term =
  /** A bare word or quoted phrase: matched against names, never against a field. */
  | { type: 'word'; negated: boolean; text: string }
  | { type: 'predicate'; negated: boolean; key: string; value: TermValue }

export interface Query {
  terms: readonly Term[]
}

export const EMPTY_QUERY: Query = { terms: [] }

export type QueryErrorKind =
  | 'unknown-key'
  | 'unknown-value'
  | 'empty-value'
  | 'bad-number'
  | 'unterminated-quote'
  | 'dangling-negation'

/**
 * A parse failure, carrying enough to render it inline.
 *
 * `start`/`end` index into the ORIGINAL query string so the input can underline the exact
 * run of characters that failed rather than highlighting the whole box.
 */
export interface QueryError {
  kind: QueryErrorKind
  /** The token as the user typed it. */
  token: string
  start: number
  end: number
  message: string
  /** Nearest legal alternative, where the value space is closed and small enough to search. */
  suggestion?: string
}

export interface ParseResult {
  query: Query
  errors: readonly QueryError[]
}

/**
 * One item, with the facts about its drop paths already rolled up.
 *
 * The sets are the existential lift: `kinds` holds every source kind that reaches this item,
 * so `from:relic` is a set membership test rather than a scan over edges. Building this index
 * once per dataset load is what keeps evaluation at a fraction of a millisecond.
 */
export interface QueryItem {
  id: string
  name: string
  /** Lowercased name, for bare-word matching without re-lowercasing per keystroke. */
  haystack: string
  category: string
  tradable: boolean
  hasMarket: boolean
  isPrime: boolean
  isSet: boolean
  masteryReq: number | undefined
  /**
   * For a relic, the relic itself is vaulted. For anything else, EVERY path to it runs through
   * a vaulted relic — an item reachable through one live relic and four vaulted ones is not
   * vaulted, because one live path is all you need. An item with no path at all is not vaulted
   * either; it is simply not dropped.
   */
  vaulted: boolean
  kinds: ReadonlySet<string>
  planets: ReadonlySet<string>
  tiers: ReadonlySet<string>
  rotations: ReadonlySet<string>
  /** Lowercased source names, joined. `source:cambria` is a substring test over this. */
  sourceText: string
  /** Best single-path chance, 0..1. `chance:>10` at item grain asks about the best path. */
  bestChance: number
  /**
   * How many paths reach this item at all, its parts' paths included. Zero for the 1,046
   * items nothing drops — 737 vaulted relics and 309 assembled sets — which is a fact worth
   * showing rather than a row worth hiding.
   */
  paths: number
  /**
   * The single best path, for a surface that shows one row per item rather than one per path.
   *
   * `via` names the PART the path actually runs through, where the item itself is not the
   * thing that drops. Ash Prime's best path is an Axi relic that contains a systems
   * blueprint, and a row reading "Ash Prime — Axi A11" without saying so claims the relic
   * drops the frame.
   */
  best: { sourceId: string; sourceName: string; via: string | undefined } | undefined
  /**
   * Cheapest live asking price in platinum, or undefined when the item is not traded, has no
   * live seller, or the price chunk was not loaded on this surface.
   *
   * Undefined never matches `price:`, for the same reason `mr:` behaves that way: an item
   * nobody is selling is not "free", and `price:<10` returning every untraded item in the
   * game would be wrong.
   */
  price: number | undefined
}

/**
 * One path — one item from one source. The `/browse` row grain.
 *
 * Every field is singular where `QueryItem`'s is a set: a path has exactly one source kind,
 * so the same key reads as "is" here and as "has at least one" there.
 */
export interface QueryPath {
  itemName: string
  haystack: string
  category: string
  tradable: boolean
  hasMarket: boolean
  isPrime: boolean
  isSet: boolean
  masteryReq: number | undefined
  vaulted: boolean
  kind: string
  planet: string | undefined
  tier: string | undefined
  rotation: string | undefined
  chance: number
  price: number | undefined
}
