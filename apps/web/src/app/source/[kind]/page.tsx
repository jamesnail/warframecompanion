import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import { SourceKind } from '@provenance/core'

import { SearchTrigger } from '@/components/CommandPalette'
import { Panel, PanelHeader } from '@/components/Primitives'
import { getDataset } from '@/lib/data'
import {
  SOURCE_KIND_LABEL,
  SOURCE_KIND_PLURAL,
  needsSourcePage,
  sourceHref,
} from '@/lib/source-route'

/**
 * The index for one kind of source.
 *
 * This exists for reachability, not decoration. /item caps its direct-sources table at 20
 * rows, so a source that never places in any item's top 20 — Armored Roller ranks 487th on
 * the best item it drops — had no inbound link from any prerendered page. /browse can filter
 * to it, but /browse renders its rows on the client, so a crawler following links from the
 * home page saw 136 of the 1,646 source pages as unreachable. SEO is a stated goal
 * (CLAUDE.md § Stack), and an orphaned static page is a page that does not exist.
 *
 * Grouped by planet where the kind has one, alphabetical otherwise.
 */

const KINDS = SourceKind.options

function isKind(value: string): value is SourceKind {
  return (KINDS as readonly string[]).includes(value)
}

/**
 * Only kinds that actually have pages to index. Two would otherwise render nothing but an
 * empty state: `relic`, whose sources are deliberately served as items instead, and `cache`,
 * which the SourceKind enum allows but no source currently uses. A page whose entire content
 * is "nothing here" is not worth prerendering, and it is one a crawler would find.
 */
async function indexableKinds(): Promise<Set<SourceKind>> {
  const { sources, itemsById } = await getDataset()
  const hasItem = (id: string): boolean => itemsById.has(id)
  const kinds = new Set<SourceKind>()
  for (const source of sources) {
    if (needsSourcePage(source.id, hasItem)) kinds.add(source.kind)
  }
  return kinds
}

export async function generateStaticParams() {
  return [...(await indexableKinds())].map((kind) => ({ kind }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string }>
}): Promise<Metadata> {
  const { kind } = await params
  if (!isKind(kind)) return { title: 'Not found' }
  const plural = SOURCE_KIND_PLURAL[kind].toLowerCase()
  return {
    title: `Every ${SOURCE_KIND_LABEL[kind].toLowerCase()} drop table`,
    description: `Every source among Warframe's ${plural}, and what each one drops.`,
  }
}

export default async function SourceIndexPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  if (!isKind(kind) || !(await indexableKinds()).has(kind)) notFound()

  const { sources, itemsById, edgesBySource } = await getDataset()
  const hasItem = (id: string): boolean => itemsById.has(id)

  // Only what this route actually serves. Relics are listed as items, not as sources, so a
  // relic index here would be 771 links to /item — which /browse?category=Relic already is.
  const listed = sources
    .filter((source) => source.kind === kind && needsSourcePage(source.id, hasItem))
    .map((source) => ({
      source,
      href: sourceHref(source.id, hasItem),
      drops: edgesBySource.get(source.id)?.length ?? 0,
    }))
    .sort((a, b) => a.source.name.localeCompare(b.source.name))

  const label = SOURCE_KIND_LABEL[kind]
  const plural = SOURCE_KIND_PLURAL[kind]

  // Planets only where the kind has them — missions and bounties do, enemies do not.
  const groups = new Map<string, typeof listed>()
  for (const entry of listed) {
    const key = entry.source.planet ?? ''
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [entry])
    else list.push(entry)
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))

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
          <span>{label}</span>
        </span>
        <SearchTrigger compact />
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">{plural}</h1>
      <p className="mt-2 max-w-prose text-sm text-text-dim">
        {listed.length.toLocaleString()} {(listed.length === 1 ? label : plural).toLowerCase()}.{' '}
        <Link
          href={`/browse?kind=${kind}`}
          className="text-text-faint underline underline-offset-4 transition-colors hover:text-text"
        >
          Filter these by item, category or drop rate
        </Link>
        .
      </p>

      {ordered.map(([planet, entries]) => (
        <Panel key={planet} className="mt-6">
          {/* The count is the number of sources here, matching the heading's own unit. The
              per-row number is a drop count, which the column head names. */}
          <PanelHeader title={planet === '' ? 'All' : planet} aside={entries.length.toLocaleString()} />
          <ul className="grid gap-x-6 px-3 py-2 sm:grid-cols-2 sm:px-5">
            {/* min-w-0 on the row is load-bearing: a grid item defaults to min-width:auto and
                will not shrink below its content, so the longest name in the list sized the
                single column ~40px wider than the panel and pushed every row of the 1,055-entry
                enemy index past the right edge at 360px. Measured, not guessed — DESIGN.md
                hazard 16. */}
            {entries.map(({ source, href, drops }) => (
              <li
                key={source.id}
                className="flex min-w-0 items-baseline justify-between gap-3 border-b border-hairline/50 py-2.5 last:border-0 sm:py-2"
              >
                <Link
                  href={href}
                  className="min-w-0 truncate text-sm text-text transition-colors hover:text-orokin"
                >
                  {source.name}
                </Link>
                <span className="data-num shrink-0 text-xs text-text-faint">
                  {drops.toLocaleString()}
                  <span className="sr-only"> drops</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  )
}
