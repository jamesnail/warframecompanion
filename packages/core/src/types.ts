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
  /**
   * The pieces of this item you FARM. Braton Prime's barrel, receiver, stock and blueprint.
   *
   * Split from `ingredients` because the two are different questions wearing one shape, and
   * a single `components` array made the tool answer the wrong one. A part is exclusive to
   * what it builds and is the reason to run a mission; an ingredient is a resource you either
   * already have or farm on its own terms, and it belongs to hundreds of recipes at once.
   *
   * The split is not a heuristic. WFCD nests a part's recipe under the parent — the
   * `/Recipes/` marker in its `uniqueName` — and names ingredients as their own items, so
   * this is upstream's own structure preserved rather than a rule we invented. What it
   * replaced WAS a heuristic ("inherit a component's sources only if it builds into at most
   * one thing"), and that heuristic was wrong in both directions: it handed Oxium's 32 drop
   * paths to the one set that needs Oxium, and it stripped genuine parts from the four
   * Ak-weapon sets, whose singles build into two things each.
   *
   * Only an item with at least one part is an assembled SET. A recipe of nothing but
   * ingredients is a crafting note.
   */
  parts: z
    .array(z.object({ itemId: ItemId, count: z.number().int().positive() }))
    .optional(),
  /** Resources the recipe consumes. Not farmed for this item's sake, never collected
   *  against it, and never a source of drop paths for it. See `parts`. */
  ingredients: z
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

/**
 * How a planet-resource claim was reached. The reader is told which, always.
 *
 * This is where the tool asserts things DE never published, so the distinction is part of the
 * data rather than a UI decoration (DESIGN.md § 16).
 *
 *  - `region` — the planet's own region-resource list. Region resources are a real game
 *    mechanic: what drops from enemies and containers is tied to the star-chart region the
 *    mission sits in. DE does not publish the mapping; the WARFRAME Wiki documents it.
 *  - `gathered` — mined, fished or picked in an open world. These are not dropped by anything,
 *    so they appear in no drop table at any grain.
 *  - `reward-table` — DERIVED, entirely. This planet's own mission and bounty tables list it,
 *    with a published chance. The only basis the pipeline could produce before curation
 *    existed, and on its own it omitted Ferrite from Earth.
 */
export const ResourceBasis = z.enum(['region', 'gathered', 'reward-table'])
export type ResourceBasis = z.infer<typeof ResourceBasis>

/** Rarity within a region's own drop pool. Documented per region by the wiki, and NOT a
 *  property of the resource: Morphics is rare on Mercury and uncommon on Mars. */
export const ResourceRarity = z.enum(['common', 'uncommon', 'rare'])
export type ResourceRarity = z.infer<typeof ResourceRarity>

/**
 * Where a curated claim came from, and when that page last changed.
 *
 * Every asserted claim carries one. The date is the upstream page's own last-edited
 * timestamp, not when we read it — in a live-service game a two-year-old farming guide is
 * the thing a reader most needs to know about, and it is shown rather than hidden.
 */
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const Citation = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  /**
   * The source page's OWN last-edited date, where it publishes one.
   *
   * Optional because not every page does, and inventing one would defeat the purpose. Where
   * it is absent the UI falls back to `retrieved` and says so — "read on" is a weaker claim
   * than "updated on" and must not be dressed up as the stronger one.
   */
  updated: IsoDate.optional(),
  /** When this claim was read and written down. Always known. */
  retrieved: IsoDate,
})
export type Citation = z.infer<typeof Citation>

/**
 * How old a claim may be before the reader is warned.
 *
 * Warframe is a live service: a farming route from two updates ago can be simply wrong, and
 * the most-linked community guides are often the stalest. Twelve months is generous — it
 * catches the genuinely abandoned without flagging every guide that had a quiet quarter.
 */
export const STALE_AFTER_DAYS = 365

/** True where a citation is old enough that the reader should be told. Uses `updated` when
 *  the source publishes one, and otherwise the date we read it. */
