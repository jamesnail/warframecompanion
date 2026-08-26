import { z } from 'zod'

/**
 * Warframe world state: what is happening in the game right now.
 *
 * This is the one dataset here that cannot be committed. Fissures expire in one to three
 * hours and Baro Ki'Teer is present two days in fourteen, so a daily static build would ship
 * a page that is wrong most of the time — actively wrong, not merely stale. It is therefore
 * fetched in the browser, from WFCD's status API rather than from Digital Extremes directly.
 *
 * That is deliberately narrow. Constraint 2 forbids DE endpoints in the browser because they
 * offer no CORS guarantee, ship LZMA-compressed manifests and multi-megabyte HTML, and are
 * documented as "for reference only". None of that applies here: this is WFCD's parsed JSON,
 * 184 KB, and it sends `access-control-allow-origin: *` — which is also why it needs no
 * server route, leaving constraint 3's single escape hatch unspent. Everything about the drop
 * graph still comes from committed static files.
 *
 * Every section is parsed on its own. Upstream adds fields to this payload regularly, and one
 * unfamiliar shape must cost the section it appears in rather than the whole page.
 */

const Faction = z.string().min(1)

export const Fissure = z.object({
  id: z.string(),
  node: z.string(),
  missionType: z.string().optional(),
  enemy: Faction.optional(),
  tier: z.string(),
  tierNum: z.number().optional(),
  expiry: z.string(),
  /** Steel Path. */
  isHard: z.boolean().optional(),
  /** Railjack ("Void Storm"). */
  isStorm: z.boolean().optional(),
})
export type Fissure = z.infer<typeof Fissure>

const InvasionSide = z.object({
  faction: Faction.optional(),
  reward: z
    .object({
      countedItems: z.array(z.object({ count: z.number(), type: z.string() })).optional(),
      credits: z.number().optional(),
    })
    .optional(),
})

export const Invasion = z.object({
  id: z.string(),
  node: z.string(),
  desc: z.string().optional(),
  completed: z.boolean().optional(),
  completion: z.number().optional(),
  attacker: InvasionSide.optional(),
  defender: InvasionSide.optional(),
})
export type Invasion = z.infer<typeof Invasion>

export const Sortie = z.object({
  faction: Faction.optional(),
  boss: z.string().optional(),
  expiry: z.string().optional(),
  variants: z
    .array(
      z.object({
        missionType: z.string().optional(),
        modifier: z.string().optional(),
        node: z.string().optional(),
      }),
    )
    .optional(),
})
export type Sortie = z.infer<typeof Sortie>

export const ArchonHunt = z.object({
  faction: Faction.optional(),
  boss: z.string().optional(),
  expiry: z.string().optional(),
})

export const VoidTrader = z.object({
  character: z.string().optional(),
  location: z.string().optional(),
  activation: z.string().optional(),
  expiry: z.string().optional(),
  active: z.boolean().optional(),
  inventory: z
    .array(z.object({ item: z.string(), ducats: z.number().optional(), credits: z.number().optional() }))
    .optional(),
})
export type VoidTrader = z.infer<typeof VoidTrader>

export const Cycle = z.object({
  state: z.string(),
  expiry: z.string().optional(),
})

/** The cycles worth showing, and what to call each place. */
export const CYCLE_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'earthCycle', label: 'Earth' },
  { key: 'cetusCycle', label: 'Cetus' },
  { key: 'vallisCycle', label: 'Orb Vallis' },
  { key: 'cambionCycle', label: 'Cambion Drift' },
  { key: 'zarimanCycle', label: 'Zariman' },
  { key: 'duviriCycle', label: 'Duviri' },
]

export interface WorldState {
  timestamp: string | undefined
  fissures: Fissure[]
  invasions: Invasion[]
  sortie: Sortie | undefined
  archonHunt: z.infer<typeof ArchonHunt> | undefined
  voidTrader: VoidTrader | undefined
  cycles: { label: string; state: string; expiry: string | undefined }[]
}

/**
 * Read the payload, section by section, discarding only what fails.
 *
 * Deliberately never throws. A world-state page that renders four of its six panels is
 * useful; one that renders an error because upstream added a field to Nightwave is not.
 */
export function parseWorldState(input: unknown): WorldState {
  const root = input as Record<string, unknown> | null
  const at = (key: string): unknown => (root === null ? undefined : root[key])

  const many = <T>(value: unknown, schema: z.ZodType<T>): T[] => {
    if (!Array.isArray(value)) return []
    const out: T[] = []
    for (const entry of value) {
      const parsed = schema.safeParse(entry)
      if (parsed.success) out.push(parsed.data)
    }
    return out
  }

  const one = <T>(value: unknown, schema: z.ZodType<T>): T | undefined => {
    const parsed = schema.safeParse(value)
    return parsed.success ? parsed.data : undefined
  }

  const cycles: WorldState['cycles'] = []
  for (const { key, label } of CYCLE_LABELS) {
    const cycle = one(at(key), Cycle)
    if (cycle !== undefined) cycles.push({ label, state: cycle.state, expiry: cycle.expiry })
  }

  return {
    timestamp: typeof at('timestamp') === 'string' ? (at('timestamp') as string) : undefined,
    fissures: many(at('fissures'), Fissure),
    invasions: many(at('invasions'), Invasion).filter((invasion) => invasion.completed !== true),
    sortie: one(at('sortie'), Sortie),
    archonHunt: one(at('archonHunt'), ArchonHunt),
    voidTrader: one(at('voidTrader'), VoidTrader),
    cycles,
  }
}

