import {
  compileQuery,
  parseQuery,
  queryNeedsPaths,
  queryWords,
  type QueryError,
  type QueryItem,
} from '@provenance/core'

import type { SearchHit, SearchIndex } from './search-index'

/**
 * The palette's half of the query language: fuzzy names, filtered by predicates.
 *
 * The split matters. Bare words go through uFuzzy, because in the palette you are recalling
 * one name out of 4,875 and a typo should still find it. Predicates are then applied to those
 * hits at item grain. Running the words through the predicate evaluator as substrings too
 * would apply them twice and undo the fuzziness.
 */

export interface PaletteResult {
  hits: SearchHit[]
  total: number
  errors: readonly QueryError[]
  /** The query asked about drop paths, which need the edge chunk this index may not have. */
  needsPaths: boolean
}

const EMPTY: PaletteResult = { hits: [], total: 0, errors: [], needsPaths: false }

export function runPaletteQuery(
  input: string,
  index: SearchIndex,
  itemsById: ReadonlyMap<string, QueryItem>,
  limit = 20,
): PaletteResult {
  const { query, errors } = parseQuery(input)
  if (query.terms.length === 0) return { ...EMPTY, errors }

  const words = queryWords(query).join(' ')
  // `words: 'ignore'` because uFuzzy has already had them — see the note above.
  const compiled = compileQuery(query, { words: 'ignore' })
  const needsPaths = queryNeedsPaths(query)

  /**
   * A query with predicates but no words is a browse, not a search: "every prime Warframe"
   * names nothing. uFuzzy has no needle to work with, so the whole corpus is the candidate
   * set and the predicates do the narrowing.
   */
  const candidates: SearchHit[] =
    words === ''
      ? index.all()
      : // Fuzzy first, unlimited, so the predicates filter the full match set rather than
        // whatever happened to fall in the first 20 rows.
        index.search(words, Number.POSITIVE_INFINITY).hits

  if (compiled.size === 0) {
    return { hits: candidates.slice(0, limit), total: candidates.length, errors, needsPaths }
  }

  const hits: SearchHit[] = []
  let total = 0
  for (const hit of candidates) {
    const item = itemsById.get(hit.id)
    if (item === undefined || !compiled.matchItem(item)) continue
    total += 1
    if (hits.length < limit) hits.push(hit)
  }

  return { hits, total, errors, needsPaths }
}
