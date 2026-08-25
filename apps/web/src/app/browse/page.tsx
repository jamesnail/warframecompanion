import { Suspense } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { SearchTrigger } from '@/components/CommandPalette'
import { BrowseTable } from '@/components/BrowseTable'

export const metadata: Metadata = {
  title: 'Browse every drop',
  description:
    'Every item and every source that drops it, filterable by category, source and drop rate.',
}

/**
 * Statically prerendered like every other page (CLAUDE.md constraint 4). The shell is HTML;
 * the table hydrates and pulls its rows from /data through the same IndexedDB cache the
 * palette uses, so a second visit costs no network.
 *
 * The Suspense boundary is required, not decorative: BrowseTable reads search params, and
 * a component that does so cannot be prerendered without one.
 */
export default function BrowsePage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16">
      <nav className="label mb-6 flex items-center justify-between gap-4">
        <span>
          <Link href="/" className="transition-colors hover:text-text">
            Provenance
          </Link>
          <span className="mx-2 text-hairline-strong" aria-hidden="true">
            /
          </span>
          <span>Browse</span>
        </span>
        <SearchTrigger compact />
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">Browse</h1>
      <p className="mt-2 max-w-prose text-sm text-text-dim">
        Every drop in the game, one row per item per source. Filters live in the URL, so any
        view of this table is a link.
      </p>

      <div className="mt-8">
        <Suspense fallback={<p className="label">Loading…</p>}>
          <BrowseTable />
        </Suspense>
      </div>
    </div>
  )
}
