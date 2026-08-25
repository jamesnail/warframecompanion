import { resolve } from 'node:path'

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importX from 'eslint-plugin-import-x'

/**
 * Package boundaries are architecture, not style (CLAUDE.md § Layout):
 *   - packages/sources is Node-only build tooling. It must never reach the browser.
 *   - packages/core is pure and isomorphic, so it must not depend on build tooling either.
 * Enforced with restricted-path zones rather than convention, because a single stray
 * import would pull an `lzma` dependency into the client bundle.
 *
 * Uses eslint-plugin-import-x, not eslint-plugin-import: the latter's peer range stops
 * at ESLint 9 and this workspace is on ESLint 10. Same rule, maintained fork.
 */
/**
 * Zones MUST be absolute, anchored to this config file.
 *
 * Relative zone paths are resolved against process.cwd(), and `pnpm lint` runs
 * `eslint src` with the cwd set to each package — so from inside apps/web the zone
 * './apps/web' matched nothing and the rule silently passed every violating import.
 * It only appeared to work when eslint was invoked from the repo root by hand.
 */
const pkg = (...segments) => resolve(import.meta.dirname, ...segments)

const boundaryZones = [
  {
    target: pkg('packages', 'core'),
    from: pkg('packages', 'sources'),
    message: 'packages/core is pure and isomorphic. Move the shared helper into core itself.',
  },
  {
    target: pkg('apps', 'web'),
    from: pkg('packages', 'sources'),
    message: 'packages/sources is Node-only build tooling and must never ship to the browser.',
  },
]

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/public/data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': { typescript: true, node: true },
    },
    rules: {
      'import-x/no-restricted-paths': ['error', { zones: boundaryZones }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // CLAUDE.md constraint 6 is strictest inside core, where the domain types live.
    files: ['packages/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    /**
     * Config files are plain JS and belong to no compiler project, so type-aware rules
     * have nothing to work with.
     *
     * scripts/** used to be listed here too, and that was the wrong trade: the pipeline
     * entrypoint decides what ships to 4800 pages, and it was getting the weakest checking
     * in the repo. It now has a tsconfig (see tsconfig.json), so it gets the full rule set
     * like everything else.
     */
    files: ['**/*.config.{mjs,ts}'],
    ...tseslint.configs.disableTypeChecked,
  },
)
