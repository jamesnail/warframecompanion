import { Suspense } from 'react'
import type { Metadata } from 'next'

import { RivenTable } from '@/components/RivenTable'
import { socialImage } from '@/config/site'
import { PAGE, PageHeader } from '@/components/Primitives'

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
    images: [socialImage],
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
    <div className={PAGE}>
      <PageHeader kicker="Items" title="Rivens" />

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