export function isStale(citation: Citation, now: Date): boolean {
  const stamp = citation.updated ?? citation.retrieved
  const age = (now.getTime() - Date.parse(`${stamp}T00:00:00Z`)) / 86_400_000
  return age > STALE_AFTER_DAYS
}

/**
 * A community claim: how people actually farm a thing.
 *
 * Deliberately separate from every measured figure on the site. This is consensus, not data —
 * it cannot be recomputed, it goes stale, and it renders labelled and dated so the reader can
 * weigh it themselves.
 */
export const Insight = z.object({
  /** Our own words. Never a quotation from the source. */
  text: z.string().min(1),
  /** Nodes named by the claim, resolved to real source ids where they exist so the page can
   *  link to a drop table the reader can check. */
  nodes: z.array(z.object({ name: z.string(), sourceId: SourceId.optional() })).optional(),
  citation: Citation,
})
export type Insight = z.infer<typeof Insight>

export const PlanetResource = z.object({
  itemId: ItemId,
  basis: ResourceBasis,
  /** Set on `region` rows. */
  rarity: ResourceRarity.optional(),
  /** Set on `gathered` rows: mined, fished, and so on. */
  method: z.string().optional(),
  /** Set on `reward-table` rows: the best chance found, and what pays it. */
  chance: z.number().min(0).max(1).optional(),
  sourceId: SourceId.optional(),
  /** Set on `reward-table` rows where the reward pays more than one unit. */
  quantity: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional(),
})
export type PlanetResource = z.infer<typeof PlanetResource>

/** How a resource is farmed, as the community does it. Keyed by item id. */
export const ResourceGuide = z.object({
  itemId: ItemId,
  insights: z.array(Insight),
})
export type ResourceGuide = z.infer<typeof ResourceGuide>

/**
 * A place on the star chart, and what it is farmed for.
 *
 * Keyed by the planet name as the SOURCE table spells it, because that is what every existing
 * edge joins on. `nodes.json` spells a few differently ("Sanctuary Onslaught" against
 * "Sanctuary") and Railjack regions appear there and not here; the pipeline reconciles both
 * and fails loudly on a name it cannot place.
 */
export const Planet = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  /**
   * Factions holding nodes here, most nodes first. Derived from `nodes.json`.
   *
   * Free text, not the `Faction` enum: upstream node records carry values the enum does not
   * and should not admit — "Techrot", "Scaldra", "The Murmur", and the genuinely ambiguous
   * "Grineer or Corpus" on Zariman. Narrowing here would silently drop them and make
   * Höllvania read as factionless.
   */
  factions: z.array(z.string()),
  /** Node count, so a page can say how big a place is without shipping the nodes. */
  nodes: z.number().int().nonnegative(),
  resources: z.array(PlanetResource),
  /** How people farm here. Community consensus, dated and labelled. */
  insights: z.array(Insight).default([]),
})
export type Planet = z.infer<typeof Planet>

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
    /** Optional for the same reason, and additionally because a build during a market
     *  outage legitimately produces no new prices at all. */
    prices: z.number().int().nonnegative().optional(),
    /** Optional for the same reason: builds before curated planets existed have none. */
    planets: z.number().int().nonnegative().optional(),
    guides: z.number().int().nonnegative().optional(),
  }),
})
export type Manifest = z.infer<typeof Manifest>

/**
 * One star-chart node, keyed by Digital Extremes' internal id.
 *
 * The live world state feed identifies everything by internal id — "SolNode232",
 * "CrewBattleNode518" — so without this map a fissure reads as a string nobody recognises.
 * Sourced from the Warframe wiki, which is the only place that publishes the mapping, and
 * which also carries faction, level range and tileset — none of which appear in DE's drop
 * tables at all.
 */
export const SolNode = z.object({
  /** DE's internal id, e.g. "SolNode232". The join key for anything live. */
  id: z.string().min(1),
  name: z.string().min(1),
  planet: z.string().optional(),
  /** The wiki's own vocabulary, which is wider than our Faction enum — it includes The
   *  Murmur, Scaldra, Techrot and "Grineer or Corpus". Kept as written rather than forced
   *  into an enum that would have to drop the ones that do not fit. */
  faction: z.string().optional(),
  missionType: z.string().optional(),
  tileset: z.string().optional(),
  levelRange: z.tuple([z.number().int(), z.number().int()]).optional(),
})
export type SolNode = z.infer<typeof SolNode>

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

