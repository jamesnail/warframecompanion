import { z } from 'zod'

/**
 * The canonical domain model. Defined once, here, and nowhere else (CLAUDE.md § Conventions).
 * Types are derived via z.infer rather than declared alongside the schema, so the runtime
 * validator and the compile-time type cannot drift apart.
 */

export const ItemCategory = z.enum([
  'Warframe',
  'Primary',
  'Secondary',
  'Melee',
  'Companion',
  'Archwing',
  'Mod',
  'Arcane',
  'Resource',
  'Relic',
  'Component',
  'Blueprint',
  'Cosmetic',
  'Other',
])
export type ItemCategory = z.infer<typeof ItemCategory>

export const Faction = z.enum([
  'Grineer',
  'Corpus',
  'Infested',
  'Orokin',
  'Corrupted',
  'Sentient',
  'Narmer',
])
export type Faction = z.infer<typeof Faction>

export const RelicTier = z.enum(['Lith', 'Meso', 'Neo', 'Axi', 'Requiem', 'Vanguard'])
export type RelicTier = z.infer<typeof RelicTier>

export const RelicRarity = z.enum(['common', 'uncommon', 'rare'])
export type RelicRarity = z.infer<typeof RelicRarity>

export const Refinement = z.enum(['intact', 'exceptional', 'flawless', 'radiant'])
export type Refinement = z.infer<typeof Refinement>

export const Rotation = z.enum(['A', 'B', 'C'])
export type Rotation = z.infer<typeof Rotation>

/** Where an edge's claim came from. The wiki and the official repo disagree in places
 *  (DESIGN.md § 10.3); never blend them silently, tag them and let the user filter. */
export const Provenance = z.enum(['official', 'wiki', 'derived'])
export type Provenance = z.infer<typeof Provenance>

export const SourceKind = z.enum([
  'mission',
  'relic',
  'enemy',
  'bounty',
  'syndicate',
  'sortie',
  'transient',
  'cache',
  'other',
])
export type SourceKind = z.infer<typeof SourceKind>

/** Stable slug, e.g. "braton-prime-barrel". */
export const ItemId = z.string().min(1)
export type ItemId = z.infer<typeof ItemId>

/** Namespaced slug, e.g. "mission:earth/cambria", "relic:lith-b4". */
export const SourceId = z.string().min(1)
export type SourceId = z.infer<typeof SourceId>

export const Item = z.object({
  id: ItemId,
  name: z.string().min(1),
  category: ItemCategory,
  /** /Lotus/... — the join key back to DE's PublicExport. */
  uniqueName: z.string().optional(),
  imageName: z.string().optional(),
  tradable: z.boolean(),
  /** Relics and prime parts only. Derived in the pipeline from current relic
   *  drop availability, never trusted as a static upstream flag (DESIGN.md § 10.5). */
  vaulted: z.boolean().optional(),
  masteryReq: z.number().int().min(0).max(30).optional(),
  buildsInto: z.array(ItemId).optional(),
  components: z
    .array(z.object({ itemId: ItemId, count: z.number().int().positive() }))
    .optional(),
  /**
   * This item's slug on warframe.market, for a link out to its trade listings.
   *
   * Resolved at build time against their own published catalogue and never derived from our
   * slug: the naive transform is right about 74% of the time, and the misses are not random —
   * assembled weapons are sold as "<name>_set", augment mods drop the warframe suffix our id
   * keeps, and some items are simply not traded. Present only when their catalogue lists it,
   * so a link that exists is a link that resolves.
   *
   * Deliberately independent of `tradable`: 486 items that flag marks untradable are sold
   * there regardless, so their catalogue is the authority on this and ours is not.
   */
  marketSlug: z.string().min(1).optional(),
})
export type Item = z.infer<typeof Item>

export const Source = z.object({
  id: SourceId,
  kind: SourceKind,
  name: z.string().min(1),
  planet: z.string().optional(),
  missionType: z.string().optional(),
  faction: Faction.optional(),
  tileset: z.string().optional(),
  levelRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  /** Steel Path is a flag on the source, not a duplicated source (DESIGN.md § 10.6). */
  isSteelPath: z.boolean().optional(),
})
export type Source = z.infer<typeof Source>

/**
 * One edge of the drop graph — the atom the whole app is built on.
 *
 * `chance` is ALWAYS a float in 0..1. Upstream mixes raw numbers with malformed strings
 * like "nce: 15.00" (DESIGN.md § 10.2); normalize once in the pipeline and assert here.
 */
