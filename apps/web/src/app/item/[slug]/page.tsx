import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

import {
  REFINEMENT_TABLE,
  expectedRuns,
  perRunChance,
  runsForConfidence,
  runsForRelicPath,
  stageLabel,
} from '@provenance/core'
import type { DropEdge, RelicRarity } from '@provenance/core'

import { Panel, PanelHeader, RarityTag, Stat } from '@/components/Primitives'
import { ProbabilityBar } from '@/components/ProbabilityBar'
import { getDataset } from '@/lib/data'
import { formatMinutes } from '@/lib/format'
import { kindLabel, runMinutes } from '@/lib/effort'

/** Squad size assumed for the share comparison. Becomes a control in a later phase. */
const SHARE_SIZE = 4

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

interface Chain {
  relicId: string
  relicName: string
  rarity: RelicRarity
  vaulted: boolean
  fromRelic: number
  missionName: string | undefined
  missionType: string | undefined
  planet: string | undefined
  stage: string | undefined
  relicChance: number
  composed: number
  minutes: number
  soloRuns: number
  shareRuns: number
}

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { itemsById, sourcesById, edgesByItem, relicsByReward } = await getDataset()

  const item = itemsById.get(slug)
  if (item === undefined) notFound()

  const incoming = edgesByItem.get(slug) ?? []

  // Direct sources, ranked by expected TIME rather than raw chance — a 10% reward on a
  // 20-minute Survival is not the same offer as 10% on a 90-second Capture.
  const directEdges = incoming
    .filter((edge) => !edge.sourceId.startsWith('relic:'))
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

  // ---- relic chains: item <- relic <- mission ---------------------------------
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

    const fromRelic = REFINEMENT_TABLE.radiant[reward.rarity]
    const source = best === undefined ? undefined : sourcesById.get(best.edge.sourceId)
    const relicChance = best === undefined ? 0 : perRunChance(best.edge)

    chains.push({
      relicId: relic.id,
      relicName: relic.id.replace(/-relic$/, '').replace(/-/g, ' ').toUpperCase(),
      rarity: reward.rarity,
      vaulted: relic.vaulted,
      fromRelic,
      missionName: source?.name,
      missionType: source?.missionType,
      planet: source?.planet,
      stage: stageLabel(source?.missionType, best?.edge.rotation),
      relicChance,
      composed: relicChance * fromRelic,
      minutes: best?.minutes ?? 0,
      soloRuns: runsForRelicPath(relicChance, fromRelic, 1),
      shareRuns: runsForRelicPath(relicChance, fromRelic, SHARE_SIZE),
    })
  }

  chains.sort((a, b) => {
    if (a.vaulted !== b.vaulted) return a.vaulted ? 1 : -1
    return a.soloRuns * a.minutes - b.soloRuns * b.minutes
  })

  // ---- the headline -----------------------------------------------------------
  // Must consider BOTH routes. Preferring the relic chain whenever one exists reported
  // 1.11% for Forma when a direct source offers 22.56%.
  const bestChain = chains.find((chain) => !chain.vaulted)
  const bestDirect = directEdges[0]

  const chainMinutes = bestChain === undefined ? Infinity : bestChain.soloRuns * bestChain.minutes
  const directMinutes = bestDirect?.expectedMinutes ?? Infinity

  const headline =
    chainMinutes <= directMinutes && bestChain !== undefined
      ? { p: bestChain.composed, minutes: bestChain.minutes, via: 'relic chain' as const }
      : bestDirect !== undefined
        ? { p: bestDirect.p, minutes: bestDirect.minutes, via: 'direct drop' as const }
        : undefined

  // Enemy and syndicate sources have no per-run duration, so a time estimate would be
  // invented rather than derived. The stat is omitted instead of guessed.
  const headlineMinutes =
    headline?.minutes === undefined ? undefined : expectedRuns(headline.p) * headline.minutes

  // You do not queue "one Corrupted Heavy Gunner" — for enemy sources the unit is kills.
  const headlineNoun =
    headline?.via === 'direct drop' && bestDirect?.source?.kind === 'enemy' ? 'kills' : 'runs'

  const vaultedCount = chains.filter((chain) => chain.vaulted).length
  const maxChain = Math.max(...chains.map((c) => c.composed), 0.0001)
  const maxDirect = Math.max(...directEdges.map((d) => d.p), 0.0001)

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

      {headline !== undefined ? (
        <>
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            {headlineMinutes !== undefined && (
              <Stat label="Fastest route" value={formatMinutes(headlineMinutes)} accent />
            )}
            <Stat
              label={`Expected ${headlineNoun}`}
              value={expectedRuns(headline.p).toFixed(0)}
              accent={headlineMinutes === undefined}
            />
            <Stat
              label={`Chance / ${headlineNoun === 'kills' ? 'kill' : 'run'}`}
              value={(headline.p * 100).toFixed(2)}
              unit="%"
            />
            <Stat
              label="95% confident"
              value={String(runsForConfidence(headline.p))}
              unit={headlineNoun}
            />
          </div>
          <p className="label mt-3">via {headline.via}</p>
        </>
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
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-display text-sm font-semibold">
                    {chain.relicName}
                    {chain.vaulted && <span className="label ml-2">Vaulted</span>}
                  </span>
                  <RarityTag rarity={chain.rarity} />
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
                      {chain.stage !== undefined && <span className="label ml-1">{chain.stage}</span>}
                    </div>

                    {/* Effort, not arithmetic. The solo/share gap is the decision — a
                        full radshare is roughly a third of the runs. */}
                    <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-xs">
                      <div className="flex items-baseline gap-2">
                        <dt className="text-text-faint">Solo</dt>
                        <dd className="data-num text-text">
                          {chain.soloRuns.toFixed(0)} runs
                          <span className="ml-2 text-text-faint">
                            {formatMinutes(chain.soloRuns * chain.minutes)}
                          </span>
                        </dd>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <dt className="text-text-faint">Radshare ×{SHARE_SIZE}</dt>
                        <dd className="data-num text-r-uncommon">
                          {chain.shareRuns.toFixed(0)} runs
                          <span className="ml-2 text-text-faint">
                            {formatMinutes(chain.shareRuns * chain.minutes)}
                          </span>
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-3">
                      <ProbabilityBar value={chain.composed} rarity={chain.rarity} max={maxChain} />
                    </div>
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
            aside={`${String(directEdges.length)} sources · by time`}
          />
          <ul>
            {directEdges.slice(0, 20).map(({ edge, source, p, minutes }, index) => {
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

      <p className="mt-8 text-xs text-text-faint">
        Times are estimates from a hand-curated table of median mission durations, not measured
        data. Relic odds shown at Radiant.
      </p>
    </div>
  )
}
