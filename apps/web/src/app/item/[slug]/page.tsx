import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import {
  FISSURE_RUN_MINUTES,
  bestRefinementFor,
  expectedRuns,
  perRunChance,
  relicsNeeded,
  runsForConfidence,
  stageLabel,
} from '@provenance/core'
import type { DropEdge, RelicRarity } from '@provenance/core'

import { SearchTrigger } from '@/components/CommandPalette'
import { Panel, PanelHeader, RarityTag, Stat } from '@/components/Primitives'
import { ProbabilityBar } from '@/components/ProbabilityBar'
import { getDataset } from '@/lib/data'
import { ceilCount, formatMinutes } from '@/lib/format'
import { kindLabel, runMinutes } from '@/lib/effort'

/** Squad size assumed for the share comparison. Becomes a control in a later phase. */
const SHARE_SIZE = 4

/** How many rows each list shows. Both headers disclose when they are truncating. */
const CHAIN_LIMIT = 12
const SOURCE_LIMIT = 20

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
    description: `Every way to get ${item.name} in Warframe, ranked by expected effort.`,
  }
}

/** One way of getting there: how many relics, how much farming, how long in total. */
interface Plan {
  relics: number
  farmRuns: number
  minutes: number
}

interface Chain {
  relicId: string
  relicName: string
  rarity: RelicRarity
  vaulted: boolean
  refinement: string
  perRelic: number
  missionName: string | undefined
  missionType: string | undefined
  planet: string | undefined
  stage: string | undefined
  relicChance: number
  solo: Plan
  share: Plan
}

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { itemsById, sourcesById, edgesByItem, relicsByReward, relicsById } = await getDataset()

  const item = itemsById.get(slug)
  if (item === undefined) notFound()

  const incoming = edgesByItem.get(slug) ?? []

  // Syndicate offerings are guaranteed purchases priced in rank and standing, not RNG.
  // Ranking them alongside farms put a 100% edge with no run cost at the top of a list
  // sorted by expected time — or, because they carry no duration, buried them below a
  // 3.57% mission. Neither is the truth, so they get their own section.
  const vendorOfferings = incoming
    .filter((edge) => sourcesById.get(edge.sourceId)?.kind === 'syndicate')
    .map((edge) => ({ edge, source: sourcesById.get(edge.sourceId) }))

  const directEdges = incoming
    .filter((edge) => {
      if (edge.sourceId.startsWith('relic:')) return false
      return sourcesById.get(edge.sourceId)?.kind !== 'syndicate'
    })
    .map((edge) => {
      const source = sourcesById.get(edge.sourceId)
      const p = perRunChance(edge)
      const minutes = runMinutes(source)
      return {
        edge,
        source,
        p,
        minutes,
        expectedMinutes: minutes === undefined ? undefined : expectedRuns(p) * minutes,
      }
    })
    // Timeable sources first, ranked by time; then the rest ranked by chance. An enemy
    // drop and a Capture run are not comparable in minutes, so they are not mixed.
    .sort((a, b) => {
      if (a.expectedMinutes !== undefined && b.expectedMinutes !== undefined) {
        return a.expectedMinutes - b.expectedMinutes
      }
      if (a.expectedMinutes !== undefined) return -1
      if (b.expectedMinutes !== undefined) return 1
      return b.p - a.p
    })

  // ---- relic chains -----------------------------------------------------------
  // Modelled in RELICS, not in per-run percentages. Farming a relic and cracking it are
  // separate activities — nobody opens a relic on the run that dropped it — so the effort
  // is: relics needed, the runs to farm them, and the fissure runs to open them.
  const relics = relicsByReward.get(slug) ?? []
  const chains: Chain[] = []

  for (const relic of relics) {
    const reward = relic.rewards.find((r) => r.itemId === slug)
    if (reward === undefined) continue

    const relicDrops = edgesByItem.get(relic.id) ?? []

    let best: { edge: DropEdge; minutes: number; expectedMinutes: number } | undefined
    for (const edge of relicDrops) {
      const source = sourcesById.get(edge.sourceId)
      if (source === undefined || source.kind === 'relic') continue
      const minutes = runMinutes(source) ?? 5
      const expectedMinutes = expectedRuns(perRunChance(edge)) * minutes
      if (best === undefined || expectedMinutes < best.expectedMinutes) {
        best = { edge, minutes, expectedMinutes }
      }
    }

    // NOT always Radiant. For a common reward Intact is better (25.33% vs 16.67%), so
    // assuming Radiant would both overstate the effort and advise wasting traces.
    const { refinement, chance: perRelic } = bestRefinementFor(reward.rarity)

    const source = best === undefined ? undefined : sourcesById.get(best.edge.sourceId)
    const relicChance = best === undefined ? 0 : perRunChance(best.edge)
    const runsPerRelic = relicChance > 0 ? 1 / relicChance : Infinity
    const missionMinutes = best?.minutes ?? 0

    const plan = (players: number): Plan => {
      const needed = relicsNeeded(perRelic, players)
      const farmRuns = needed * runsPerRelic
      // A vaulted relic has no source, so runsPerRelic is Infinity and missionMinutes is
      // 0 — and Infinity * 0 is NaN, which would poison the sort comparator below and
      // make the ordering of vaulted rows non-deterministic. Keep it Infinity.
      const farmMinutes = Number.isFinite(farmRuns) ? farmRuns * missionMinutes : Infinity
      return {
        relics: needed,
        farmRuns,
        minutes: farmMinutes + needed * FISSURE_RUN_MINUTES,
      }
    }

    chains.push({
      relicId: relic.id,
      // The item table carries the proper display name ("Axi A1 Relic"); shouting the
      // slug back as "AXI A1" was neither the game's name for it nor consistent with the
      // relic's own page.
      relicName: itemsById.get(relic.id)?.name ?? relic.id,
      rarity: reward.rarity,
      vaulted: relic.vaulted,
      refinement,
      perRelic,
      missionName: source?.name,
      missionType: source?.missionType,
      planet: source?.planet,
      stage: stageLabel(source?.missionType, best?.edge.rotation),
      relicChance,
      solo: plan(1),
      share: plan(SHARE_SIZE),
    })
  }

  chains.sort((a, b) => {
    if (a.vaulted !== b.vaulted) return a.vaulted ? 1 : -1
    return a.solo.minutes - b.solo.minutes
  })

  // ---- the headline -----------------------------------------------------------
  const bestChain = chains.find((chain) => !chain.vaulted)
  const bestDirect = directEdges[0]

  const chainMinutes = bestChain?.solo.minutes ?? Infinity
  const directMinutes = bestDirect?.expectedMinutes ?? Infinity
  const preferChain = bestChain !== undefined && chainMinutes <= directMinutes

  const vaultedCount = chains.filter((chain) => chain.vaulted).length
  // reduce, not Math.max(...spread): one item reaches 810 direct sources today and a
  // spread that large is a stack-size gamble for no benefit.
  const maxDirect = directEdges.reduce((max, d) => (d.p > max ? d.p : max), 0.0001)

  // This item IS a relic — show what it contains, rather than "no source found".
  const asRelic = relicsById.get(slug)
  const relicContents =
    asRelic === undefined
      ? []
      : asRelic.rewards
          .map((reward) => ({
            ...reward,
            name: itemsById.get(reward.itemId)?.name ?? reward.itemId,
            chance: bestRefinementFor(reward.rarity),
          }))
          .sort((a, b) => a.chance.chance - b.chance.chance)

  // Enemy and syndicate sources have no per-run duration, so a time estimate would be
  // invented rather than derived. The stat is omitted instead of guessed.
  const directNoun = bestDirect?.source?.kind === 'enemy' ? 'kills' : 'runs'

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-6 sm:py-16">
      <nav className="label mb-6 flex items-center justify-between gap-4">
        <span>
          <Link href="/" className="transition-colors hover:text-text">
            Provenance
          </Link>
          <span className="mx-2 text-hairline-strong">/</span>
          <span>{item.category}</span>
        </span>
        {/* A visible affordance: a keyboard shortcut nobody can see is not a feature. */}
        <SearchTrigger compact />
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">{item.name}</h1>

      {preferChain && bestChain !== undefined ? (
        <>
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            <Stat label="Fastest route" value={formatMinutes(bestChain.solo.minutes)} accent />
            <Stat label="Relics needed" value={String(ceilCount(bestChain.solo.relics))} />
            <Stat label="Farm runs" value={bestChain.solo.farmRuns.toFixed(0)} />
            <Stat
              label={`In a ×${String(SHARE_SIZE)} share`}
              value={formatMinutes(bestChain.share.minutes)}
            />
          </div>
          <p className="label mt-3">
            via {bestChain.relicName} at {bestChain.refinement}
          </p>
        </>
      ) : bestDirect !== undefined ? (
        <>
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            {bestDirect.expectedMinutes !== undefined && (
              <Stat
                label="Fastest route"
                value={formatMinutes(bestDirect.expectedMinutes)}
                accent
              />
            )}
            <Stat
              label={`Expected ${directNoun}`}
              value={expectedRuns(bestDirect.p).toFixed(0)}
              accent={bestDirect.expectedMinutes === undefined}
            />
            <Stat
              label={`Chance / ${directNoun === 'kills' ? 'kill' : 'run'}`}
              value={(bestDirect.p * 100).toFixed(2)}
              unit="%"
            />
            <Stat
              label="95% confident"
              value={String(runsForConfidence(bestDirect.p))}
              unit={directNoun}
            />
          </div>
          <p className="label mt-3">via direct drop</p>
        </>
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

      {vendorOfferings.length > 0 && (
        <Panel className="mt-10">
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
                {edge.stage !== undefined && (
                  <span className="text-xs text-text-faint">{edge.stage}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {relicContents.length > 0 && (
        <Panel className="mt-10">
          <PanelHeader
            title="Relic contents"
            aside={`${String(relicContents.length)} rewards · best refinement`}
          />
          <table className="w-full text-sm">
            <caption className="sr-only">Rewards contained in this relic</caption>
            <thead>
              <tr className="border-b border-hairline text-left">
                <th scope="col" className="label px-5 py-2 font-normal">
                  Reward
                </th>
                <th scope="col" className="label px-5 py-2 text-right font-normal">
                  Rarity
                </th>
                <th scope="col" className="label px-5 py-2 text-right font-normal">
                  Best odds
                </th>
              </tr>
            </thead>
            <tbody>
              {relicContents.map((reward) => (
                <tr key={reward.itemId} className="border-b border-hairline/50 last:border-0">
                  <th scope="row" className="px-5 py-2.5 text-left font-normal">
                    <Link href={`/item/${reward.itemId}`} className="text-text hover:text-orokin">
                      {reward.name}
                    </Link>
                  </th>
                  <td className="px-5 py-2.5 text-right">
                    <RarityTag rarity={reward.rarity} />
                  </td>
                  <td className="data-num px-5 py-2.5 text-right text-text">
                    {(reward.chance.chance * 100).toFixed(2)}%
                    <span className="ml-2 text-xs text-text-faint">
                      {reward.chance.refinement}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {chains.length > 0 && (
        <Panel className="mt-10">
          <PanelHeader
            title="Relic chains"
            aside={
              // Say what is actually on screen. "380 paths" above a list of 12 reads as a
              // complete list, which it is not.
              chains.length > CHAIN_LIMIT
                ? `${String(CHAIN_LIMIT)} of ${String(chains.length)} · ${String(vaultedCount)} vaulted`
                : vaultedCount > 0
                  ? `${String(chains.length)} paths · ${String(vaultedCount)} vaulted`
                  : `${String(chains.length)} paths`
            }
          />
          <ul>
            {chains.slice(0, CHAIN_LIMIT).map((chain) => (
              <li
                key={chain.relicId}
                className={`border-b border-hairline/50 px-5 py-4 last:border-0 ${
                  chain.vaulted ? 'vaulted' : ''
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-display text-sm font-semibold">
                    {chain.relicName}
                    {chain.vaulted && <span className="label ml-2">Vaulted</span>}
                  </span>
                  <span className="flex items-baseline gap-3">
                    <RarityTag rarity={chain.rarity} />
                    <span className="label">
                      best {chain.refinement}{' '}
                      <span className="data-num">{(chain.perRelic * 100).toFixed(2)}%</span>
                    </span>
                  </span>
                </div>

                {chain.missionName === undefined ? (
                  <p className="mt-2 border-l border-hairline-strong pl-4 text-sm text-text-faint">
                    No active source. Trade for the relic or wait for an unvaulting.
                  </p>
                ) : (
                  <div className="mt-2 border-l border-hairline-strong pl-4">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="text-text">{chain.missionName}</span>
                      {chain.planet !== undefined && (
                        <span className="text-text-faint">{chain.planet}</span>
                      )}
                      {chain.missionType !== undefined && (
                        <span className="text-text-faint">· {chain.missionType}</span>
                      )}
                      {chain.stage !== undefined && (
                        <span className="label ml-1">{chain.stage}</span>
                      )}
                    </div>

                    {/* Relics, runs and time — the units a player plans in. A per-run
                        percentage is not one of them: you never crack a relic on the run
                        that dropped it. */}
                    <table className="mt-3 w-full max-w-md text-xs">
                      <thead>
                        <tr className="text-left text-text-faint">
                          <th scope="col" className="pb-1 font-normal" />
                          <th scope="col" className="pb-1 text-right font-normal">
                            Relics
                          </th>
                          <th scope="col" className="pb-1 text-right font-normal">
                            Farm runs
                          </th>
                          <th scope="col" className="pb-1 text-right font-normal">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row" className="py-0.5 text-left font-normal text-text-dim">
                            Solo
                          </th>
                          <td className="data-num py-0.5 text-right text-text">
                            {ceilCount(chain.solo.relics)}
                          </td>
                          <td className="data-num py-0.5 text-right text-text">
                            {chain.solo.farmRuns.toFixed(0)}
                          </td>
                          <td className="data-num py-0.5 text-right text-text">
                            {formatMinutes(chain.solo.minutes)}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row" className="py-0.5 text-left font-normal text-text-dim">
                            Share ×{SHARE_SIZE}
                          </th>
                          <td className="data-num py-0.5 text-right text-r-uncommon">
                            {ceilCount(chain.share.relics)}
                          </td>
                          <td className="data-num py-0.5 text-right text-r-uncommon">
                            {chain.share.farmRuns.toFixed(0)}
                          </td>
                          <td className="data-num py-0.5 text-right text-r-uncommon">
                            {formatMinutes(chain.share.minutes)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {directEdges.length > 0 && (
        <Panel className="mt-8">
          <PanelHeader
            title="Direct sources"
            aside={
              directEdges.length > SOURCE_LIMIT
                ? `${String(SOURCE_LIMIT)} of ${String(directEdges.length)} · by time`
                : `${String(directEdges.length)} sources · by time`
            }
          />
          <ul>
            {directEdges.slice(0, SOURCE_LIMIT).map(({ edge, source, p, minutes }, index) => {
              const stage = stageLabel(source?.missionType, edge.rotation)
              const kind = kindLabel(source)
              return (
                <li
                  key={`${edge.sourceId}-${String(index)}`}
                  className="border-b border-hairline/50 px-5 py-3 last:border-0"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="text-text">{source?.name ?? edge.sourceId}</span>
                    {source?.planet !== undefined && (
                      <span className="text-text-faint">{source.planet}</span>
                    )}
                    {source?.missionType !== undefined && (
                      <span className="text-text-faint">· {source.missionType}</span>
                    )}
                    {kind !== undefined && <span className="label">{kind}</span>}
                    {stage !== undefined && <span className="label ml-auto">{stage}</span>}
                  </div>
                  <div className="data-num mt-1 text-xs text-text-faint">
                    ~{expectedRuns(p).toFixed(0)} {source?.kind === 'enemy' ? 'kills' : 'runs'}
                    {minutes !== undefined && (
                      <>
                        <span className="mx-1.5 text-hairline-strong">|</span>
                        {formatMinutes(expectedRuns(p) * minutes)}
                      </>
                    )}
                  </div>
                  <div className="mt-2">
                    <ProbabilityBar value={p} max={maxDirect} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      {/* Only explain the relic assumptions on pages that actually make them. */}
      {(chains.length > 0 || relicContents.length > 0) && (
        <p className="mt-8 max-w-prose text-xs text-text-faint">
          Odds assume the refinement that is best for that reward&rsquo;s rarity — Intact for
          commons, since refining trades common odds for rare ones.
          {chains.length > 0 && (
            <>
              {' '}
              Totals include {FISSURE_RUN_MINUTES} minutes per fissure run to crack each relic.
              Mission durations are hand-curated estimates, not measured data.
            </>
          )}
        </p>
      )}
    </div>
  )
}
