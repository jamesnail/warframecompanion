import type { Metadata } from 'next'
import Link from 'next/link'
import { Archivo, IBM_Plex_Mono, Inter_Tight } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'

import { CommandPalette } from '@/components/CommandPalette'
import { Shell } from '@/components/Shell'
import { attributions, site, socialImage } from '@/config/site'
import './globals.css'

/**
 * Wide industrial grotesque for display — signage, not sci-fi. Deliberately avoids the
 * Rajdhani / Orbitron / Chakra Petch cliché (DESIGN.md § 8).
 */
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
})

const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

/**
 * metadataBase is what lets every page emit an absolute canonical and Open Graph URL from a
 * relative path. Without it Next cannot resolve them at all, and social cards silently ship
 * with no URL rather than with a wrong one.
 */
export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
  applicationName: site.name,
  // The site is public and every page is meant to be indexed; this states it rather than
  // relying on the absence of a rule.
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: site.name,
    description: site.description,
    url: '/',
    images: [socialImage],
  },
  // Card type only. Title, description and image are deliberately absent so Twitter falls
  // back to each page's own og: tags; setting them here stamped the site title onto every
  // page's card.
  twitter: { card: 'summary_large_image' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${interTight.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh flex flex-col">
        {/* CLAUDE.md constraint 5: the URL is the source of truth for every filter. nuqs
            needs its adapter above anything that reads or writes a search param. */}
        <NuqsAdapter>
        <Shell>
        <main className="flex-1">{children}</main>
        {/* Mounted once, globally, so the shortcut works on every page. */}
        <CommandPalette />
        {/* One line where it fits. The attribution is a legal requirement and the links are
            the sources, so neither can go — but they are a footnote, not a section, and the
            old block reserved a tenth of the page to say so. */}
        <footer className="mt-8 border-t border-hairline px-5 py-3 text-xs text-text-faint sm:px-6">
          <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <li className="text-text-faint/80">
              Unofficial fan tool. Warframe and all game data are property of Digital Extremes.
            </li>
            {/* First, because it is the page that explains the rest of this footer. */}
            <li>
              <Link className="underline underline-offset-4 transition-colors hover:text-gold" href="/about">
                About the data
              </Link>
            </li>
            {attributions.map((a) => (
              <li key={a.url}>
                <a className="underline underline-offset-4 transition-colors hover:text-gold" href={a.url}>
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
        </footer>
        </Shell>
        </NuqsAdapter>
      </body>
    </html>
  )
}
