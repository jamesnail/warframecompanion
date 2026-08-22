/**
 * Build-time fetchers and parsers. Node-only.
 *
 * NEVER imported by apps/web or packages/core — enforced by the restricted-path zones in
 * eslint.config.mjs. Everything DE-facing lives behind this boundary so that no CORS
 * assumption, LZMA decompressor, or multi-megabyte HTML parse can ever reach the browser
 * (CLAUDE.md constraint 2).
 *
 * Populated in Phase 2.
 */

export const SOURCES_PLACEHOLDER = true
