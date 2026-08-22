import type { DropEdge, Rotation, Source, SourceKind } from '@provenance/core'
import { slug } from './slug'
import {
  normalizeReward,
  rewardName,
  type RawBountyTier,
  type RawEnemyTable,
  type RawKeyReward,
  type RawNamedReward,
  type RawSyndicateItem,
  type RawTransient,
} from './upstream'

/**
 * Parsers for the secondary drop tables — bounties, enemies, sorties, transient
 * objectives, keys and syndicates.
 *
 * Each upstream file has its own shape and its own name for the same field, so these stay
 * separate rather than being forced through one generic reader. What they share is the
 * output contract: Sources and DropEdges that look identical to the mission ones, so the
 * query side never has to know where an edge came from.
 */

export interface Parsed {
  sources: Source[]
  edges: DropEdge[]
  /** Every item name encountered, for the item table. */
  names: string[]
  /** Rewards dropped because upstream gave no chance for them. */
  unknownChance: number
}

function empty(): Parsed {
  return { sources: [], edges: [], names: [], unknownChance: 0 }
}

function toRotation(key: string): Rotation | null {
  return key === 'A' || key === 'B' || key === 'C' ? key : null
}

function rotatedEntries(
  rewards: RawNamedReward[] | Record<string, RawNamedReward[]>,
): Array<[Rotation | null, RawNamedReward]> {
  if (Array.isArray(rewards)) return rewards.map((reward) => [null, reward])
  const out: Array<[Rotation | null, RawNamedReward]> = []
  for (const [key, list] of Object.entries(rewards)) {
    const rotation = toRotation(key)
    for (const reward of list) out.push([rotation, reward])
  }
  return out
}

/** Shared emitter: one source, its rewards, done. */
function emit(
  parsed: Parsed,
  source: Source,
  entries: Array<[Rotation | null, RawNamedReward]>,
): void {
  parsed.sources.push(source)
  for (const [rotation, reward] of entries) {
    const name = rewardName(reward)
    if (name === undefined) continue
    if (reward.chance === null) {
      parsed.unknownChance++
      continue
    }
    parsed.names.push(name)
    const { chance, quantity } = normalizeReward(reward.chance)
    parsed.edges.push({
      itemId: slug(name),
      sourceId: source.id,
      chance,
      rotation,
      ...(reward.stage === undefined ? {} : { stage: reward.stage }),
      quantity,
      provenance: 'official',
    })
  }
}

/**
 * Bounties. Cetus / Solaris / Deimos / Zariman / Entrati Lab / Hex share a shape, so one
 * parser covers all six; `syndicate` only supplies the id prefix and display name.
 */
export function parseBounties(raw: RawBountyTier[], syndicate: string): Parsed {
  const parsed = empty()
  for (const tier of raw) {
    emit(
      parsed,
      {
        id: `bounty:${slug(syndicate)}/${slug(tier.bountyLevel)}`,
        kind: 'bounty',
        name: tier.bountyLevel,
        planet: syndicate,
      },
      rotatedEntries(tier.rewards),
    )
  }
  return parsed
}

/** Transient objectives — Arbitrations, Sanctuary Onslaught, event nodes. Rotation is a
 *  property of the reward here rather than a key of the container. */
export function parseTransient(raw: RawTransient[]): Parsed {
  const parsed = empty()
  for (const objective of raw) {
    emit(
      parsed,
      {
        id: `transient:${slug(objective.objectiveName)}`,
        kind: 'transient',
        name: objective.objectiveName,
      },
      objective.rewards.map((reward) => [
        reward.rotation === undefined ? null : toRotation(reward.rotation),
        reward,
      ]),
    )
  }
  return parsed
}

export function parseKeys(raw: RawKeyReward[]): Parsed {
  const parsed = empty()
  for (const key of raw) {
    emit(
      parsed,
      { id: `other:${slug(key.keyName)}`, kind: 'other', name: key.keyName },
      rotatedEntries(key.rewards),
    )
  }
  return parsed
}

/** Sortie rewards are one flat table shared by the whole rotation. */
export function parseSorties(raw: RawNamedReward[]): Parsed {
  const parsed = empty()
  emit(
    parsed,
    { id: 'sortie:daily', kind: 'sortie', name: 'Sortie' },
    raw.map((reward) => [null, reward]),
  )
  return parsed
}

export function parseSyndicates(raw: Record<string, RawSyndicateItem[]>): Parsed {
  const parsed = empty()
  for (const [name, offerings] of Object.entries(raw)) {
    emit(
      parsed,
      { id: `syndicate:${slug(name)}`, kind: 'syndicate', name },
      offerings.map((offering) => [
        null,
        { item: offering.item, chance: offering.chance } satisfies RawNamedReward,
      ]),
    )
  }
  return parsed
}

/**
 * Enemy drop tables.
 *
 * These carry two probabilities that must be COMPOSED, not conflated: the chance the
 * enemy rolls on this table at all, and the chance of a given entry within it. A mod at
 * 12.5% behind a 5% table gate is a 0.625% drop, and reporting the 12.5% would be a
 * twenty-fold overstatement.
 *
 * The gate arrives as a percent string, and enemyModTables ships it twice under two
 * spellings (DESIGN.md § 10.2) — the misspelling is accepted as a fallback.
 *
 * `items` and `mods` are also duplicated against each other in enemyBlueprintTables, with
 * matching _ids, so entries are deduped by (name, chance) before emitting.
 */
export function parseEnemyTables(raw: RawEnemyTable[], kind: SourceKind = 'enemy'): Parsed {
  const parsed = empty()

  for (const entry of raw) {
    const name = entry.enemyName ?? entry.source
    if (name === undefined) continue

    const gateRaw =
      entry.enemyModDropChance ?? entry.ememyModDropChance ?? entry.enemyItemDropChance
    const gate = gateRaw === undefined || gateRaw === null ? 1 : normalizeReward(gateRaw).chance

    const sourceId = `${kind}:${slug(name)}`
    const rewards = [...(entry.items ?? []), ...(entry.mods ?? []), ...(entry.blueprints ?? [])]

    const seen = new Set<string>()
    const deduped: RawNamedReward[] = []
    for (const reward of rewards) {
      const rewardLabel = rewardName(reward)
      if (rewardLabel === undefined) continue
      if (reward.chance === null) {
        parsed.unknownChance++
        continue
      }
      const key = `${rewardLabel}|${String(reward.chance)}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(reward)
    }
    if (deduped.length === 0) continue

    parsed.sources.push({ id: sourceId, kind, name })
    for (const reward of deduped) {
      const rewardLabel = rewardName(reward)
      if (rewardLabel === undefined || reward.chance === null) continue
      parsed.names.push(rewardLabel)
      const { chance, quantity } = normalizeReward(reward.chance)
      parsed.edges.push({
        itemId: slug(rewardLabel),
        sourceId,
        // The composition. This is the whole reason enemy tables get their own parser.
        chance: gate * chance,
        quantity,
        provenance: 'official',
      })
    }
  }

  return parsed
}

/** Merge several parsed tables into one. */
export function mergeParsed(parts: Parsed[]): Parsed {
  const merged = empty()
  for (const part of parts) {
    merged.sources.push(...part.sources)
    merged.edges.push(...part.edges)
    merged.names.push(...part.names)
    merged.unknownChance += part.unknownChance
  }
  return merged
}
