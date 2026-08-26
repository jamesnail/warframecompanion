import Link from 'next/link'
import type { Metadata } from 'next'

import { SearchTrigger } from '@/components/CommandPalette'
import { getDataset } from '@/lib/data'
import { site } from '@/config/site'
import { surfaceGroups } from '@/config/surfaces'
import type { Surface, SurfaceCount } from '@/config/surfaces'

/**
 * The home page is a directory, not a dashboard.
 *
 * It used to lead with corpus statistics and a "most relic paths" list. Both described the
 * dataset rather than offering a way in, and neither answered a question anyone arrives
 * with. What replaces them is the set of ways to browse, plus the palette — which is still
 * the fastest route to a named item (DESIGN.md § 7).
 */
/** The root is its own canonical. Without this the home page is the only one that does
 *  not declare one, which leaves any tracking parameter appended to it indexable. */
export const metadata: Metadata = { alternates: { canonical: '/' } }

export default async function HomePage() {
  const { items, sources, relics, rivens, manifest } = await getDataset()

  const byCategory = new Map<string, number>()
  for (const item of items) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1)

  const byKind = new Map<string, number>()
  for (const source of sources) {
    byKind.set(source.kind, (byKind.get(source.kind) ?? 0) + 1)
  }

  const counts: Record<SurfaceCount, number> = {
    items: items.length,
    relics: relics.length,
    mods: byCategory.get('Mod') ?? 0,
    arcanes: byCategory.get('Arcane') ?? 0,
    resources: byCategory.get('Resource') ?? 0,
    missions: byKind.get('mission') ?? 0,
    enemies: byKind.get('enemy') ?? 0,
    bounties: byKind.get('bounty') ?? 0,
    syndicates: byKind.get('syndicate') ?? 0,
    sorties: byKind.get('sortie') ?? 0,
    rivens: rivens.length,
  }

  const built = new Date(manifest.builtAt)

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-6 sm:py-24">
      <h1 className="font-display text-xl font-bold tracking-tight text-orokin sm:text-2xl">{site.name}</h1>

      <div className="mt-8 max-w-xl">
        <SearchTrigger />
      </div>

      {surfaceGroups.map((group) => (
        <section key={group.title} className="mt-10 sm:mt-12">
          <h2 className="label border-b border-hairline pb-2">{group.title}</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.surfaces.map((surface) => (
              <li key={surface.name}>
                <SurfaceTile surface={surface} counts={counts} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="label mt-12">
        Drop data published {built.toISOString().slice(0, 10)} · build {manifest.hash}
      </p>
    </div>
  )
}

/**
 * One tile. Interactive only when the route exists — an unbuilt surface is a `div`, so it is
 * not focusable, not announced as a link, and cannot be clicked into a 404.
 */
function SurfaceTile({
  surface,
  counts,
}: {
  surface: Surface
  counts: Record<SurfaceCount, number>
}) {
  // A zero is never shown: every zero here means the pipeline does not model that thing
  // yet (item categories are still name-inferred, and sources carry no faction), and a tile
  // reading "Mods 0" claims the game has no mods rather than admitting we have not counted.
  const raw = surface.count === undefined ? undefined : counts[surface.count]
  const count = raw !== undefined && raw > 0 ? raw : undefined

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-sm font-semibold">{surface.name}</span>
        {count !== undefined && (
          <span className="data-num shrink-0 text-xs text-text-faint">
            {count.toLocaleString()}
          </span>
        )}
      </div>
      <span className="mt-1 block text-xs text-text-faint">{surface.blurb}</span>
    </>
  )

  if (surface.href === undefined) {
    return (
      <div className="chamfer-sm h-full border border-hairline/60 border-dashed px-4 py-3">
        {body}
        <span className="label mt-2 block text-text-faint/80">Soon</span>
      </div>
    )
  }

  return (
    <Link
      href={surface.href}
      className="chamfer-sm block h-full border border-hairline bg-void-800 px-4 py-3 transition-colors hover:border-hairline-strong hover:bg-void-700"
    >
      {body}
    </Link>
  )
}
