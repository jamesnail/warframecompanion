import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import {
  REFINEMENT_ORDER,
  attemptColumn,
  attemptLabel,
  attemptNoun,
  attemptPlural,
  bestRefinementFor,
  chancesByRefinement,
  expectedRuns,
  expectedYield,
  farmStrategy,
  ranksByYield,
  perRunChance,
  runsForConfidence,
  stageLabel,
} from '@provenance/core'
import type { Refinement, RelicRarity } from '@provenance/core'

import {
  CONTROL,
  PAGE,
  PageHeader,
  Panel,
  PanelHeader,
  RarityTag,
  SummaryCard,
} from '@/components/Primitives'
import { OwnedToggle, RecipeTable, TrackToggle } from '@/components/RecipeTable'
import { RivenPanel } from '@/components/RivenPanel'
import { MarketPricePanel } from '@/components/MarketPricePanel'
import { MasteryBadge, NewPlayerNote, TradeOnly } from '@/components/ViewerModes'
import { getDataset } from '@/lib/data'
import { kindLabel } from '@/lib/effort'
import { buildBestChain } from '@/lib/chain-build'
import { DropChainTrace } from '@/components/DropChainTrace'
import { FarmingGuide } from '@/components/FarmingGuide'
import { InsightPanel } from '@/components/InsightPanel'
import { sourceHref } from '@/lib/source-route'
import { socialImage } from '@/config/site'

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

/**
 * Expected units per attempt, at a readable precision.
 *
 * Two decimals below 1 because the interesting resource rows live there — 0.75 Orokin Cells a
 * kill against 0.05 is the whole comparison, and both round to "1" and "0" otherwise. Whole
 * numbers above, where a decimal on "1,601 Endo" is noise.
 */
