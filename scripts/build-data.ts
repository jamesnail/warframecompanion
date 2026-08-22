/**
 * Pipeline entrypoint. Run by CI (daily) and by hand via `pnpm data:build`.
 *
 * Phase 2 fills this in. The contract it must honour (CLAUDE.md § The pipeline is the product):
 *   - every fetch retried with backoff and a hard timeout
 *   - every payload Zod-parsed before use; schema drift fails the build
 *   - sanity gates before writing anything; exit nonzero and commit nothing on failure
 *   - content-addressed output: <name>.<hash>.json plus a manifest carrying the build hash
 *
 * Until then this is a deliberate no-op that exits clean, so the workflow and the script
 * wiring can be verified before there is any data to move.
 */

const isDiff = process.argv.includes('--diff')

console.log(
  isDiff
    ? 'data:diff — pipeline not implemented yet (Phase 2). Nothing to compare.'
    : 'data:build — pipeline not implemented yet (Phase 2). Nothing written.',
)