export const DropEdge = z.object({
  itemId: ItemId,
  sourceId: SourceId,
  chance: z.number().min(0).max(1),
  rotation: Rotation.nullable().optional(),
  /** Bounty stage, "Rotation C (Stage 3)", cache index. */
  stage: z.string().optional(),
  quantity: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  /** Rounds per rotation-C cycle, cache count, etc. This is what makes two paths
   *  comparable by effort rather than by raw percentage (DESIGN.md § 4). */
  eventsPerRun: z.number().positive().optional(),
  /**
   * Set only where a source hands out a PRE-REFINED relic — Elite Sanctuary Onslaught and
   * a few bounties pay in Radiant ones, which is worth 100 void traces the player does not
   * have to spend.
   *
   * This is a property of the drop, not of the relic. Upstream disagrees: it names the
   * reward "Lith A12 Relic (Radiant)", which slugged to a SEPARATE item with no relic
   * detail attached — 29 dead pages that listed sources but no contents, never appeared in
   * any prime part's relic list, and split each affected relic's sources in two.
   */
  refinement: Refinement.optional(),
  provenance: Provenance,
  /** Set on `derived` edges only: the relic this path is composed through. */
  via: ItemId.optional(),
})
export type DropEdge = z.infer<typeof DropEdge>

/** Relics are items and sources both. */
export const RelicDetail = z.object({
  id: ItemId,
  tier: RelicTier,
  vaulted: z.boolean(),
  rewards: z.array(
    z.object({
      itemId: ItemId,
      rarity: RelicRarity,
      /**
       * Units per reward, where the relic pays more than one — "2X Forma Blueprint" and
       * "1200X Kuva" are the only two today. The count used to live in the reward's name,
       * which made it a different item; pulling it out of the name would otherwise have
       * silently dropped the fact that this slot pays double.
       */
      quantity: z.number().int().positive().optional(),
    }),
  ),
})
export type RelicDetail = z.infer<typeof RelicDetail>

export const Manifest = z.object({
  hash: z.string().min(1),
  /**
   * DE's own publication timestamp for the drop tables, NOT the time this build ran.
   *
   * The name is misleading and the distinction matters: this deliberately does not advance
   * when a daily run finds nothing changed. A pipeline run that rewrote it every day would
   * produce an empty commit every day, which the whole content-addressed design exists to
   * avoid. If this reads as months old, that is because DE has not republished — it is the
   * honest answer, not a stale one. Do not "fix" it by stamping Date.now().
   */
  builtAt: z.string(),
  files: z.record(z.string(), z.string()),
  upstream: z.record(z.string(), z.string()),
  attributions: z.array(z.object({ name: z.string(), url: z.string().url() })),
  /** Carried forward so the next build can compare against it — the ±15% sanity
   *  gates need the previous build's totals, and the manifest is the only thing
   *  guaranteed to still be on disk. */
  counts: z.object({
    items: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    /** Optional so a manifest written before rivens existed still parses — the drift gates
     *  read the PREVIOUS build, which may predate this field. */
    rivens: z.number().int().nonnegative().optional(),
  }),
})
export type Manifest = z.infer<typeof Manifest>

/**
 * Riven mods.
 *
 * Deliberately modelled as a property of a WEAPON rather than of a roll. Grading an
 * individual riven means comparing each stat against the range that weapon's disposition
 * allows, and no upstream source publishes those ranges — inventing the formula would
 * produce confident numbers with nothing behind them. Disposition and market price are both
 * published facts, and they are what a player checks before buying or rolling.
 */
export const RivenType = z.enum(['Rifle', 'Shotgun', 'Pistol', 'Melee', 'Archgun', 'Kitgun', 'Zaw'])
export type RivenType = z.infer<typeof RivenType>

/**
 * One week of observed trades, straight from Digital Extremes' own trade statistics.
 *
 * `median` leads everywhere in the UI: riven prices are violently skewed — a single
 * thousand-plat sale drags `avg` far above anything a normal trade closes at — so the mean
 * is carried but never shown as "the price". `pop` is the sample size and is the honest
 * caveat on all of it; a median drawn from one trade is not a market.
 */
export const RivenPrice = z.object({
  median: z.number().nonnegative(),
  avg: z.number().nonnegative(),
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  stddev: z.number().nonnegative(),
  /** Number of trades observed that week. */
  pop: z.number().int().nonnegative(),
})
export type RivenPrice = z.infer<typeof RivenPrice>

export const RivenWeapon = z.object({
  id: ItemId,
  name: z.string().min(1),
  rivenType: RivenType,
  /**
   * Disposition as the game draws it, 1 to 5 dots. Carried alongside the real multiplier
   * because the dots are what players actually say to each other ("it's a five-dot riven"),
   * and rounding 1.42 back to dots at render time would reinvent a number we were given.
   */
  dispositionStars: z.number().int().min(1).max(5).optional(),
  /** The multiplier the game applies to rolled stats, 0.5 to 1.55. Higher is better. */
  disposition: z.number().min(0.5).max(1.55).optional(),
  /** Prices for an unrolled riven, and for one that has been rerolled at least once. */
  unrolled: RivenPrice.optional(),
  rerolled: RivenPrice.optional(),
  /** The catalogue item for this weapon, where the drop data knows one. */
  itemId: ItemId.optional(),
})
export type RivenWeapon = z.infer<typeof RivenWeapon>
