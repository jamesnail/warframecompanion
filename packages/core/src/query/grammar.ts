import { keyDef, keyNames } from './keys'
import type { Comparison, ParseResult, Query, QueryError, Term, TermValue } from './types'

/**
 * Tokenizer and parser for the query language.
 *
 *     query      := term*
 *     term       := '-'? (predicate | phrase | word)
 *     predicate  := key ':' value
 *     value      := word | phrase | comparison
 *     comparison := ('<' | '<=' | '>' | '>=') number
 *
 * Terms are AND-ed. There is no OR and there are no parentheses, deliberately: every real
 * query written while designing this was a conjunction, and OR doubles both the parser and the
 * error surface to serve queries that a second bare word already approximates.
 *
 * Parsing NEVER throws and never discards the whole query because one term is wrong. A bad
 * term is dropped and reported; the rest still runs. The alternative — clearing the results on
 * a typo — punishes the reader mid-keystroke for a query they have not finished typing.
 */

interface RawToken {
  text: string
  start: number
  end: number
}

/** Split on whitespace, but keep double-quoted runs together. */
function tokenize(input: string): { tokens: RawToken[]; unterminated: RawToken | undefined } {
  const tokens: RawToken[] = []
  let unterminated: RawToken | undefined

  let index = 0
  while (index < input.length) {
    const character = input[index]
    if (character === undefined || /\s/.test(character)) {
      index += 1
      continue
    }

    const start = index
    let quoted = false
    let closed = true
    while (index < input.length) {
      const current = input[index]
      if (current === undefined) break
      if (current === '"') {
        // A quote opens a run that whitespace cannot end. Tracking `closed` separately from
        // `quoted` is what lets `source:"Plains of` be reported rather than silently eating
        // the rest of the line as one token.
        quoted = !quoted
        closed = !quoted
        index += 1
        continue
      }
      if (!quoted && /\s/.test(current)) break
      index += 1
    }

    const token = { text: input.slice(start, index), start, end: index }
    if (!closed) unterminated = token
    tokens.push(token)
  }

  return { tokens, unterminated }
}

