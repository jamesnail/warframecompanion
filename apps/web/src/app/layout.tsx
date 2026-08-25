import type { Metadata } from 'next'
import { Archivo, IBM_Plex_Mono, Inter_Tight } from 'next/font/google'
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

export const metadata: Metadata = {
  title: { default: site.name, template: `%s · ${site.name}` },
  description: site.description,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${interTight.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh flex flex-col">
        <main className="flex-1">{children}</main>
        {/* Mounted once, globally, so the shortcut works on every page. */}
        <CommandPalette />
        <footer className="mt-16 border-t border-hairline px-5 py-8 text-xs text-text-faint sm:mt-24 sm:px-6 sm:py-10">
          <p className="max-w-prose">
            Unofficial fan tool, not affiliated with or endorsed by Digital Extremes. Warframe and
            all game data are property of Digital Extremes.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            {attributions.map((a) => (
              <li key={a.url}>
                <a className="underline underline-offset-4 transition-colors hover:text-text" href={a.url}>
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
        </footer>
      </body>
    </html>
  )
}
