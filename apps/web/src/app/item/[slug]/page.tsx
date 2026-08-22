import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import {
  REFINEMENT_TABLE,
  expectedRuns,
  missionDurationMinutes,
  perRunChance,
  runsForConfidence,
  shareChance,
} from '@provenance/core'
import type { DropEdge, RelicRarity } from '@provenance/core'

import { Panel, PanelHeader, RarityTag, Stat } from '@/components/Primitives'
import { ProbabilityBar } from '@/components/ProbabilityBar'
import { getDataset } from '@/lib/data'

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

  // The query a player actually types is the item name plus the word "drop".
  return {
    title: `${item.name} drop locations`,
    description: `Every way to get ${item.name} in Warframe, ranked by expected effort.`,
  }
}

interface Chain {
  relicId: string
  relicName: string
  rarity: RelicRarity
  /** No mission currently drops this relic. Shown, marked, never hidden. */
  vaulted: boolean
  /** P(item | relic) at the given refinement. */
  fromRelic: number
  /** Best mission for this relic, absent when vaulted. */
  missionName: string | undefined
  missionType: string | undefined
  planet: string | undefined
  relicChance: number
  composed: number
  minutes: number
}

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { itemsById, sourcesById, edgesByItem, relicsByReward } = await getDataset()

  const item = itemsById.get(slug)
  if (item === undefined) notFound()

  const incoming = edgesByItem.get(slug) ?? []
  const directEdges = incoming.filter((edge) => edge.sourceId.startsWith('mission:'))

  // ---- build the relic chains -------------------------------------------------
  // item <- relic <- mission. The composed probability is the product of the two hops
  // (DESIGN.md 5.2); it is what makes two paths comparable at all.
  const relics = relicsByReward.get(slug) ?? []
  const chains: Chain[] = []

  for (const relic of relics) {
    const reward = relic.rewards.find((r) => r.itemId === slug)
    if (reward === undefined) continue

    const relicItemId = relic.id
    const relicDrops = edgesByItem.get(relicItemId) ?? []

    // The best mission for this relic is the one with the highest chance per minute.
    let best: { edge: DropEdge; minutes: number; perMin: number } | undefined
    for (const edge of relicDrops) {
      const source = sourcesById.get(edge.sourceId)
      if (source === undefined || source.kind !== 'mission') continue
      const minutes = missionDurationMinutes(source.missionType)
      const perMin = perRunChance(edge) / minutes
      if (best === undefined || perMin > best.perMin) best = { edge, minutes, perMin }
    }

    const fromRelic = REFINEMENT_TABLE.radiant[reward.rarity]
    const source = best === undefined ? undefined : sourcesById.get(best.edge.sourceId)
    const relicChance = best === undefined ? 0 : perRunChance(best.edge)

    // A vaulted relic has no farmable source, but it is still a real answer to "where does
    // this come from" — it is marked and desaturated, never dropped (DESIGN.md § 8).
    chains.push({
      relicId: relicItemId,
      relicName: relic.id.replace(/-relic$/, '').replace(/-/g, ' ').toUpperCase(),
      rarity: reward.rarity,
      vaulted: relic.vaulted,
      fromRelic,
      missionName: source?.name,
      missionType: source?.missionType,
      planet: source?.planet,
      relicChance,
      composed: relicChance * fromRelic,
      minutes: best?.minutes ?? 0,
    })
  }

  // Farmable paths first, then vaulted ones for reference.
  chains.sort((a, b) => {
    if (a.vaulted !== b.vaulted) return a.vaulted ? 1 : -1
    if (a.minutes === 0 || b.minutes === 0) return b.composed - a.composed
    return b.composed / b.minutes - a.composed / a.minutes
  })

  // Headline numbers describe what you can actually farm today, so vaulted paths are
  // excluded from them even though they still render below.
  const bestChain = chains.find((chain) => !chain.vaulted)
  const vaultedCount = chains.filter((chain) => chain.vaulted).length
  const bestDirect = directEdges.reduce<DropEdge | undefined>(
    (acc, edge) => (acc === undefined || perRunChance(edge) > perRunChance(acc) ? edge : acc),
    undefined,
  )

  const headlineP = bestChain?.composed ?? (bestDirect ? perRunChance(bestDirect) : 0)
  const maxChain = chains.length > 0 ? Math.max(...chains.map((c) => c.composed), 0.0001) : 1
  const maxDirect =
    directEdges.length > 0 ? Math.max(...directEdges.map((e) => perRunChance(e))) : 1

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:px-6 sm:py-16">
      <nav className="label mb-6">
        <Link href="/" className="hover:text-text">
          Provenance
        </Link>
        <span className="mx-2 text-hairline-strong">/</span>
        <span>{item.category}</span>
      </nav>

      <h1 className="font-display text-xl font-bold text-orokin sm:text-2xl">{item.name}</h1>

      {headlineP > 0 ? (
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
          <Stat label="Best chance / run" value={(headlineP * 100).toFixed(2)} unit="%" accent />
          <Stat label="Expected runs" value={expectedRuns(headlineP).toFixed(0)} />
          <Stat label="95% confident" value={String(runsForConfidence(headlineP))} unit="runs" />
          <Stat
            label="Est. time"
            value={(expectedRuns(headlineP) * (bestChain?.minutes ?? 5)).toFixed(0)}
            unit="min"
          />
        </div>
      ) : (
        <p className="mt-6 text-sm text-text-dim">
          No source found. This item may be quest-locked, vaulted, or bought rather than farmed.
        </p>
      )}

      {chains.length > 0 && (
        <Panel className="mt-10">
          <PanelHeader
            title="Relic chains"
            aside={
              vaultedCount > 0
                ? `${String(chains.length)} paths · ${String(vaultedCount)} vaulted · radiant`
                : `${String(chains.length)} paths · radiant`
            }
          />
          <ul>
            {chains.slice(0, 16).map((chain) => (
              <li
                key={chain.relicId}
                className={`border-b border-hairline/50 px-5 py-4 last:border-0 ${
                  chain.vaulted ? 'vaulted' : ''
                }`}
              >
                {/* The trace: item <- relic <- mission, with probability compounding
                    visibly at each hop. This is the signature element. */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-display text-sm font-semibold">
                    {chain.relicName}
                    {chain.vaulted && <span className="label ml-2">Vaulted</span>}
                  </span>
                  <RarityTag rarity={chain.rarity} />
                </div>

                <div className="mt-3 border-l border-hairline-strong pl-4 text-sm text-text-dim">
                  {chain.missionName === undefined ? (
                    <p className="text-text-faint">
                      No active source. Trade for the relic or wait for an unvaulting.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-text">{chain.missionName}</span>
                        {chain.planet !== undefined && (
                          <span className="text-text-faint">{chain.planet}</span>
                        )}
                        {chain.missionType !== undefined && (
                          <span className="text-text-faint">· {chain.missionType}</span>
                        )}
                      </div>
                      <div className="data-num mt-1 text-xs text-text-faint">
                        {(chain.relicChance * 100).toFixed(2)}% relic
                        <span className="mx-1.5">×</span>
                        {(chain.fromRelic * 100).toFixed(2)}% reward
                        <span className="mx-1.5">=</span>
                        <span className="text-text">{(chain.composed * 100).toFixed(3)}%</span>
                      </div>
                    </>
                  )}
                </div>

                {!chain.vaulted && (
                  <>
                    <div className="mt-3">
                      <ProbabilityBar value={chain.composed} rarity={chain.rarity} max={maxChain} />
                    </div>
                    <div className="data-num mt-2 text-xs text-text-faint">
                      ~{expectedRuns(chain.composed).toFixed(0)} runs
                      <span className="mx-1.5 text-hairline-strong">|</span>~
                      {(expectedRuns(chain.composed) * chain.minutes).toFixed(0)} min
                      <span className="mx-1.5 text-hairline-strong">|</span>
                      {(shareChance(chain.fromRelic, 4) * 100).toFixed(1)}% per relic in a full
                      radshare
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {directEdges.length > 0 && (
        <Panel className="mt-8">
          <PanelHeader title="Direct sources" aside={`${String(directEdges.length)} sources`} />
          <ul>
            {directEdges.slice(0, 20).map((edge, index) => {
              const source = sourcesById.get(edge.sourceId)
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
                    {edge.rotation != null && (
                      <span className="label ml-auto">Rotation {edge.rotation}</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <ProbabilityBar value={perRunChance(edge)} max={maxDirect} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>
      )}

      <p className="mt-8 text-xs text-text-faint">
        Times are estimates from a hand-curated table of median mission durations, not measured
        data. Relic odds shown at Radiant.
      </p>
    </div>
  )
}