/**
 * "Everview Arc (Zariman)" -> "mission:zariman/everview-arc".
 *
 * About 85% resolve. The rest are real mission nodes that have no unique drops, so the drop
 * tables never mention them and this site has no page to link to — those render as plain
 * text rather than as a link to a 404.
 */
const NODE_PATTERN = /^(.*?)\s*\(([^)]+)\)\s*$/

export function nodeToSourceId(node: string): string | undefined {
  const match = NODE_PATTERN.exec(node)
  const name = match?.[1]
  const planet = match?.[2]
  if (name === undefined || planet === undefined) return undefined
  return `mission:${slugify(planet)}/${slugify(name.trim())}`
}

/** Mirrors packages/sources/src/slug.ts. Duplicated rather than imported because that module
 *  is Node-only build tooling and apps/web must never import from it. */
function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Only fissures that are still open.
 *
 * Upstream keeps returning them past their own expiry — 13 of 32 were already dead in one
 * sample, some by half an hour — and its payload can itself be tens of minutes old. An
 * expired fissure is not one you can go and run, so listing it under a heading that says
 * "open" states something false. Filtered against the reader's clock, because the expiry is
 * absolute UTC and their clock is the one that matters.
 */
export function openFissures(fissures: Fissure[], now: number): Fissure[] {
  return fissures.filter((fissure) => {
    const ends = Date.parse(fissure.expiry)
    return Number.isNaN(ends) || ends > now
  })
}

/**
 * How old a payload may be before nothing in it can be trusted.
 *
 * Open-world cycles turn over in about 50 minutes and fissures in one to three hours, so a
 * feed that has not moved in half an hour is not merely behind — it has stopped. Observed:
 * the upstream mirror froze with its own `timestamp` stuck at one value for over six hours,
 * by which point every fissure, the sortie and every cycle had expired. Rendering that is a
 * page that reads entirely as "expired", which looks like our bug and tells the reader
 * nothing true.
 */
export const STALE_AFTER_MINUTES = 30

/** Whether the feed has stopped moving, rather than merely lagging. */
export function isStale(timestamp: string | undefined, now: number): boolean {
  const age = payloadAgeMinutes(timestamp, now)
  // No timestamp at all is not evidence of staleness; upstream simply did not say.
  return age !== undefined && age > STALE_AFTER_MINUTES
}

/** How stale the payload is, in whole minutes, or undefined if it did not say. */
export function payloadAgeMinutes(timestamp: string | undefined, now: number): number | undefined {
  if (timestamp === undefined) return undefined
  const generated = Date.parse(timestamp)
  if (Number.isNaN(generated)) return undefined
  return Math.max(0, Math.floor((now - generated) / 60000))
}

/** Relic tiers, in the order the game lists them. Anything else — Omnia, Requiem — keeps its
 *  own name and sorts after. */
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
      // Soonest to expire first: a fissure with four minutes left is not the one to plan around.
      fissures: [...list].sort((a, b) => a.expiry.localeCompare(b.expiry)),
    }))
    .sort((a, b) => {
      const left = TIER_ORDER.indexOf(a.tier)
      const right = TIER_ORDER.indexOf(b.tier)
      if (left !== right) return (left === -1 ? 99 : left) - (right === -1 ? 99 : right)
      return a.tier.localeCompare(b.tier)
    })
}

/**
 * Who is doing what, right now.
 *
 * This is what replaced a static Factions surface. Node ownership is only published for
 * about half the star chart, but faction ACTIVITY — which faction you fight in each open
 * fissure, who is invading whom, who the sortie targets — is complete and is the more useful
 * question anyway.
 */
export function factionActivity(state: WorldState): { faction: string; fissures: number; invasions: number }[] {
  const tally = new Map<string, { fissures: number; invasions: number }>()
  const bump = (faction: string | undefined, key: 'fissures' | 'invasions'): void => {
    if (faction === undefined || faction === '') return
    const entry = tally.get(faction) ?? { fissures: 0, invasions: 0 }
    entry[key] += 1
    tally.set(faction, entry)
  }

  for (const fissure of state.fissures) bump(fissure.enemy, 'fissures')
  for (const invasion of state.invasions) {
    bump(invasion.attacker?.faction, 'invasions')
    bump(invasion.defender?.faction, 'invasions')
  }

  return [...tally.entries()]
    .map(([faction, counts]) => ({ faction, ...counts }))
    .sort(
      (a, b) =>
        b.fissures + b.invasions - (a.fissures + a.invasions) || a.faction.localeCompare(b.faction),
    )
}

/**
 * "1h 12m", "4m", "expired".
 *
 * Recomputed from the expiry rather than using the `timeLeft` string upstream provides: that
 * one is calculated when the API responds and is wrong by however long the payload sat in a
 * cache or the reader sat on the page.
 */
export function timeUntil(expiry: string | undefined, now: number): string | undefined {
  if (expiry === undefined) return undefined
  const ms = Date.parse(expiry) - now
  if (Number.isNaN(ms)) return undefined
  if (ms <= 0) return 'expired'

  const minutes = Math.floor(ms / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60

  if (days > 0) return `${String(days)}d ${String(hours)}h`
  if (hours > 0) return `${String(hours)}h ${String(mins)}m`
  return `${String(mins)}m`
}

/** Whether a trader is standing in a relay right now, rather than scheduled to. */
export function traderIsHere(trader: VoidTrader | undefined, now: number): boolean {
  if (trader === undefined) return false
  if (trader.active === true) return true
  const start = trader.activation === undefined ? undefined : Date.parse(trader.activation)
  const end = trader.expiry === undefined ? undefined : Date.parse(trader.expiry)
  if (start === undefined || end === undefined || Number.isNaN(start) || Number.isNaN(end)) {
    return false
  }
  return now >= start && now < end
}
