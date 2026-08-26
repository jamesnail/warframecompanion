import { Suspense } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'

import { SearchTrigger } from '@/components/CommandPalette'
import { RivenTable } from '@/components/RivenTable'

export const metadata: Metadata = {
  title: 'Riven dispositions and prices',
  description:
    'Every weapon that takes a riven, with its disposition and last week’s observed trade prices in platinum.',
  alternates: { canonical: '/rivens' },
  openGraph: {
    title: 'Riven dispositions and prices',
    description:
      'Every weapon that takes a riven, with its disposition and last week’s observed trade prices.',
    url: '/rivens',
  },
}

/**
 * Rivens (DESIGN.md § 9), scoped to the two facts that are actually published.
 *
 * Disposition and market price are both real data. Grading an individual roll is not: it
 * would mean comparing each stat against the range that weapon's disposition allows, and no
 * upstream source publishes those ranges. Inventing the formula would produce confident
 * numbers with nothing behind them, which is the one thing this tool must not do.
 *
 * Statically prerendered like everything else; the table pulls its 132 KB chunk through the
 * same IndexedDB cache as every other surface.
 */
export default function RivensPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-6 sm:py-16">
      <nav className="label mb-6 flex items-center justify-between gap-4">
        <span>
          <Link href="/" className="transition-colors hover:text-text">
            Provenance
          </Link>
          <span className="mx-2 text-hairline-strong" aria-hidden="true">
            /
          </span>
          <span>Rivens</span>
        </span>
        <SearchTrigger compact />
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">Rivens</h1>
      <p className="mt-2 max-w-prose text-sm text-text-dim">
        Disposition and last week&rsquo;s observed trade prices, per weapon. Higher disposition
        means stronger rolls. Prices are medians in platinum from Digital Extremes&rsquo; own
        weekly trade statistics, covering the most recently published week.
      </p>
      <p className="mt-2 max-w-prose text-xs text-text-faint">
        A median is only as good as its sample. Several of the highest prices here come from a
        single trade — those are marked, and &ldquo;min trades&rdquo; hides them.
      </p>

      <div className="mt-8">
        {/* Required, not decorative: a component that reads search params cannot be
            prerendered without a Suspense boundary. */}
        <Suspense fallback={<p className="label">Loading…</p>}>
          <RivenTable />
        </Suspense>
      </div>
    </div>
  )
}
