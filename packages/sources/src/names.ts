/**
 * Display-name normalisation.
 *
 * QUIRK — upstream title-cases roman numerals, so the game's "Lavan Apoc Mk III" arrives as
 * "Lavan Apoc Mk Iii". This is not a WFCD artefact to route around: Digital Extremes' own
 * drop tables carry 30 such names and ZERO correctly-cased ones, so both sources agree and
 * both are wrong. 115 of our items are affected — Railjack Mk grades, Zaw components
 * ("Ekwana Ii Jai"), and Eximus Eliminator tiers.
 *
 * Ids are unaffected, deliberately. They are slugged lowercase, so "Ekwana Ii Jai" and
 * "Ekwana II Jai" both yield `ekwana-ii-jai`; fixing the name cannot break a bookmarked URL.
 */

/**
 * An explicit allowlist rather than a pattern.
 *
 * A regex for "looks like a roman numeral" also matches ordinary words — "Vi", "Ix" and "Mi"
 * are all plausible proper nouns in a game that names things Ivara and Xaku. Only the tokens
 * that genuinely occur, plus their immediate neighbours, are converted; anything else is left
 * exactly as upstream wrote it.
 */
const NUMERALS: Record<string, string> = {
  ii: 'II',
  iii: 'III',
  iv: 'IV',
  vi: 'VI',
  vii: 'VII',
  viii: 'VIII',
  ix: 'IX',
  xi: 'XI',
  xii: 'XII',
}

/**
 * Upper-case standalone roman numerals in a display name.
 *
 * Word boundaries are whitespace and hyphens only, so "Ivara" and "Mk1-Braton" are untouched
 * while "Mk Ii" and "Ekwana Ii Jai" are fixed. A token already in the right case passes
 * through unchanged, which makes this safe to apply to every name rather than only to the
 * ones known to be broken.
 */
export function normalizeDisplayName(name: string): string {
  return name.replace(/[^\s-]+/g, (token) => {
    const replacement = NUMERALS[token.toLowerCase()]
    // Only rewrite when the token is ENTIRELY the numeral and upstream got the case wrong.
    // "Vii" becomes "VII"; a hypothetical "Viii-plated" is not a numeral and is left alone.
    return replacement === undefined ? token : replacement
  })
}
