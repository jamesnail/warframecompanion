import { z } from 'zod'

import type { SolNode } from '@provenance/core'

import { bossOf, factionOf, missionTypeOf, modifierOf, relicTierOf } from './world-enums'

/**
 * Warframe world state: what is happening in the game right now.
 *
 * This is the one dataset here that cannot be committed. Fissures expire in one to three
 * hours and Baro Ki'Teer is present two days in fourteen, so a daily static build would ship
 * a page that is wrong most of the time — actively wrong, not merely stale.
 *
 * Read from Digital Extremes' own `worldState`, by way of the browse.wf mirror, which
 * republishes it minutely and sends `access-control-allow-origin: *`. That matters twice
 * over: the open header is why this needs no server route, leaving constraint 3's single
 * escape hatch unspent, and taking DE's payload rather than somebody else's parsed summary
 * is why this survived the parsed mirror it replaced going dark for six hours.
 *
 * The cost is that everything arrives as an internal token — `SolNode232`, `VoidT3`,
 * `MT_VOID_CASCADE` — so this module is mostly translation. Node ids resolve through the
 * committed star chart; the enums live in world-enums.ts.
 *
 * Every section is parsed on its own, because DE adds fields to this payload regularly and
 * one unfamiliar shape must cost the section it appears in rather than the whole page.
 */

function msOf(value: unknown): number | undefined {
  // DE wraps timestamps as { $date: { $numberLong: "…" } }, sometimes flattened a level.
  const unwrap = (input: unknown): unknown => {
    if (typeof input === 'object' && input !== null && '$date' in input) {
      // `in` already narrows these, so no cast is needed.
      const inner = input.$date
      if (typeof inner === 'object' && inner !== null && '$numberLong' in inner) {
        return inner.$numberLong
      }
      return inner
    }
    return input
  }
  const raw = unwrap(value)
  const ms = typeof raw === 'string' ? Number(raw) : raw
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/**
 * DE publishes `Time` as unix SECONDS, unlike every other timestamp in the payload.
 *
 * Reading it through msOf treats 1787763002 as a millisecond value — 1970 — which makes
 * every payload look 56 years old and trips the staleness guard on a perfectly healthy feed.
 * Anything below this threshold is seconds; a real millisecond timestamp is far larger.
 */
const MS_THRESHOLD = 1e12

function secondsOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value < MS_THRESHOLD ? value * 1000 : value
}

const RawMission = z.object({
  _id: z.object({ $oid: z.string() }).optional(),
  Node: z.string(),
  Expiry: z.unknown().optional(),
  MissionType: z.string().optional(),
  Modifier: z.string().optional(),
  ActiveMissionTier: z.string().optional(),
  Hard: z.boolean().optional(),
})

const RawSortie = z.object({
  _id: z.object({ $oid: z.string() }).optional(),
  Expiry: z.unknown().optional(),
  Boss: z.string().optional(),
  Variants: z
    .array(
      z.object({
        missionType: z.string().optional(),
        modifierType: z.string().optional(),
        node: z.string().optional(),
      }),
    )
    .optional(),
  Missions: z
    .array(z.object({ missionType: z.string().optional(), node: z.string().optional() }))
    .optional(),
})

const RawTrader = z.object({
  Activation: z.unknown().optional(),
  Expiry: z.unknown().optional(),
  Character: z.string().optional(),
  Node: z.string().optional(),
  Manifest: z
    .array(
      z.object({
        ItemType: z.string(),
        PrimePrice: z.number().optional(),
        RegularPrice: z.number().optional(),
      }),
    )
    .optional(),
})

const RawInvasion = z.object({
  id: z.string().optional(),
  node: z.string(),
  ally: z.string().optional(),
  enemy: z.string().optional(),
})

export interface Fissure {
  id: string
  node: string
  planet: string | undefined
  sourceId: string | undefined
  missionType: string | undefined
  faction: string | undefined
  tier: string
  expiry: number
  isHard: boolean
  isStorm: boolean
}

export interface Invasion {
  id: string
  node: string
  planet: string | undefined
  sourceId: string | undefined
  attacker: string | undefined
  defender: string | undefined
}

export interface SortieLike {
  boss: string | undefined
  expiry: number | undefined
  variants: {
    node: string
    planet: string | undefined
    missionType: string | undefined
    modifier: string | undefined
  }[]
}

export interface VoidTrader {
  character: string | undefined
  node: string | undefined
  activation: number | undefined
  expiry: number | undefined
  inventory: { item: string; ducats: number | undefined; credits: number | undefined }[]
}

export interface WorldState {
  /** When DE generated it, where the feed says so. */
  timestamp: number | undefined
  fissures: Fissure[]
  invasions: Invasion[]
  sortie: SortieLike | undefined
  archonHunt: SortieLike | undefined
  voidTrader: VoidTrader | undefined
}