/** Strip surrounding or embedded quotes once the token's extent is already known. */
function unquote(value: string): string {
  return value.replace(/"/g, '')
}

const COMPARISON = /^(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/

function parseComparison(raw: string): Comparison | undefined {
  const match = COMPARISON.exec(raw)
  if (match === null) return undefined
  const [, op, number] = match
  if (op === undefined || number === undefined) return undefined
  const value = Number(number)
  if (!Number.isFinite(value)) return undefined
  return { op: op as Comparison['op'], value }
}

/**
 * Edit distance, capped: used only to suggest a value from a closed space of at most 14
 * candidates, so the naive implementation is the right one.
 */
function distance(a: string, b: string): number {
  const rows = a.length + 1
  const columns = b.length + 1
  let previous = Array.from({ length: columns }, (_, index) => index)

  for (let row = 1; row < rows; row++) {
    const current = [row]
    for (let column = 1; column < columns; column++) {
      const substitution = (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1)
      const insertion = (current[column - 1] ?? 0) + 1
      const deletion = (previous[column] ?? 0) + 1
      current[column] = Math.min(substitution, insertion, deletion)
    }
    previous = current
  }
  return previous[columns - 1] ?? 0
}

/** Nearest candidate, or undefined when nothing is close enough to be worth offering. */
export function nearest(needle: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined
  let bestScore = Infinity
  for (const candidate of candidates) {
    const score = distance(needle, candidate)
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  // Half the word's length, floored, with a floor of 1. Loose enough that "categ" reaches
  // "cat" and "relicc" reaches "relic"; tight enough that "from:zzzzzzzz" suggests nothing,
  // which is the case that matters — a wrong suggestion is worse than none, because the
  // reader takes it for a correction rather than a guess.
  const limit = Math.max(1, Math.floor(needle.length / 2))
  return best !== undefined && bestScore <= limit ? best : undefined
}

export function parseQuery(input: string): ParseResult {
  const terms: Term[] = []
  const errors: QueryError[] = []
  const { tokens, unterminated } = tokenize(input)

  if (unterminated !== undefined) {
    errors.push({
      kind: 'unterminated-quote',
      token: unterminated.text,
      start: unterminated.start,
      end: unterminated.end,
      message: 'Unclosed quote. Add a closing " or remove the opening one.',
    })
  }

  for (const token of tokens) {
    let body = token.text
    let negated = false
    if (body.startsWith('-')) {
      negated = true
      body = body.slice(1)
    }

    // A run of nothing but minus signs is a negation with nothing to negate, however many
    // there are. Stripping one and calling the rest a word would make "--" search for "-".
    if (body === '' || body === '"' || body === '""' || /^-+$/.test(body)) {
      if (negated) {
        errors.push({
          kind: 'dangling-negation',
          token: token.text,
          start: token.start,
          end: token.end,
          message: 'Nothing to exclude. Put the term straight after the minus, as -is:vaulted.',
        })
      }
      continue
    }

    // A colon inside quotes is content, not a separator: source:"Rotation C: Stage 3".
    const separator = body.startsWith('"') ? -1 : body.indexOf(':')
    if (separator === -1) {
      terms.push({ type: 'word', negated, text: unquote(body).toLowerCase() })
      continue
    }

    const key = body.slice(0, separator).toLowerCase()
    const rawValue = body.slice(separator + 1)
    const definition = keyDef(key)

    if (definition === undefined) {
      const suggestion = nearest(key, keyNames())
      errors.push({
        kind: 'unknown-key',
        token: token.text,
        start: token.start,
        end: token.end,
        message: `Unknown filter "${key}".`,
        ...(suggestion !== undefined ? { suggestion } : {}),
      })
      continue
    }

    if (rawValue === '') {
      errors.push({
        kind: 'empty-value',
        token: token.text,
        start: token.start,
        end: token.end,
        message: `${key}: needs a value. ${definition.hint}.`,
      })
      continue
    }

    let value: TermValue
    if (definition.valueKind === 'number') {
      const comparison = parseComparison(rawValue)
      if (comparison !== undefined) {
        value = { kind: 'compare', compare: comparison }
      } else if (Number.isFinite(Number(rawValue))) {
        value = { kind: 'text', text: rawValue }
      } else {
        errors.push({
          kind: 'bad-number',
          token: token.text,
          start: token.start,
          end: token.end,
          message: `${key}: takes a number, as ${key}:>10 or ${key}:3.`,
        })
        continue
      }
    } else {
      const cleaned = unquote(rawValue).toLowerCase()
      if (definition.values !== undefined && !definition.values.includes(cleaned)) {
        const suggestion = nearest(cleaned, definition.values)
        errors.push({
          kind: 'unknown-value',
          token: token.text,
          start: token.start,
          end: token.end,
          message: `No ${key} called "${cleaned}".`,
          ...(suggestion !== undefined ? { suggestion } : {}),
        })
        continue
      }
      value = { kind: 'text', text: cleaned }
    }

    terms.push({ type: 'predicate', negated, key: definition.key, value })
  }

  return { query: { terms }, errors }
}

/** Canonical text for a parsed query. `parseQuery(printQuery(q)).query` round-trips to `q`. */
export function printQuery(query: Query): string {
  return query.terms.map(printTerm).join(' ')
}

function printTerm(term: Term): string {
  const prefix = term.negated ? '-' : ''
  if (term.type === 'word') return prefix + quoteIfNeeded(term.text)
  const value =
    term.value.kind === 'compare'
      ? `${term.value.compare.op}${String(term.value.compare.value)}`
      : quoteIfNeeded(term.value.text)
  return `${prefix}${term.key}:${value}`
}

function quoteIfNeeded(text: string): string {
  return /[\s:]/.test(text) ? `"${text}"` : text
}

/** True when the query asks for nothing, so callers can skip filtering entirely. */
export function isEmptyQuery(query: Query): boolean {
  return query.terms.length === 0
}

/** The bare words, for a caller that wants to run them through its own matcher (uFuzzy). */
export function queryWords(query: Query): string[] {
  return query.terms
    .filter((term): term is Extract<Term, { type: 'word' }> => term.type === 'word' && !term.negated)
    .map((term) => term.text)
}
