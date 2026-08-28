import type { Metadata } from 'next'

import { SettingsPanel } from '@/components/SettingsPanel'
import { PAGE, PageHeader } from '@/components/Primitives'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Theme, density, motion and what the tool shows you. Stored in your browser.',
  // Whatever the viewer has chosen. Nothing stable to index, and out of the sitemap for the
  // same reason /collection is.
  robots: { index: false, follow: true },
}

export default function SettingsPage() {
  return (
    <div className={PAGE}>
      <PageHeader
        title="Settings"
        lede="Kept in this browser, alongside your collection. No account, nothing uploaded."
      />
      <div className="mt-8">
        <SettingsPanel />
      </div>
    </div>
  )
}
