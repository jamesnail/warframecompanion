import { Suspense } from 'react'
import type { Metadata } from 'next'

import { BrowseTable } from '@/components/BrowseTable'
import { PAGE, PageHeader } from '@/components/Primitives'

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
    <div className={PAGE}>
      <PageHeader kicker="Items" title="Browse" />

      <div className="mt-8">
        <Suspense fallback={<p className="label">Loading…</p>}>
          <BrowseTable />
        </Suspense>
      </div>
    </div>
  )
}
