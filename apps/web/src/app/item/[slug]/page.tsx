import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import {
  REFINEMENT_ORDER,
  bestRefinementFor,
  chancesByRefinement,
  expectedRuns,
  perRunChance,
  runsForConfidence,
  stageLabel,
} from '@provenance/core'
import type { Refinement, RelicRarity } from '@provenance/core'

import { SearchTrigger } from '@/components/CommandPalette'
import { Panel, PanelHeader, RarityTag, Stat } from '@/components/Primitives'
import { getDataset } from '@/lib/data'
import { kindLabel } from '@/lib/effort'

/** How many rows each list shows. Both headers disclose when they are truncating. */
const RELIC_LIMIT = 12
const SOURCE_LIMIT = 20

/**
 * Three-letter column heads for the narrow side-by-side relic table. Slicing the words
 * instead produced "INTA EXCE FLAW RADI", which is not any shorter to read and is not what
 * the level is called. The full word is kept for screen readers, which would otherwise be
 * handed an abbreviation with no expansion.
 */
const REFINEMENT_ABBR: Record<Refinement, string> = {
  intact: 'Int',
  exceptional: 'Exc',
  flawless: 'Flw',
  radiant: 'Rad',
}

export async function generateStaticParams() {
  const { items } = await getDataset()
  return items.map((item) => ({ slug: item.id }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const { itemsById } = await getDataset()
  const item = itemsById.get(slug)
  if (item === undefined) return { title: 'Not found' }

  return {
    title: `${item.name} drop locations`,
    description: `Every way to get ${item.name} in Warframe.`,
  }
}

/** A relic that contains this item, and what it pays at each refinement level. */
interface RelicPath {
  relicId: string
  relicName: string
  rarity: RelicRarity
  vaulted: boolean
  chances: { refinement: Refinement; chance: number }[]
  best: number
}

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { itemsById, sourcesById, edgesByItem, relicsByReward, relicsById } = await getDataset()

  const item = itemsById.get(slug)
  if (item === undefined) notFound()

  const incoming = edgesByItem.get(slug) ?? []

  // Syndicate offerings are guaranteed purchases priced in rank and standing, not RNG.
  // A 100% edge in a list sorted by drop rate would sit at the top of every page that has
  // one and say nothing useful, so they keep their own section.
  const vendorOfferings = incoming
    .filter((edge) => sourcesById.get(edge.sourceId)?.kind === 'syndicate')
    .map((edge) => ({ edge, source: sourcesById.get(edge.sourceId) }))

  // Ranked by drop rate, highest first. This deliberately ignores how long a run takes: a
  // 20% reward on a 20-minute Survival now outranks a 15% one on a 90-second Capture. The
  // table answers "where is it likeliest", not "what is fastest" — mission-durations.ts and
  // rotationCycleCost() still exist for the ranked surfaces in a later phase.
  const directEdges = incoming
    .filter((edge) => {
      if (edge.sourceId.startsWith('relic:')) return false
      return sourcesById.get(edge.sourceId)?.kind !== 'syndicate'
    })
    .map((edge) => ({ edge, source: sourcesById.get(edge.sourceId), p: perRunChance(edge) }))
    .sort((a, b) => b.p - a.p)

  // ---- relics that contain this item -------------------------------------------
  // Shown as the reward table itself: what each refinement level pays. Refining is a
  // decision the player makes with traces, and for a common reward it makes the odds
  // WORSE — so the whole row is the answer, not one "best" cell.
  const relicPaths: RelicPath[] = []
  for (const relic of relicsByReward.get(slug) ?? []) {
    const reward = relic.rewards.find((r) => r.itemId === slug)
    if (reward === undefined) continue
    relicPaths.push({
      relicId: relic.id,
      // The item table carries the proper display name ("Axi A1 Relic"); the raw slug is
      // neither the game's name for it nor consistent with the relic's own page.
      relicName: itemsById.get(relic.id)?.name ?? relic.id,
      rarity: reward.rarity,
      vaulted: relic.vaulted,
      chances: chancesByRefinement(reward.rarity),
      best: bestRefinementFor(reward.rarity).chance,
    })
  }

  relicPaths.sort((a, b) => {
    if (a.vaulted !== b.vaulted) return a.vaulted ? 1 : -1
    if (b.best !== a.best) return b.best - a.best
    return a.relicName.localeCompare(b.relicName)
  })

  const vaultedCount = relicPaths.filter((path) => path.vaulted).length

  // This item IS a relic — show what it contains, rather than "no source found".
  const asRelic = relicsById.get(slug)
  const relicContents =
    asRelic === undefined
      ? []
      : asRelic.rewards
          .map((reward) => ({
            ...reward,
            name: itemsById.get(reward.itemId)?.name ?? reward.itemId,
            chances: chancesByRefinement(reward.rarity),
            best: bestRefinementFor(reward.rarity),
          }))
          .sort((a, b) => b.best.chance - a.best.chance || a.name.localeCompare(b.name))

  const bestDirect = directEdges[0]
  // An enemy is not a run: you do not queue "one Corrupted Heavy Gunner".
  const directNoun = bestDirect?.source?.kind === 'enemy' ? 'kills' : 'runs'

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16">
      <nav className="label mb-6 flex items-center justify-between gap-4">
        <span>
          <Link href="/" className="transition-colors hover:text-text">
            Provenance
          </Link>
          <span className="mx-2 text-hairline-strong" aria-hidden="true">
            /
          </span>
          <span>{item.category}</span>
        </span>
        {/* A visible affordance: a keyboard shortcut nobody can see is not a feature. */}
        <SearchTrigger compact />
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">{item.name}</h1>

      {bestDirect !== undefined ? (
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
          <Stat
            label={`Best chance / ${directNoun === 'kills' ? 'kill' : 'run'}`}
            value={(bestDirect.p * 100).toFixed(2)}
            unit="%"
            accent
          />
          <Stat label={`Expected ${directNoun}`} value={expectedRuns(bestDirect.p).toFixed(0)} />
          <Stat
            label="95% confident"
            value={String(runsForConfidence(bestDirect.p))}
            unit={directNoun}
          />
        </div>
      ) : relicPaths.length > 0 ? (
        <p className="mt-6 max-w-prose text-sm text-text-dim">
          No direct drop. Found only in Void Relics —{' '}
          {relicPaths.length === 1 ? 'one relic' : `${String(relicPaths.length)} relics`} listed
          below.
        </p>
      ) : vendorOfferings.length > 0 ? (
        // A guaranteed purchase is a source; it just isn't a farm.
        <p className="mt-6 max-w-prose text-sm text-text-dim">
          Not farmed — bought with standing from{' '}
          {vendorOfferings.length === 1
            ? 'a syndicate'
            : `${String(vendorOfferings.length)} syndicates`}
          , listed below.
        </p>
      ) : asRelic !== undefined ? (
        <p className="mt-6 max-w-prose text-sm text-text-dim">
          {asRelic.vaulted
            ? 'Vaulted. No mission or bounty currently drops this relic — trade for it, or wait for an unvaulting.'
            : 'No direct source recorded for this relic.'}
        </p>
      ) : (
        <p className="mt-6 max-w-prose text-sm text-text-dim">
          No source found. This item may be quest-locked, vaulted, or bought rather than farmed.
        </p>
      )}

      {/* Direct sources and relics answer the same question two ways, so they are read
          together rather than one scrolled past to reach the other. */}
      {(directEdges.length > 0 || relicPaths.length > 0) && (
        <div className="mt-10 grid items-start gap-6 lg:grid-cols-2">
          {directEdges.length > 0 && (
            <Panel>
              <PanelHeader
                title="Direct sources"
                aside={
                  directEdges.length > SOURCE_LIMIT
                    ? `${String(SOURCE_LIMIT)} of ${String(directEdges.length)} · by drop rate`
                    : `${String(directEdges.length)} · by drop rate`
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Sources that drop {item.name} directly, highest drop rate first
                  </caption>
                  <thead>
                    <tr className="border-b border-hairline text-left">
                      <th scope="col" className="label px-5 py-2 font-normal">
                        Source
                      </th>
                      <th scope="col" className="label px-5 py-2 text-right font-normal">
                        Chance
                      </th>
                      <th scope="col" className="label px-5 py-2 text-right font-normal">
                        Runs
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {directEdges.slice(0, SOURCE_LIMIT).map(({ edge, source, p }, index) => {
                      const stage = stageLabel(source?.missionType, edge.rotation)
                      const kind = kindLabel(source)
                      const detail = [source?.planet, source?.missionType, kind, stage]
                        .filter((part) => part !== undefined)
                        .join(' · ')
                      return (
                        <tr
                          key={`${edge.sourceId}-${String(index)}`}
                          className="border-b border-hairline/50 last:border-0"
                        >
                          <th scope="row" className="px-5 py-2.5 text-left font-normal">
                            <span className="text-text">{source?.name ?? edge.sourceId}</span>
                            {detail !== '' && (
                              <span className="mt-0.5 block text-xs text-text-faint">{detail}</span>
                            )}
                          </th>
                          <td className="data-num px-5 py-2.5 text-right text-text">
                            {(p * 100).toFixed(2)}%
                          </td>
                          <td className="data-num px-5 py-2.5 text-right text-text-faint">
                            ~{expectedRuns(p).toFixed(0)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {relicPaths.length > 0 && (
            <Panel>
              <PanelHeader
                title="From relics"
                aside={
                  relicPaths.length > RELIC_LIMIT
                    ? `${String(RELIC_LIMIT)} of ${String(relicPaths.length)} · ${String(vaultedCount)} vaulted`
                    : vaultedCount > 0
                      ? `${String(relicPaths.length)} · ${String(vaultedCount)} vaulted`
                      : String(relicPaths.length)
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Relics containing {item.name}, and the odds at each refinement level
                  </caption>
                  <thead>
                    <tr className="border-b border-hairline text-left">
                      <th scope="col" className="label px-5 py-2 font-normal">
                        Relic
                      </th>
                      {REFINEMENT_ORDER.map((refinement) => (
                        <th
                          key={refinement}
                          scope="col"
                          className="label px-2 py-2 text-right font-normal last:pr-5"
                        >
                          <span className="sr-only">{refinement}</span>
                          <span aria-hidden="true">{REFINEMENT_ABBR[refinement]}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {relicPaths.slice(0, RELIC_LIMIT).map((path) => (
                      <tr
                        key={path.relicId}
                        className={`border-b border-hairline/50 last:border-0 ${
                          path.vaulted ? 'vaulted' : ''
                        }`}
                      >
                        <th scope="row" className="px-5 py-2.5 text-left font-normal">
                          <Link
                            href={`/item/${path.relicId}`}
                            className="text-text transition-colors hover:text-orokin"
                          >
                            {path.relicName}
                          </Link>
                          <span className="mt-0.5 flex items-baseline gap-2">
                            <RarityTag rarity={path.rarity} />
                            {path.vaulted && <span className="label">Vaulted</span>}
                          </span>
                        </th>
                        {path.chances.map(({ refinement, chance }) => (
                          <td
                            key={refinement}
                            className={`data-num px-2 py-2.5 text-right last:pr-5 ${
                              chance === path.best ? 'text-text' : 'text-text-faint'
                            }`}
                          >
                            {(chance * 100).toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      )}

      {vendorOfferings.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader
            title="Bought, not farmed"
            aside={`${String(vendorOfferings.length)} ${vendorOfferings.length === 1 ? 'offering' : 'offerings'}`}
          />
          <ul>
            {vendorOfferings.map(({ edge, source }, index) => (
              <li
                key={`${edge.sourceId}-${String(index)}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline/50 px-5 py-3 text-sm last:border-0"
              >
                <span className="text-text">{source?.name ?? edge.sourceId}</span>
                {(() => {
                  // Upstream's `place` repeats the syndicate name ("Red Veil, Respected"),
                  // which the left cell already shows. Keep the rank and the price.
                  const detail =
                    source?.name !== undefined &&
                    edge.stage?.startsWith(`${source.name}, `) === true
                      ? edge.stage.slice(source.name.length + 2)
                      : edge.stage
                  return detail === undefined ? null : (
                    <span className="data-num text-xs text-text-faint">{detail}</span>
                  )
                })()}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {relicContents.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader
            title="Relic contents"
            aside={`${String(relicContents.length)} rewards · all refinements`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Rewards contained in this relic, with the odds at each refinement level
              </caption>
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th scope="col" className="label px-5 py-2 font-normal">
                    Reward
                  </th>
                  <th scope="col" className="label px-5 py-2 text-left font-normal">
                    Rarity
                  </th>
                  {REFINEMENT_ORDER.map((refinement) => (
                    <th
                      key={refinement}
                      scope="col"
                      className="label px-3 py-2 text-right font-normal capitalize last:pr-5"
                    >
                      {refinement}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {relicContents.map((reward) => (
                  <tr key={reward.itemId} className="border-b border-hairline/50 last:border-0">
                    <th scope="row" className="px-5 py-2.5 text-left font-normal">
                      <Link
                        href={`/item/${reward.itemId}`}
                        className="text-text transition-colors hover:text-orokin"
                      >
                        {reward.name}
                      </Link>
                    </th>
                    <td className="px-5 py-2.5">
                      <RarityTag rarity={reward.rarity} />
                    </td>
                    {reward.chances.map(({ refinement, chance }) => (
                      <td
                        key={refinement}
                        className={`data-num px-3 py-2.5 text-right last:pr-5 ${
                          refinement === reward.best.refinement ? 'text-text' : 'text-text-faint'
                        }`}
                      >
                        {(chance * 100).toFixed(2)}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Only explain the relic table on pages that actually show one. */}
      {(relicPaths.length > 0 || relicContents.length > 0) && (
        <p className="mt-8 max-w-prose text-xs text-text-faint">
          Relic odds are per opened relic, per reward slot. Refining trades common odds for rare
          ones, so the best level is not always Radiant — for a common reward Intact pays the
          most. The highlighted column is the best one for that reward.
        </p>
      )}
    </div>
  )
}
