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
import { OwnedToggle, RecipeTable } from '@/components/RecipeTable'
import { RivenPanel } from '@/components/RivenPanel'
import { getDataset } from '@/lib/data'
import { kindLabel } from '@/lib/effort'
import { sourceHref } from '@/lib/source-route'

/** How many rows each list shows. Both headers disclose when they are truncating. */
const RELIC_LIMIT = 12
const SOURCE_LIMIT = 20

/** A shared ingredient builds into almost everything — Orokin Cell is a component of 177
 *  sets — so the backlink names a few and counts the rest. */
const PART_OF_LIMIT = 6

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

  const description = `Every way to get ${item.name} in Warframe.`
  return {
    title: `${item.name} drop locations`,
    description,
    alternates: { canonical: `/item/${item.id}` },
    openGraph: { title: item.name, description, url: `/item/${item.id}` },
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
  /** Units this relic pays for this reward, where it pays more than one. */
  quantity: number | undefined
}

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { itemsById, sourcesById, edgesByItem, relicsByReward, relicsById, rivensByItem } =
    await getDataset()
  const hasItem = (id: string): boolean => itemsById.has(id)

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
      quantity: reward.quantity,
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

  /**
   * The recipe, if this is an assembled item.
   *
   * Each component gets a one-line summary of how it is actually obtained, because the
   * question "what do I need for Braton Prime" is really "and where does each piece come
   * from" — sending the reader to five more pages to find that out would be answering half.
   */
  const recipe = (item.components ?? []).map((component) => {
    const part = itemsById.get(component.itemId)
    const edges = edgesByItem.get(component.itemId) ?? []
    const direct = edges
      .filter((edge) => !edge.sourceId.startsWith('relic:'))
      .map((edge) => ({ edge, p: perRunChance(edge) }))
      .sort((a, b) => b.p - a.p)[0]
    const relics = relicsByReward.get(component.itemId) ?? []
    const bestRelic = relics
      .map((relic) => {
        const reward = relic.rewards.find((r) => r.itemId === component.itemId)
        return reward === undefined ? undefined : bestRefinementFor(reward.rarity).chance
      })
      .filter((chance): chance is number => chance !== undefined)
      .sort((a, b) => b - a)[0]

    return {
      itemId: component.itemId,
      name: part?.name ?? component.itemId,
      count: component.count,
      // Relics first: a prime part's honest answer is which relic, not the 0.00% direct row
      // it may also have. A resource's is the mission it drops from.
      relicCount: relics.length,
      bestRelic,
      // Whether this piece can be obtained AT ALL right now. A set whose blueprint is
      // vaulted cannot be built this week however many of the other parts you have, and
      // that is the first thing the recipe has to admit to.
      vaulted: relics.length > 0 && !relics.some((relic) => !relic.vaulted) && direct === undefined,
      directName:
        direct === undefined ? undefined : (sourcesById.get(direct.edge.sourceId)?.name ?? undefined),
      directChance: direct?.p,
    }
  })

  const riven = rivensByItem.get(item.id)

  const partOf = (item.buildsInto ?? [])
    .map((id) => ({ id, name: itemsById.get(id)?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name))

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

      {/* Where this piece ends up. Capped, because a shared ingredient builds into almost
          everything — Orokin Cell is a component of 177 sets, and listing them would bury
          the page under a fact nobody came for. */}
      {partOf.length > 0 && (
        <p className="mt-2 text-sm text-text-dim">
          Part of{' '}
          {partOf.slice(0, PART_OF_LIMIT).map((set, index) => (
            <span key={set.id}>
              {index > 0 && ', '}
              <Link href={`/item/${set.id}`} className="text-text transition-colors hover:text-orokin">
                {set.name}
              </Link>
            </span>
          ))}
          {partOf.length > PART_OF_LIMIT &&
            ` and ${(partOf.length - PART_OF_LIMIT).toLocaleString()} more`}
          .
        </p>
      )}

      {/* Only where it means something. Ticking "owned" on a resource you have 40,000 of is
          not a fact worth storing; on a part that completes a set it is the whole point. */}
      {partOf.length > 0 && <OwnedToggle itemId={item.id} itemName={item.name} />}

      {recipe.length > 0 && bestDirect === undefined && relicPaths.length === 0 ? (
        // An assembled item is built, not farmed. Saying "no source found" would be wrong,
        // and the recipe below is the actual answer.
        <p className="mt-6 max-w-prose text-sm text-text-dim">
          Built, not dropped. Farm the {recipe.length} components below, then craft it.
        </p>
      ) : bestDirect !== undefined ? (
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3">
          {/* Always "runs", never "kills". An enemy drop is still collected by running the
              mission the enemy spawns in — nobody queues "one Corrupted Heavy Gunner" — so
              the run is the unit every source has in common, and switching nouns per source
              kind made the same statistic incomparable between two pages. */}
          <Stat
            label="Best chance / run"
            value={(bestDirect.p * 100).toFixed(2)}
            unit="%"
            accent
          />
          <Stat label="Expected runs" value={expectedRuns(bestDirect.p).toFixed(0)} />
          <Stat label="95% confident" value={String(runsForConfidence(bestDirect.p))} unit="runs" />
        </div>
      ) : relicPaths.length > 0 ? (
        // Whether it can be farmed TODAY is the first thing a prime part has to answer, and
        // "found in 39 relics" answers it wrongly when 37 of them are out of rotation.
        <p className="mt-6 max-w-prose text-sm text-text-dim">
          {vaultedCount === relicPaths.length ? (
            <>
              <span className="text-r-legendary">Vaulted.</span> No relic currently in rotation
              contains this — trade for it, or wait for an unvaulting. All{' '}
              {relicPaths.length === 1 ? 'one relic' : `${String(relicPaths.length)} relics`} that
              hold it are listed below.
            </>
          ) : (
            <>
              No direct drop. Found in{' '}
              {relicPaths.length === 1 ? 'one relic' : `${String(relicPaths.length)} relics`}
              {vaultedCount > 0 && (
                <>
                  , {String(relicPaths.length - vaultedCount)} of them still in rotation
                </>
              )}
              . Farmable ones are listed first.
            </>
          )}
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

      {recipe.length > 0 && <RecipeTable rows={recipe} itemName={item.name} />}

      {/* Weapons only, and only where this weapon actually takes a riven. */}
      {riven !== undefined && <RivenPanel weapon={riven} />}

      {/* Direct sources and relics answer the same question two ways, so they are read
          together rather than one scrolled past to reach the other. */}
      {(directEdges.length > 0 || relicPaths.length > 0) && (
        <div className="mt-10 grid items-start gap-6 lg:grid-cols-2">
          {directEdges.length > 0 && (
            <Panel className="min-w-0">
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
                      <th scope="col" className="label px-3 py-2 sm:px-5 font-normal">
                        Source
                      </th>
                      <th scope="col" className="label px-3 py-2 sm:px-5 text-right font-normal">
                        Chance
                      </th>
                      <th scope="col" className="label px-3 py-2 sm:px-5 text-right font-normal">
                        Runs
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {directEdges.slice(0, SOURCE_LIMIT).map(({ edge, source, p }, index) => {
                      const stage = stageLabel(source?.missionType, edge.rotation)
                      const kind = kindLabel(source)
                      // A pre-refined relic is a materially better drop — a Radiant from
                      // Elite Sanctuary Onslaught saves 100 void traces — so it is named
                      // on the row rather than being folded into the plain relic.
                      const detail = [
                        source?.planet,
                        source?.missionType,
                        kind,
                        stage,
                        edge.refinement === undefined
                          ? undefined
                          : `${edge.refinement[0]?.toUpperCase() ?? ''}${edge.refinement.slice(1)}`,
                      ]
                        .filter((part) => part !== undefined)
                        .join(' · ')
                      return (
                        <tr
                          key={`${edge.sourceId}-${String(index)}`}
                          className="border-b border-hairline/50 last:border-0"
                        >
                          <th scope="row" className="px-3 py-3 sm:px-5 sm:py-2.5 text-left font-normal">
                            <Link
                              href={sourceHref(edge.sourceId, hasItem)}
                              className="text-text transition-colors hover:text-orokin"
                            >
                              {source?.name ?? edge.sourceId}
                            </Link>
                            {/* Units per drop. On a resource page this decides more than
                                the drop rate does — 350 Plastids at 4% beats 10 at 20% —
                                so it sits beside the name, not buried in the detail line. */}
                            {edge.quantity[1] > 1 && (
                              <span className="data-num ml-2 text-xs text-text-dim">
                                ×
                                {edge.quantity[0] === edge.quantity[1]
                                  ? edge.quantity[0].toLocaleString()
                                  : `${edge.quantity[0].toLocaleString()}–${edge.quantity[1].toLocaleString()}`}
                              </span>
                            )}
                            {detail !== '' && (
                              <span className="mt-0.5 block text-xs text-text-faint">{detail}</span>
                            )}
                          </th>
                          <td className="data-num px-3 py-3 sm:px-5 sm:py-2.5 text-right text-text">
                            {(p * 100).toFixed(2)}%
                          </td>
                          <td className="data-num px-3 py-3 sm:px-5 sm:py-2.5 text-right text-text-faint">
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
            <Panel className="min-w-0">
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
                      <th scope="col" className="label px-3 py-2 sm:px-5 font-normal">
                        Relic
                      </th>
                      {REFINEMENT_ORDER.map((refinement) => (
                        <th
                          key={refinement}
                          scope="col"
                          className="label px-1.5 py-2 sm:px-2 text-right font-normal last:pr-5"
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
                        <th scope="row" className="px-3 py-3 sm:px-5 sm:py-2.5 text-left font-normal">
                          <Link
                            href={`/item/${path.relicId}`}
                            className="text-text transition-colors hover:text-orokin"
                          >
                            {path.relicName}
                          </Link>
                          {/* The same fact from the reward's side: this relic pays two. */}
                          {path.quantity !== undefined && (
                            <span className="data-num ml-2 text-xs text-text-dim">
                              ×{path.quantity.toLocaleString()}
                            </span>
                          )}
                          <span className="mt-0.5 flex items-baseline gap-2">
                            <RarityTag rarity={path.rarity} />
                            {path.vaulted && <span className="label">Vaulted</span>}
                          </span>
                        </th>
                        {path.chances.map(({ refinement, chance }) => (
                          <td
                            key={refinement}
                            className={`data-num px-1.5 py-3 sm:px-2 sm:py-2.5 text-right last:pr-5 ${
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
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline/50 px-3 py-3 sm:px-5 text-sm last:border-0"
              >
                <Link
                  href={sourceHref(edge.sourceId, hasItem)}
                  className="text-text transition-colors hover:text-orokin"
                >
                  {source?.name ?? edge.sourceId}
                </Link>
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
            // Names the unit, because the cells drop their % sign on narrow screens.
            aside={`${String(relicContents.length)} rewards · chance %`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Rewards contained in this relic, with the odds at each refinement level
              </caption>
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th scope="col" className="label px-3 py-2 sm:px-5 font-normal">
                    Reward
                  </th>
                  {/* Six columns do not fit a 360px phone: Flawless and Radiant fell off the
                      right edge, hiding the rare reward's best cell — the single number most
                      worth seeing — behind a horizontal scroll nothing advertised. Rarity
                      moves under the reward name on mobile and the heads abbreviate. */}
                  <th
                    scope="col"
                    className="label hidden px-3 py-2 text-left font-normal sm:table-cell sm:px-5"
                  >
                    Rarity
                  </th>
                  {REFINEMENT_ORDER.map((refinement) => (
                    <th
                      key={refinement}
                      scope="col"
                      className="label px-1.5 py-2 text-right font-normal last:pr-2 sm:px-3 sm:last:pr-5"
                    >
                      <span className="sr-only">{refinement}</span>
                      <span aria-hidden="true" className="sm:hidden">
                        {REFINEMENT_ABBR[refinement]}
                      </span>
                      <span aria-hidden="true" className="hidden capitalize sm:inline">
                        {refinement}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {relicContents.map((reward) => (
                  <tr key={reward.itemId} className="border-b border-hairline/50 last:border-0">
                    <th scope="row" className="px-3 py-3 sm:px-5 sm:py-2.5 text-left font-normal">
                      <Link
                        href={`/item/${reward.itemId}`}
                        className="text-text transition-colors hover:text-orokin"
                      >
                        {reward.name}
                      </Link>
                      {/* The slot pays more than one. Dropping this when the count came out
                          of the name would have quietly claimed it pays a single Forma. */}
                      {reward.quantity !== undefined && (
                        <span className="data-num ml-2 text-xs text-text-dim">
                          ×{reward.quantity.toLocaleString()}
                        </span>
                      )}
                      {/* Rarity rides under the name where its own column does not fit. */}
                      <span className="mt-0.5 block sm:hidden">
                        <RarityTag rarity={reward.rarity} />
                      </span>
                    </th>
                    <td className="hidden px-3 py-3 sm:table-cell sm:px-5 sm:py-2.5">
                      <RarityTag rarity={reward.rarity} />
                    </td>
                    {reward.chances.map(({ refinement, chance }) => (
                      <td
                        key={refinement}
                        className={`data-num px-1.5 py-3 text-right last:pr-2 sm:px-3 sm:py-2.5 sm:last:pr-5 ${
                          refinement === reward.best.refinement ? 'text-text' : 'text-text-faint'
                        }`}
                      >
                        {(chance * 100).toFixed(2)}
                        {/* The % costs ~10px per column, which is the difference between four
                            columns fitting and two of them falling off the screen. */}
                        <span className="hidden sm:inline">%</span>
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