/**
 * The committed star chart, keyed by DE's internal id.
 *
 * `sourceId` is set by the server ONLY where this site actually has a page for the node.
 * Deriving it here from planet and name would look right and 404 for the ~15% of star-chart
 * nodes that have no unique drops and so never reach the drop tables — the same mistake an
 * earlier version of this page shipped.
 */
export type NodeIndex = Record<string, SolNode & { sourceId?: string }>

interface Place {
  node: string
  planet: string | undefined
  sourceId: string | undefined
  faction: string | undefined
  missionType: string | undefined
}

function place(index: NodeIndex, id: string): Place {
  const node = index[id]
  if (node === undefined) {
    // Better an internal id than a blank: it is at least searchable, and it says the star
    // chart needs refreshing rather than quietly dropping a live fissure.
    return {
      node: id,
      planet: undefined,
      sourceId: undefined,
      faction: undefined,
      missionType: undefined,
    }
  }
  return {
    node: node.name,
    planet: node.planet,
    sourceId: node.sourceId,
    faction: node.faction,
    missionType: node.missionType,
  }
}

function many<T>(value: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(value)) return []
  const out: T[] = []
  for (const entry of value) {
    const parsed = schema.safeParse(entry)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/**
 * Read DE's payload plus the separate invasions feed.
 *
 * Deliberately never throws. A page that renders four of its panels is useful; one that
 * errors because DE added a field to Conquests is not.
 */
export function parseWorldState(raw: unknown, invasionsRaw: unknown, index: NodeIndex): WorldState {
  const root = (raw ?? {}) as Record<string, unknown>

  const fissures: Fissure[] = []
  const addFissure = (mission: z.infer<typeof RawMission>, isStorm: boolean): void => {
    const tier = relicTierOf(mission.Modifier ?? mission.ActiveMissionTier)
    const expiry = msOf(mission.Expiry)
    if (tier === undefined || expiry === undefined) return
    const where = place(index, mission.Node)
    fissures.push({
      id: mission._id?.$oid ?? `${mission.Node}-${String(expiry)}`,
      node: where.node,
      planet: where.planet,
      sourceId: where.sourceId,
      faction: where.faction,
      // A Railjack storm carries no MissionType of its own; the node's own type answers it.
      missionType: missionTypeOf(mission.MissionType) ?? where.missionType,
      tier,
      expiry,
      isHard: mission.Hard === true,
      isStorm,
    })
  }
  for (const mission of many(root.ActiveMissions, RawMission)) addFissure(mission, false)
  for (const mission of many(root.VoidStorms, RawMission)) addFissure(mission, true)

  const invasionRoot = (invasionsRaw ?? {}) as Record<string, unknown>
  const seen = new Set<string>()
  const invasions: Invasion[] = []
  for (const entry of many(invasionRoot.invasions, RawInvasion)) {
    // The feed lists one row per side, both carrying the same id.
    const id = entry.id ?? entry.node
    if (seen.has(id)) continue
    seen.add(id)
    const where = place(index, entry.node)
    invasions.push({
      id,
      node: where.node,
      planet: where.planet,
      sourceId: where.sourceId,
      attacker: factionOf(entry.ally),
      defender: factionOf(entry.enemy),
    })
  }

  const toSortie = (value: unknown): SortieLike | undefined => {
    const first = many(value, RawSortie)[0]
    if (first === undefined) return undefined
    // Sorties carry `Variants` with a modifier; archon hunts carry `Missions` without one.
    // The `| undefined` is explicit because exactOptionalPropertyTypes distinguishes an
    // absent key from one set to undefined, and the two shapes differ in exactly that way.
    const entries: {
      missionType?: string | undefined
      modifierType?: string | undefined
      node?: string | undefined
    }[] = [
      ...(first.Variants ?? []),
      ...(first.Missions ?? []),
    ]
    return {
      boss: bossOf(first.Boss),
      expiry: msOf(first.Expiry),
      variants: entries
        .filter((entry) => entry.node !== undefined)
        .map((entry) => {
          const where = place(index, entry.node ?? '')
          return {
            node: where.node,
            planet: where.planet,
            missionType: missionTypeOf(entry.missionType) ?? where.missionType,
            modifier: modifierOf(entry.modifierType),
          }
        }),
    }
  }

  const trader = many(root.VoidTraders, RawTrader)[0]

  /**
   * QUIRK — DE spells him "Baro'Ki Teel" internally. Every player, and the game's own UI,
   * says "Baro Ki'Teer". Fixed by name rather than by pattern because it is one value.
   */
  const traderName = (raw: string | undefined): string | undefined =>
    raw === undefined ? undefined : raw === "Baro'Ki Teel" ? "Baro Ki'Teer" : raw

  return {
    timestamp: secondsOf(root.Time),
    fissures,
    invasions,
    sortie: toSortie(root.Sorties),
    archonHunt: toSortie(root.LiteSorties),
    voidTrader:
      trader === undefined
        ? undefined
        : {
            character: traderName(trader.Character),
            node: trader.Node === undefined ? undefined : place(index, trader.Node).node,
            activation: msOf(trader.Activation),
            expiry: msOf(trader.Expiry),
            inventory: (trader.Manifest ?? []).map((entry) => ({
              // ".../StoreItems/Weapons/Foo" -> "Foo". Not a display name, but far better
              // than the path, and the manifest is empty except while he is here.
              item: entry.ItemType.split('/').pop() ?? entry.ItemType,
              ducats: entry.PrimePrice,
              credits: entry.RegularPrice,
            })),
          },
  }
}

/** Relic tiers in the order the game lists them; anything else sorts after. */
const TIER_ORDER = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem', 'Omnia']

export function groupFissuresByTier(fissures: Fissure[]): { tier: string; fissures: Fissure[] }[] {
  const groups = new Map<string, Fissure[]>()
  for (const fissure of fissures) {
    const list = groups.get(fissure.tier)
    if (list === undefined) groups.set(fissure.tier, [fissure])
    else list.push(fissure)
  }
  return [...groups.entries()]
    .map(([tier, list]) => ({
      tier,
      // Soonest to expire first: one with four minutes left is not the one to plan around.
      fissures: [...list].sort((a, b) => a.expiry - b.expiry),
    }))
    .sort((a, b) => {
      const left = TIER_ORDER.indexOf(a.tier)
      const right = TIER_ORDER.indexOf(b.tier)
      if (left !== right) return (left === -1 ? 99 : left) - (right === -1 ? 99 : right)
      return a.tier.localeCompare(b.tier)
    })
}

/** Only fissures still open, against the READER's clock — the expiry is absolute. */
export function openFissures(fissures: Fissure[], now: number): Fissure[] {
  return fissures.filter((fissure) => fissure.expiry > now)
}

/**
 * Who is doing what, right now.
 *
 * This is what replaced a static Factions surface: node ownership is published for only about
 * half the star chart, but faction ACTIVITY is complete and is the more useful question.
 */
export function factionActivity(
  state: WorldState,
): { faction: string; fissures: number; invasions: number }[] {
  const tally = new Map<string, { fissures: number; invasions: number }>()
  const bump = (faction: string | undefined, key: 'fissures' | 'invasions'): void => {
    if (faction === undefined || faction === '') return
    const entry = tally.get(faction) ?? { fissures: 0, invasions: 0 }
    entry[key] += 1
    tally.set(faction, entry)
  }
  for (const fissure of state.fissures) bump(fissure.faction, 'fissures')
  for (const invasion of state.invasions) {
    bump(invasion.attacker, 'invasions')
    bump(invasion.defender, 'invasions')
  }
  return [...tally.entries()]
    .map(([faction, counts]) => ({ faction, ...counts }))
    .sort(
      (a, b) =>
        b.fissures + b.invasions - (a.fissures + a.invasions) || a.faction.localeCompare(b.faction),
    )
}

/** "1h 12m", "4m", "expired". Recomputed locally so it stays honest between refreshes. */
export function timeUntil(expiry: number | undefined, now: number): string | undefined {
  if (expiry === undefined) return undefined
  const ms = expiry - now
  if (ms <= 0) return 'expired'
  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${String(days)}d ${String(hours)}h`
  if (hours > 0) return `${String(hours)}h ${String(mins)}m`
  return `${String(mins)}m`
}

export function traderIsHere(trader: VoidTrader | undefined, now: number): boolean {
  if (trader?.activation === undefined || trader.expiry === undefined) return false
  return now >= trader.activation && now < trader.expiry
}

/**
 * How old a payload may be before nothing in it can be trusted.
 *
 * Fissures turn over in one to three hours, so a feed that has not moved in half an hour has
 * stopped rather than gone quiet. The mirror this replaced froze for six hours with its own
 * timestamp stuck, by which point every fissure had expired and the page read as a wall of
 * "expired" — which looks like this site's defect and tells the reader nothing true.
 */
export const STALE_AFTER_MINUTES = 30

export function payloadAgeMinutes(timestamp: number | undefined, now: number): number | undefined {
  if (timestamp === undefined) return undefined
  return Math.max(0, Math.floor((now - timestamp) / 60000))
}

/**
 * Whether the feed has stopped moving.
 *
 * Falls back to the fissures themselves when the payload carries no timestamp of its own: if
 * every fissure has expired, the feed has stopped regardless of what it claims. DE's own
 * worldState does not always include `Time`, so the fallback is the load-bearing half.
 */
export function isStale(state: WorldState, now: number): boolean {
  const age = payloadAgeMinutes(state.timestamp, now)
  if (age !== undefined && age > STALE_AFTER_MINUTES) return true
  if (state.fissures.length === 0) return false
  return openFissures(state.fissures, now).length === 0
}
