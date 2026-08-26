import type { MetadataRoute } from 'next'

import { site } from '@/config/site'
import { getDataset } from '@/lib/data'
import { needsSourcePage, sourceHref } from '@/lib/source-route'

/**
 * The sitemap.
 *
 * DESIGN.md calls static generation "the entire SEO strategy", but generating 6,500 pages
 * is only half of it — a crawler still has to find them. The index pages make every page
 * reachable by following links; this makes them discoverable without the walk, which matters
 * for a site whose value is in the long tail rather than the front page.
 *
 * Well under the 50,000-URL and 50MB limits for a single sitemap, so it is not split.
 *
 * `lastModified` is DE's publication timestamp for the drop tables, not the build time. It
 * is the honest answer to "when did this page's content last change", and it deliberately
 * does not move when a daily run finds nothing new — see the note on Manifest.builtAt.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { manifest, items, sources, itemsById } = await getDataset()
  const lastModified = new Date(manifest.builtAt)
  const hasItem = (id: string): boolean => itemsById.has(id)

  const entry = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'],
  ): MetadataRoute.Sitemap[number] => ({
    url: `${site.url}${path}`,
    lastModified,
    changeFrequency,
    priority,
  })

  // /collection is deliberately absent: its content is whatever the viewer has ticked, so
  // there is nothing for a crawler to index and nothing that would be the same twice.
  const fixed = [
    entry('/', 1, 'daily'),
    entry('/browse', 0.8, 'daily'),
    // Weekly, because that is exactly how often DE republishes the trade statistics.
    entry('/rivens', 0.8, 'weekly'),
    entry('/about', 0.5, 'monthly'),
  ]

  // The long tail, and the reason this file exists. Item pages target the query a player
  // actually types — the item name plus the word "drop".
  const itemPages = items.map((item) => entry(`/item/${item.id}`, 0.7, 'weekly'))

  const sourceKinds = new Set<string>()
  const sourcePages: MetadataRoute.Sitemap = []
  for (const source of sources) {
    if (!needsSourcePage(source.id, hasItem)) continue
    sourceKinds.add(source.kind)
    // Reuse the resolver rather than rebuilding the path: if the two ever disagreed, the
    // sitemap would advertise URLs that 404, which is worse than having no sitemap.
    sourcePages.push(entry(sourceHref(source.id, hasItem), 0.6, 'weekly'))
  }

  const indexPages = [...sourceKinds]
    .sort((a, b) => a.localeCompare(b))
    .map((kind) => entry(`/source/${kind}`, 0.6, 'weekly'))

  return [...fixed, ...indexPages, ...itemPages, ...sourcePages]
}