/**
 * One weapon inside a riven family.
 *
 * Disposition is per WEAPON even though the riven mod is per family: Cernos sits at 1.30
 * while Cernos Prime and Rakta Cernos both sit at 1.25, and the game applies the disposition
 * of whichever weapon the riven is equipped on. So the price belongs to the family and the
 * disposition belongs here.
 */
export const RivenVariant = z.object({
  id: ItemId,
  name: z.string().min(1),
  /**
   * Disposition as the game draws it, 1 to 5 dots. Carried alongside the real multiplier
   * because the dots are what players actually say to each other ("it's a five-dot riven"),
   * and rounding 1.42 back to dots at render time would reinvent a number we were given.
   */
  dispositionStars: z.number().int().min(1).max(5).optional(),
  /** The multiplier the game applies to rolled stats, 0.5 to 1.55. Higher is better. */
  disposition: z.number().min(0.5).max(1.55).optional(),
  /** The catalogue item for this weapon, where the drop data knows one. */
  itemId: ItemId.optional(),
})
export type RivenVariant = z.infer<typeof RivenVariant>

/**
 * A riven FAMILY: one riven mod and every weapon it fits.
 *
 * Rivens are not per weapon, they are per family. A Cernos riven fits the Cernos, the Cernos
 * Prime and the Rakta Cernos, which is why the market has Cernos riven trades and no Rakta
 * Cernos ones — and why the existence of separate Mutalist Cernos trades tells you it is a
 * family of its own rather than another Cernos variant. Modelling one row per weapon listed
 * the same tradeable mod three times and implied prices that do not exist.
 */
/**
 * A live snapshot of what one item is trading for on warframe.market.
 *
 * NOT an average of every listing, deliberately. The full order book is dominated by stale
 * offers from offline sellers — measured on the real API, Vitality's mean across all 217
 * visible sell orders is 1,019 platinum with a maximum of 99,999, because someone parked a
 * placeholder years ago. The same unfiltered read prices Braton Prime's floor at 1 platinum
 * off a 2019 listing nobody will honour. Both numbers are worse than useless: a reader acts
 * on them.
 *
 * So this is built from the FIVE best live orders on each side, from sellers who are online
 * or in-game right now — warframe.market's own `/top` endpoint. `sellLow` is what you would
 * pay; `buyHigh` is what you would get. Those two are facts a player can act on within the
 * hour, which is the only kind of price worth publishing from a daily build.
 */
export const MarketPrice = z.object({
  /** Our item id, not the market slug — the join is done in the pipeline. */
  itemId: ItemId,
  /** Cheapest live sell order in platinum: what you pay. Absent when nobody is selling. */
  sellLow: z.number().int().nonnegative().optional(),
  /** Median of the five cheapest live sell orders — a steadier read than the single floor. */
  sellTypical: z.number().int().nonnegative().optional(),
  /** Highest live buy order: what you get for selling now. Absent when nobody is buying. */
  buyHigh: z.number().int().nonnegative().optional(),
  /** How many of the five-per-side window were actually filled, so the UI can say when a
   *  price rests on one listing rather than five. Never a total: see the note above. */
  sellOrders: z.number().int().min(0).max(5),
  buyOrders: z.number().int().min(0).max(5),
})
export type MarketPrice = z.infer<typeof MarketPrice>

export const RivenFamily = z.object({
  /** Slug of the family name, which is the name the riven mod itself carries. */
  id: ItemId,
  name: z.string().min(1),
  rivenType: RivenType,
  /** Prices belong to the family, because that is what is bought and sold. */
  unrolled: RivenPrice.optional(),
  rerolled: RivenPrice.optional(),
  /** Every weapon this riven fits, the family head first. Never empty. */
  weapons: z.array(RivenVariant).min(1),
})
export type RivenFamily = z.infer<typeof RivenFamily>
