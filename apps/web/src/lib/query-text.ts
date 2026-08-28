import { parseQuery, printQuery, type Term } from '@provenance/core'

/**
 * Editing query TEXT through the parsed tree, so the filter chips and the input box are the
 * same object rather than two representations that can disagree.
 *
 * A chip toggling `cat:mod` and a person typing `cat:mod` must produce the identical URL —
 * otherwise the chip is a second source of truth, which is exactly what constraint 5 forbids.
 */

function sameTerm(a: Term, b: Term): boolean {
  if (a.type !== b.type || a.negated !== b.negated) return false
  if (a.type === 'word' && b.type === 'word') return a.text === b.text
  if (a.type === 'predicate' && b.type === 'predicate') {
    if (a.key !== b.key) return false
    if (a.value.kind === 'text' && b.value.kind === 'text') return a.value.text === b.value.text
    if (a.value.kind === 'compare' && b.value.kind === 'compare') {
      return a.value.compare.op === b.value.compare.op && a.value.compare.value === b.value.compare.value
    }
  }
  return false
}

/** Whether the query already contains this exact term, so a chip can render as pressed. */
export function hasTerm(text: string, term: string): boolean {
  const wanted = parseQuery(term).query.terms[0]
  if (wanted === undefined) return false
  return parseQuery(text).query.terms.some((existing) => sameTerm(existing, wanted))
}

/**
 * Add the term if absent, remove it if present.
 *
 * Removal drops every copy: typing `cat:mod` twice and then clicking the chip should leave
 * none behind, not one.
 */
export function toggleTerm(text: string, term: string): string {
  const wanted = parseQuery(term).query.terms[0]
  if (wanted === undefined) return text

  const current = parseQuery(text).query
  const without = current.terms.filter((existing) => !sameTerm(existing, wanted))
  if (without.length !== current.terms.length) return printQuery({ terms: without })
  return printQuery({ terms: [...current.terms, wanted] })
}

/** Replace the token under the caret with a completion, leaving a trailing space to type on. */
export function applySuggestion(
  text: string,
  tokenStart: number,
  tokenLength: number,
  insert: string,
): string {
  const before = text.slice(0, tokenStart)
  const after = text.slice(tokenStart + tokenLength)
  // A value completion is finished, so it earns a space; a bare `key:` still needs its value.
  const trailing = insert.endsWith(':') ? '' : ' '
  return `${before}${insert}${trailing}${after}`.replace(/\s+$/, trailing === ' ' ? ' ' : '')
}
