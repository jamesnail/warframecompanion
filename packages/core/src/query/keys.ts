import { ItemCategory, RelicTier, SourceKind } from '../types'
import type { Comparison, QueryItem, QueryPath, TermValue } from './types'

/**
 * The key registry: one entry per filter key, owning its value space and both grain
 * evaluators. Adding a key is one object here plus a test — which is the whole argument for
 * building the language before the market work rather than after (`price:` lands as an entry).
 *
 * Every key below is backed by a field measured on the shipped data, not on the schema. Four
 * keys a player would plausibly type are deliberately ABSENT because their fields are empty:
 * `faction:`, `tileset:`, `level:` and `is:steelpath` are declared in types.ts and populated on
 * 0 of 2,417 sources. A key that silently matches nothing is worse than a missing key, because
 * a reader takes an empty result for an answer.
 */

export type ValueKind = 'enum' | 'text' | 'number'

export interface KeyDef {
  key: string
  /** Human-facing one-liner, shown in completion. */
  hint: string
  valueKind: ValueKind
  /** Closed value space, lowercased. Present for `enum` keys only — this is what makes
   *  "did you mean" possible: at most 14 candidates to search. */
  values?: readonly string[]
  /** Evaluated against an item and its rolled-up paths. Always present: every key answers
   *  at the item grain, existentially where the fact belongs to a path. */
  item: (item: QueryItem, value: TermValue) => boolean
  /** Evaluated against a single path. Absent when the key is item-only, in which case the
   *  path is judged by its item via `item()`. */
  path?: (path: QueryPath, value: TermValue) => boolean
}

/** Enum values are compared lowercased, so `cat:Warframe` and `cat:warframe` agree. */
const lower = (values: readonly string[]): readonly string[] => values.map((v) => v.toLowerCase())

const text = (value: TermValue): string => (value.kind === 'text' ? value.text : '')

function compare(actual: number, comparison: Comparison): boolean {
  switch (comparison.op) {
    case '<':
      return actual < comparison.value
    case '<=':
      return actual <= comparison.value
    case '>':
      return actual > comparison.value
    case '>=':
      return actual >= comparison.value
  }
}

/**
 * A numeric term is either a comparison or a bare number meaning equality.
 *
 * `undefined` never matches: an item with no mastery requirement is not "MR 0", it is an item
 * the concept does not apply to, and `mr:<8` returning every mod in the game would be wrong.
 */
function matchNumber(actual: number | undefined, value: TermValue): boolean {
  if (actual === undefined) return false
  if (value.kind === 'compare') return compare(actual, value.compare)
  const wanted = Number(value.text)
  return Number.isFinite(wanted) && actual === wanted
}

/** Chance is stored 0..1 and typed as a percentage, because nobody types `chance:>0.05`. */
function matchChance(actual: number, value: TermValue): boolean {
  if (value.kind === 'compare') {
    return compare(actual * 100, value.compare)
  }
  const wanted = Number(value.text)
  return Number.isFinite(wanted) && Math.abs(actual * 100 - wanted) < 1e-9
}

const has = (set: ReadonlySet<string>, value: TermValue): boolean => set.has(text(value))

const is = (flag: boolean): boolean => flag

/**
 * `is:` and `has:` are flag namespaces rather than keys with open values, so their entries
 * live in one table and both keys share the lookup.
 */
const FLAGS: Record<string, { item: (item: QueryItem) => boolean; path: (path: QueryPath) => boolean }> = {
  prime: { item: (i) => is(i.isPrime), path: (p) => is(p.isPrime) },
  set: { item: (i) => is(i.isSet), path: (p) => is(p.isSet) },
  tradable: { item: (i) => is(i.tradable), path: (p) => is(p.tradable) },
  vaulted: { item: (i) => is(i.vaulted), path: (p) => is(p.vaulted) },
  market: { item: (i) => is(i.hasMarket), path: (p) => is(p.hasMarket) },
}

const FLAG_NAMES = Object.keys(FLAGS)

function flagFor(value: TermValue): ((item: QueryItem) => boolean) | undefined {
  return FLAGS[text(value)]?.item
}

