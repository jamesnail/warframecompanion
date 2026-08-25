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
  }),
})
export type Manifest = z.infer<typeof Manifest>
