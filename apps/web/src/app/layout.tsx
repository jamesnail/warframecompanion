import type { Metadata } from 'next'
import Link from 'next/link'
import { Archivo, IBM_Plex_Mono, Inter_Tight } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'

import { CommandPalette } from '@/components/CommandPalette'
import { attributions, site } from '@/config/site'
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
  },
  twitter: { card: 'summary', title: site.name, description: site.description },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${interTight.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh flex flex-col">
        {/* CLAUDE.md constraint 5: the URL is the source of truth for every filter. nuqs
            needs its adapter above anything that reads or writes a search param. */}
        <NuqsAdapter>
        <main className="flex-1">{children}</main>
        {/* Mounted once, globally, so the shortcut works on every page. */}
        <CommandPalette />
        <footer className="mt-16 border-t border-hairline px-5 py-8 text-xs text-text-faint sm:mt-24 sm:px-6 sm:py-10">
          <p className="max-w-prose">
            Unofficial fan tool, not affiliated with or endorsed by Digital Extremes. Warframe and
            all game data are property of Digital Extremes.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            {/* First, because it is the page that explains the rest of this footer. */}
            <li>
              <Link className="underline underline-offset-4 transition-colors hover:text-text" href="/about">
                About the data
              </Link>
            </li>
            {attributions.map((a) => (
              <li key={a.url}>
                <a className="underline underline-offset-4 transition-colors hover:text-text" href={a.url}>
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
        </footer>
        </NuqsAdapter>
      </body>
    </html>
  )
}