function flagPathFor(value: TermValue): ((path: QueryPath) => boolean) | undefined {
  return FLAGS[text(value)]?.path
}

export const KEYS: readonly KeyDef[] = [
  {
    key: 'cat',
    hint: 'Item category',
    valueKind: 'enum',
    values: lower(ItemCategory.options),
    item: (item, value) => item.category.toLowerCase() === text(value),
    path: (path, value) => path.category.toLowerCase() === text(value),
  },
  {
    key: 'from',
    hint: 'Kind of source it drops from',
    valueKind: 'enum',
    values: lower(SourceKind.options),
    item: (item, value) => has(item.kinds, value),
    path: (path, value) => path.kind.toLowerCase() === text(value),
  },
  {
    key: 'planet',
    hint: 'Planet the source is on',
    valueKind: 'text',
    item: (item, value) => has(item.planets, value),
    path: (path, value) => (path.planet ?? '').toLowerCase() === text(value),
  },
  {
    key: 'tier',
    hint: 'Relic tier',
    valueKind: 'enum',
    values: lower(RelicTier.options),
    item: (item, value) => has(item.tiers, value),
    path: (path, value) => (path.tier ?? '').toLowerCase() === text(value),
  },
  {
    key: 'rotation',
    hint: 'Reward rotation',
    valueKind: 'enum',
    values: ['a', 'b', 'c'],
    item: (item, value) => has(item.rotations, value),
    path: (path, value) => (path.rotation ?? '').toLowerCase() === text(value),
  },
  {
    key: 'mr',
    hint: 'Mastery rank required',
    valueKind: 'number',
    item: (item, value) => matchNumber(item.masteryReq, value),
    path: (path, value) => matchNumber(path.masteryReq, value),
  },
  {
    key: 'chance',
    hint: 'Drop chance, as a percentage',
    valueKind: 'number',
    // At item grain this asks about the BEST path, which is the only reading that makes
    // `chance:>10` useful: an item with one great source and forty poor ones is a good target.
    item: (item, value) => matchChance(item.bestChance, value),
    path: (path, value) => matchChance(path.chance, value),
  },
  {
    key: 'source',
    hint: 'Text in the source name',
    valueKind: 'text',
    item: (item, value) => item.sourceText.includes(text(value)),
    // Path grain has one source, and its name is already in the row haystack.
    path: (path, value) => path.haystack.includes(text(value)),
  },
  {
    key: 'is',
    hint: 'A property of the item',
    valueKind: 'enum',
    values: FLAG_NAMES,
    item: (item, value) => flagFor(value)?.(item) ?? false,
    path: (path, value) => flagPathFor(value)?.(path) ?? false,
  },
  {
    // A deliberate alias of `is:`, sharing one value space. Players type both, and rejecting
    // `has:prime` to be tidy would be a parse error in service of nothing.
    key: 'has',
    hint: 'Something the item has',
    valueKind: 'enum',
    values: FLAG_NAMES,
    item: (item, value) => flagFor(value)?.(item) ?? false,
    path: (path, value) => flagPathFor(value)?.(path) ?? false,
  },
]

/**
 * Keys whose answer comes from an item's PATHS rather than from the item itself.
 *
 * The palette loads the 1.1 MB item chunk and not the 3.9 MB edge chunk, because pulling the
 * edge list to power a search box would blow the two-second cold-load budget for nothing
 * (DESIGN.md § 6). These keys are the ones that cannot be answered without it, so a surface
 * holding items alone can tell when it needs to go and fetch more rather than silently
 * matching nothing — which would be a filter that lies.
 */
const PATH_KEYS = new Set(['from', 'planet', 'tier', 'rotation', 'chance', 'source'])

export function termNeedsPaths(key: string, value: TermValue): boolean {
  if (PATH_KEYS.has(key)) return true
  // Vaulted is a path fact for everything except a relic, which carries the flag itself.
  return (key === 'is' || key === 'has') && text(value) === 'vaulted'
}

const BY_KEY = new Map(KEYS.map((def) => [def.key, def]))

export function keyDef(key: string): KeyDef | undefined {
  return BY_KEY.get(key.toLowerCase())
}

export function keyNames(): string[] {
  return KEYS.map((def) => def.key)
}