function formatYield(units: number): string {
  if (units >= 100) return Math.round(units).toLocaleString()
  if (units >= 1) return units.toFixed(1)
  return units.toFixed(2)
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
    openGraph: { title: item.name, description, url: `/item/${item.id}`, images: [socialImage] },
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
  const { itemsById, sourcesById, edgesByItem, relicsByReward, relicsById, rivensByItem, guidesByItem } =
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

  // Sorted below, once the item's farming strategy is known — by drop rate for a part you
  // need one of, by expected units for anything that stacks.
  //
  // Ranking by expected TIME was tried, cut from this page on owner feedback, and then
  // dropped from the project outright as a useless metric — a number that averages a
  // 90-second Capture against a 20-minute Survival answers a question no player actually
  // asks. Yield is not that: it is units per attempt, published by DE, with no model of how
  // long an attempt takes.
  const directEdges = incoming
    .filter((edge) => {
      if (edge.sourceId.startsWith('relic:')) return false
      return sourcesById.get(edge.sourceId)?.kind !== 'syndicate'
    })
    .map((edge) => ({
      edge,
      source: sourcesById.get(edge.sourceId),
      p: perRunChance(edge),
      yield: expectedYield(edge),
    }))

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

  /**
   * How this TYPE of item is farmed, which decides how the table below is ranked.
   *
   * Chance ranking is right for a part you need one of and wrong for anything that stacks:
   * it put "Rare Corpus Storage Container, 100%" at the top of /item/endo, because a
   * container that always holds 80 Endo wins a chance ranking outright. A resource is ranked
   * on expected units per run instead (core's `farming.ts` decides which).
   */
  const guide = guidesByItem.get(item.id)
  // Dated once here rather than inside the panel, so every citation on the page is judged
  // against the same instant and the prerendered HTML does not depend on the minute.
  const buildTime = new Date()
  const strategy = farmStrategy(item, relicPaths.length > 0)
  const byYield = ranksByYield(strategy)
  directEdges.sort((a, b) => (byYield ? b.yield - a.yield : b.p - a.p))

  const bestDirect = directEdges[0]
  const bestNoun = attemptNoun(bestDirect?.source?.kind)
  // One item can drop from enemies AND missions — 492 of them do — so the effort column
  // names both where its rows disagree rather than lying on half of them.
  const directColumn = attemptColumn(
    directEdges
      .slice(0, SOURCE_LIMIT)
      .map(({ source }) => source?.kind)
      .filter((kind) => kind !== undefined),
  )

  /**
   * The recipe, if this is an assembled item.
   *
   * Each part gets a one-line summary of how it is actually obtained, because the question
   * "what do I need for Braton Prime" is really "and where does each piece come from" —
   * sending the reader to five more pages to find that out would be answering half.
   *
   * Parts only. The resources a recipe also consumes are listed under the table without a
   * source line or a tick: they are farmed on their own terms, on their own page, and giving
   * an Orokin Cell a checkbox implied a set was one Cell away from done.
   */
  const recipe = (item.parts ?? []).map((component) => {
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

  /**
   * The whole route, end to end — DESIGN.md § 8's signature element.
   *
   * Built from the same helper /farm uses, so the plan that page produces can never
   * disagree with the page it links to.
   */
  const chain = buildBestChain(
    { itemsById, sourcesById, edgesByItem, relicsByReward, relicsById },
    item.id,
  )

  const ingredients = (item.ingredients ?? []).map((entry) => ({
    itemId: entry.itemId,
    name: itemsById.get(entry.itemId)?.name ?? entry.itemId,
    count: entry.count,
  }))

  const riven = rivensByItem.get(item.id)

  const partOf = (item.buildsInto ?? [])
    .map((id) => ({ id, name: itemsById.get(id)?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className={PAGE}>
      <PageHeader
        kicker={item.category}
        title={item.name}
        lede={
          /* Where this piece ends up. Capped, because a shared ingredient builds into
             almost everything — Orokin Cell is a component of 177 sets, and listing them
             would bury the page under a fact nobody came for. */
          partOf.length > 0 ? (
            <p>
              Part of{' '}
              {partOf.slice(0, PART_OF_LIMIT).map((set, index) => (
                <span key={set.id}>
                  {index > 0 && ', '}
                  <Link
                    href={`/item/${set.id}`}
                    className="text-text transition-colors hover:text-gold"
                  >
                    {set.name}
                  </Link>
                </span>
              ))}
              {partOf.length > PART_OF_LIMIT &&
                ` and ${(partOf.length - PART_OF_LIMIT).toLocaleString()} more`}
              .
            </p>
          ) : undefined
        }
        actions={
          /* The three things you can DO with this item. Owned-tracking only where it means
             something — ticking a resource you have 40,000 of is not a fact worth storing;
             on a part that completes a set it is the whole point. The farm list takes either
             a whole set or a single part, so it is offered on both. */
          partOf.length > 0 ||
          recipe.length > 0 ||
          item.marketSlug !== undefined ||
          item.masteryReq !== undefined ? (
            <>
              {partOf.length > 0 && <OwnedToggle itemId={item.id} itemName={item.name} />}
              {(partOf.length > 0 || recipe.length > 0) && (
                <TrackToggle itemId={item.id} itemName={item.name} />
              )}

              {/* A link, not a price. Live listings would need a proxy — warframe.market
                  sends no CORS headers — and a number that is five minutes stale is worth
                  less than the page showing every open order. The slug is resolved at build
                  time against their own catalogue, so this link is never a guess. */}
              {item.marketSlug !== undefined && (
                <TradeOnly>
                  <a
                    href={`https://warframe.market/items/${item.marketSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={CONTROL}
                  >
                    Trade on warframe.market
                    <span aria-hidden="true">↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </TradeOnly>
              )}
              <MasteryBadge masteryReq={item.masteryReq} />
            </>
          ) : undefined
        }
      />

      {recipe.length > 0 && bestDirect === undefined && relicPaths.length === 0 ? (
        // An assembled item is built, not farmed. Saying "no source found" would be wrong,
        // and the recipe below is the actual answer.
        <p className="mt-6 max-w-prose text-sm text-text-dim">
          Built, not dropped. Farm the {recipe.length} {recipe.length === 1 ? 'part' : 'parts'} below, then craft it.
        </p>
      ) : bestDirect !== undefined && byYield ? (
        /* A stacking item is measured in units, not in odds. "Expected runs: 1" for a
           container holding 80 Endo is true and useless; "80 per run" is the number. */
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SummaryCard
            label={`Best yield / ${bestNoun.one}`}
            value={formatYield(bestDirect.yield)}
            detail="units"
            tone="accent"
          />
          <SummaryCard
            label={`Best chance / ${bestNoun.one}`}
            value={`${(bestDirect.p * 100).toFixed(2)}%`}
          />
          <SummaryCard label="Sources" value={directEdges.length.toLocaleString()} />
        </div>
      ) : bestDirect !== undefined ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* These three all describe ONE source — the best one — so they take that
              source's noun. An enemy is killed, a mission is run: "expected runs: 51" for a
              mod off an eximus unit reads as fifty-one missions when it means fifty-one
              bodies. The table below mixes kinds and handles that separately. */}
          <SummaryCard
            label={`Best chance / ${bestNoun.one}`}
            value={`${(bestDirect.p * 100).toFixed(2)}%`}
            tone="accent"
          />
          <SummaryCard
            label={attemptLabel('Expected', bestNoun)}
            value={expectedRuns(bestDirect.p).toFixed(0)}
          />
          <SummaryCard
            label="95% confident"
            value={String(runsForConfidence(bestDirect.p))}
            detail={attemptPlural(runsForConfidence(bestDirect.p), bestNoun)}
          />
        </div>
      ) : relicPaths.length > 0 ? (
        <>
        {/* Whether it can be farmed TODAY is the first thing a prime part has to answer,
            and "found in 39 relics" answers it wrongly when 37 of them are out of
            rotation. So the farmable count is its own figure, and it is the one that
            changes colour. */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <SummaryCard label="In relics" value={relicPaths.length.toLocaleString()} />
          <SummaryCard
            label="Farmable now"
            value={(relicPaths.length - vaultedCount).toLocaleString()}
            tone={relicPaths.length - vaultedCount > 0 ? 'accent' : 'warn'}
            detail={relicPaths.length - vaultedCount > 0 ? 'in rotation' : 'all vaulted'}
          />
          <SummaryCard label="Vaulted" value={vaultedCount.toLocaleString()} />
        </div>
        <p className="mt-4 max-w-prose text-sm text-text-dim">
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
        <NewPlayerNote>
          A relic is a container you pick up from missions and open at a Void Fissure, which is
          a mission type that appears on the star chart and rotates every few hours. Opening one
          gives you one of its six rewards. <strong className="text-text">Refining</strong> a
          relic with Void Traces makes the rare rewards likelier — Radiant is the top rung.{' '}
          <strong className="text-text">Vaulted</strong> means the relic itself no longer drops,
          so the only ways to get it are trading or waiting for Digital Extremes to unvault it.
        </NewPlayerNote>
        </>
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

      {/* How this TYPE is farmed, before any table. The tables answer "which row is best";
          this answers whether rows are the right thing to be reading at all, which for a
          resource or a currency they are not. */}
      <FarmingGuide
        strategy={strategy}
        noun={bestDirect === undefined ? undefined : bestNoun}
      />

      {/* Routes people actually use, where anyone has written one down. Separate panel and
          separate label from the block above: that one is our reading of the item's type,
          this one is somebody else's claim about the game, carrying its source and its date
          so the reader can weigh it (DESIGN.md § 16.4). */}
      <InsightPanel
        title="Community routes"
        insights={guide?.insights ?? []}
        hasItem={hasItem}
        now={buildTime}
      />

      {/* The signature element, and only where it is the right answer. A relic chain is a
          genuine two-hop route worth drawing; for a resource it would draw "kill one
          container" as though that were a plan (DESIGN.md § 17). */}
      {strategy === 'relic-chain' && <DropChainTrace chain={chain} />}

      {recipe.length > 0 && (
        <RecipeTable rows={recipe} ingredients={ingredients} itemName={item.name} />
      )}

      {/* Weapons only, and only where this weapon actually takes a riven. */}
      {item.marketSlug !== undefined && (
        <MarketPricePanel itemId={item.id} marketSlug={item.marketSlug} />
      )}

      {riven !== undefined && <RivenPanel family={riven} weaponId={item.id} />}

      {/* Direct sources and relics answer the same question two ways, so they are read
          together rather than one scrolled past to reach the other.

          Two columns only when there are two things to show. Most items have one or the
          other, and an unconditional two-column grid rendered the single panel at half
          width with dead space beside it. */}
      {(directEdges.length > 0 || relicPaths.length > 0) && (
        <div
          className={`mt-8 grid items-start gap-6 ${
            directEdges.length > 0 && relicPaths.length > 0 ? 'lg:grid-cols-2' : ''
          }`}
        >
          {directEdges.length > 0 && (
            <Panel className="min-w-0">
              <PanelHeader
                title="Direct sources"
                aside={
                  // Names the sort it is actually using. The header said "by drop rate" on
                  // every page for months, including the ones that are not.
                  `${
                    directEdges.length > SOURCE_LIMIT
                      ? `${String(SOURCE_LIMIT)} of ${String(directEdges.length)}`
                      : String(directEdges.length)
                  } · by ${byYield ? 'yield' : 'drop rate'}`
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Sources that drop {item.name} directly,{' '}
                    {byYield ? 'most units per attempt first' : 'highest drop rate first'}
                  </caption>
                  <thead>
                    <tr className="border-b border-hairline text-left">
                      <th scope="col" className="label px-3 py-2 sm:px-5 font-normal">
                        Source
                      </th>
                      <th scope="col" className="label px-3 py-2 sm:px-5 text-right font-normal">
                        Chance
                      </th>
                      {/* A stacking item is measured in units per attempt; a part you need
                          one of is measured in attempts. Never both — the column is the
                          answer to the question the strategy above already framed. */}
                      <th scope="col" className="label px-3 py-2 sm:px-5 text-right font-normal">
                        {byYield ? `Units / ${bestNoun.one}` : directColumn}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {directEdges.slice(0, SOURCE_LIMIT).map(({ edge, source, p, yield: units }, index) => {
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
                          className="border-b border-hairline/50 last:border-0 transition-colors hover:bg-void-800"
                        >
                          <th scope="row" className="px-3 py-3 sm:px-5 sm:py-2.5 text-left font-normal">
                            <Link
                              href={sourceHref(edge.sourceId, hasItem)}
                              className="text-text transition-colors hover:text-gold"
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
                            {byYield ? formatYield(units) : `~${expectedRuns(p).toFixed(0)}`}
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
                            className="text-text transition-colors hover:text-gold"
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
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline/50 px-3 py-3 sm:px-5 text-sm last:border-0 hover-edge hover:bg-void-800"
              >
                <Link
                  href={sourceHref(edge.sourceId, hasItem)}
                  className="text-text transition-colors hover:text-gold"
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
                  <tr key={reward.itemId} className="border-b border-hairline/50 last:border-0 transition-colors hover:bg-void-800">
                    <th scope="row" className="px-3 py-3 sm:px-5 sm:py-2.5 text-left font-normal">
                      <Link
                        href={`/item/${reward.itemId}`}
                        className="text-text transition-colors hover:text-gold"
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

    </div>
  )
}
