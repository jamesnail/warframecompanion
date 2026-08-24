import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,

  // The workspace root, not apps/web — otherwise file tracing misses the linked
  // workspace packages and the standalone output drops @provenance/core.
  // fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..." with
  // percent-encoded spaces, which Turbopack cannot canonicalize.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),

  // core ships as TypeScript source rather than a built dist, so Next compiles it.
  transpilePackages: ['@provenance/core'],

  async headers() {
    return [
      {
        // Data chunks are content-addressed (<name>.<hash>.json), so they can be
        // cached forever. CLAUDE.md § Deployment.
        // Double-escaped: in a JS string literal "\." collapses to "." before the regex
        // ever sees it, which turned both separators into "any character".
        source: '/data/:file(.*\\.[0-9a-f]+\\.json)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // The manifest is the only mutable file; it is how clients learn a new hash exists.
        source: '/data/manifest.json',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ]
  },
}

export default config
