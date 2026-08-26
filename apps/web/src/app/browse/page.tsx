import { Suspense } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { SearchTrigger } from '@/components/CommandPalette'
import { BrowseTable } from '@/components/BrowseTable'

export const metadata: Metadata = {
  title: 'Browse every drop',
  description:
    'Every item and every source that drops it, filterable by category, source and drop rate.',
  // Bare /browse, so the many filtered permutations consolidate onto one indexable page
  // instead of competing with each other for the same content.
  alternates: { canonical: '/browse' },
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

      <div className="mt-8">
        <Suspense fallback={<p className="label">Loading…</p>}>
          <BrowseTable />
        </Suspense>
      </div>
    </div>
  )
}
