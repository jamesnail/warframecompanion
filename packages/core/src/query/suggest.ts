import { KEYS, keyDef } from './keys'

/**
 * Completion for the query input.
 *
 * The whole mitigation for "the palette becomes a syntax to learn" is that you never have to
 * learn it: type a letter, see the keys; type a colon, see the values. Bare words keep working
 * exactly as they did, so the language is additive rather than a new thing to know.
 */

export interface Suggestion {
  /** What to insert in place of the token being typed. */
  insert: string
  /** What to show. Same as `insert` for keys; the bare value for values. */
  label: string
  hint: string
}

/** The token under the caret — everything back to the last unquoted space. */
export function activeToken(input: string, caret: number): { text: string; start: number } {
  const upto = input.slice(0, caret)
  const start = upto.lastIndexOf(' ') + 1
  return { text: upto.slice(start), start }
}

/**
 * Suggestions for a partially typed token.
 *
 * Returns keys while the token has no colon, and that key's values once it does. Enum keys
 * have a closed value space and are the only ones worth completing — `planet:` and `source:`
 * take free text, where a list would either be wrong or enormous.
 */
export function suggest(token: string): Suggestion[] {
  const bare = token.startsWith('-') ? token.slice(1) : token
  const prefix = token.startsWith('-') ? '-' : ''
  const colon = bare.indexOf(':')

  if (colon === -1) {
    const needle = bare.toLowerCase()
    return KEYS.filter((definition) => definition.key.startsWith(needle)).map((definition) => ({
      insert: `${prefix}${definition.key}:`,
      label: `${definition.key}:`,
      hint: definition.hint,
    }))
  }

  const key = bare.slice(0, colon).toLowerCase()
  const partial = bare.slice(colon + 1).toLowerCase()
  const definition = keyDef(key)
  if (definition?.values === undefined) return []

  return definition.values
    .filter((value) => value.startsWith(partial))
    .map((value) => ({
      insert: `${prefix}${definition.key}:${value}`,
      label: value,
      hint: definition.hint,
    }))
}

/**
 * The examples shown under an empty search box.
 *
 * Chosen to teach the three moves that matter — a flag, a negation, and a key with a value —
 * on queries a player would actually run, not on syntax demonstrations.
 */
export const QUERY_EXAMPLES: readonly { query: string; caption: string }[] = [
  { query: 'is:prime cat:warframe', caption: 'Every prime Warframe' },
  { query: 'is:prime from:relic -is:vaulted', caption: 'Prime parts you can farm today' },
  { query: 'cat:mod from:enemy chance:>5', caption: 'Mods that actually drop' },
  { query: 'tier:neo -is:vaulted', caption: 'Neo relics in rotation' },
]
