/**
 * Build-time fetchers and parsers. Node-only.
 *
 * NEVER imported by apps/web or packages/core — enforced by the restricted-path zones in
 * eslint.config.mjs. Everything DE-facing lives behind this boundary so that no CORS
 * assumption, LZMA decompressor, or multi-megabyte HTML parse can ever reach the browser
 * (CLAUDE.md constraint 2).
 */

export * from './fetch'
export * from './slug'
export * from './names'
export * from './nodes'
export * from './upstream'
export * from './relics'
export * from './missions'
export * from './items'
export * from './tables'
export * from './aggregate'
export * from './enrich'
export * from './sets'
export * from './rivens'
export * from './market'
export * from './prices'
export * from './price-sweep'
