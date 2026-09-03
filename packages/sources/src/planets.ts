import type {
  Citation,
  DropEdge,
  Insight,
  Item,
  Planet,
  PlanetResource,
  ResourceRarity,
  Source,
} from '@provenance/core'

import { PLANET_INSIGHTS } from './guides'
import { slug } from './slug'

/**
 * What each planet is farmed for.
 *
 * ── Why any of this is curated ─────────────────────────────────────────────────────
 *
 * DE's drop repository publishes what an enemy drops and never where that enemy spawns. An
 * enemy source record has exactly three fields — id, kind, name — so 1,055 of 2,417 sources
 * cannot be placed anywhere, and the join a planet page is made of does not exist upstream.
 *
 * Built from drop tables alone, Earth reported 14 "resources", four of the top six being
 * credit caches, and omitted Ferrite, Rubedo, Neurodes and Detonite Ampule — the four the
 * question actually means. Ferrite has 15 edges in the whole dataset and all 15 are mission
 * reward tables; Detonite Ampule has one.
 *
 * ── Where the table below came from ────────────────────────────────────────────────
 *
 * **Region resources are a real game mechanic, not a community theory.** What drops from
 * enemies and containers is tied to the star-chart region the mission sits in, and each
 * region has a small fixed pool. DE does not publish the mapping; the WARFRAME Wiki
 * documents it, and REGION_RESOURCES below is that mapping with the wiki's own per-region
 * rarity attached.
 *
 * Rarity is a property of the PAIR, not of the resource: Morphics is rare on Mercury and
 * uncommon on Mars, and Nano Spores is common on Saturn and uncommon on Neptune. Storing it
 * per resource would have lost that.
 *
 * ── What was corrected on the way in ───────────────────────────────────────────────
 *
 * This table replaced a faction-derived model — "Grineer units drop Ferrite, so every
 * Grineer planet has Ferrite" — which was wrong in both directions and wrong in principle.
 * Resources are bound to the REGION, not to the faction holding it: Earth was being given
 * Nano Spores, Mutagen Sample and Plastids off the back of its three Infested nodes, and the
 * real Earth pool contains none of them. Roughly a third of the old rows were wrong.
 *
 * **Fieldron Sample is deliberately absent** from Venus, Mars, Europa, Neptune and Pluto,
 * where the wiki lists it: our item catalogue has `fieldron`, the crafted item, and no entry
 * for the sample. Listing an id that resolves to the wrong thing is worse than omitting a
 * row, and listing one that resolves to nothing fails the build by design.
 */

const WIKI_REGION: Citation = {
  title: 'Region Resource — WARFRAME Wiki',
  url: 'https://wiki.warframe.com/w/Region_Resource',
  retrieved: '2026-09-02',
}

type Pool = readonly (readonly [string, ResourceRarity])[]

/**
 * The region pools, as the wiki documents them.
 *
 * Cross-checked against a second wiki page ("Resources") on the same day; the two agree on
 * every planet below. Where they disagreed — that page also folds in Cryotic, which comes
 * from Excavation rather than from the region pool — the Region Resource page wins, because
 * it is the one describing this mechanic.
 */
export const REGION_RESOURCES: Record<string, Pool> = {
  Mercury: [['ferrite', 'common'], ['polymer-bundle', 'uncommon'], ['detonite-ampule', 'uncommon'], ['morphics', 'rare']],
  Venus: [['alloy-plate', 'common'], ['polymer-bundle', 'common'], ['circuits', 'common']],
  Earth: [['ferrite', 'common'], ['rubedo', 'common'], ['detonite-ampule', 'uncommon'], ['neurodes', 'rare']],
  Lua: [['ferrite', 'common'], ['rubedo', 'common'], ['detonite-ampule', 'uncommon'], ['neurodes', 'rare']],
  Mars: [['salvage', 'common'], ['morphics', 'uncommon'], ['gallium', 'rare']],
  Deimos: [['nano-spores', 'common'], ['mutagen-sample', 'uncommon'], ['orokin-cell', 'rare'], ['neurodes', 'rare']],
  Phobos: [['rubedo', 'common'], ['alloy-plate', 'uncommon'], ['plastids', 'uncommon'], ['morphics', 'rare']],
  Ceres: [['alloy-plate', 'common'], ['circuits', 'common'], ['detonite-ampule', 'uncommon'], ['orokin-cell', 'rare']],
  Jupiter: [['salvage', 'common'], ['alloy-plate', 'uncommon'], ['hexenon', 'uncommon'], ['neural-sensors', 'rare']],
  Europa: [['rubedo', 'common'], ['morphics', 'rare'], ['control-module', 'rare']],
  Saturn: [['nano-spores', 'common'], ['plastids', 'common'], ['detonite-ampule', 'uncommon'], ['orokin-cell', 'rare']],
  Uranus: [['polymer-bundle', 'common'], ['plastids', 'common'], ['detonite-ampule', 'uncommon'], ['gallium', 'rare']],
  Neptune: [['ferrite', 'common'], ['nano-spores', 'uncommon'], ['control-module', 'rare']],
  Pluto: [['rubedo', 'common'], ['alloy-plate', 'uncommon'], ['plastids', 'uncommon'], ['morphics', 'rare']],
  Sedna: [['rubedo', 'common'], ['alloy-plate', 'common'], ['salvage', 'common'], ['detonite-ampule', 'uncommon']],
  Eris: [['nano-spores', 'common'], ['plastids', 'uncommon'], ['neurodes', 'rare'], ['mutagen-sample', 'rare']],
  'Kuva Fortress': [['salvage', 'common'], ['circuits', 'uncommon'], ['detonite-ampule', 'uncommon'], ['neural-sensors', 'rare']],
  Void: [['ferrite', 'common'], ['rubedo', 'uncommon'], ['control-module', 'uncommon'], ['argon-crystal', 'rare']],
  Zariman: [['alloy-plate', 'common'], ['ferrite', 'common'], ['voidgel-orb', 'uncommon'], ['entrati-lanthorn', 'rare']],
}

/**
 * Resources that are gathered rather than dropped — mined, fished, picked.
 *
 * Nothing drops these, so they appear in no drop table at any grain and no amount of
 * pipeline work would produce them. Every entry below was read off the wiki page for the
 * world in question and then checked to resolve against our own item table.
 *
 * Deliberately incomplete. The Cambion Drift's ores and gems (Axidite, Namalon, Dagonic,
 * Xenorhast and the rest) are documented by the wiki but resolve to nothing in our catalogue,
 * and several resources that DO resolve — the Voca, Dracroot, Ueymag, Heart Nyth — could not
 * be placed against a wiki page with confidence, so they are left out rather than guessed at.
 * The derived reward-table rows still surface them wherever a bounty pays them.
 */
const WIKI_MINING: Citation = {
  title: 'Mining — WARFRAME Wiki',
  url: 'https://wiki.warframe.com/w/Mining',
  retrieved: '2026-09-02',
}
const WIKI_PLAINS: Citation = {
  title: 'Plains of Eidolon — WARFRAME Wiki',
  url: 'https://wiki.warframe.com/w/Plains_of_Eidolon',
  retrieved: '2026-09-02',
}
const WIKI_VALLIS: Citation = {
  title: 'Orb Vallis — WARFRAME Wiki',
  url: 'https://wiki.warframe.com/w/Orb_Vallis',
  retrieved: '2026-09-02',
}
const WIKI_CAMBION: Citation = {
  title: 'Cambion Drift — WARFRAME Wiki',
  url: 'https://wiki.warframe.com/w/Cambion_Drift',
  retrieved: '2026-09-02',
}
const WIKI_DUVIRI: Citation = {
  title: 'Duviri — WARFRAME Wiki',
  url: 'https://wiki.warframe.com/w/Duviri',
  retrieved: '2026-09-02',
}

interface Gathered {
  ids: readonly string[]
  method: string
  citation: Citation
}

export const GATHERED: Record<string, readonly Gathered[]> = {
  Cetus: [
    { ids: ['ferros', 'auron'], method: 'Mining — ore', citation: WIKI_MINING },
    {
      ids: ['azurite', 'veridos', 'crimzian', 'tear-azurite', 'marquise-veridos'],
      method: 'Mining — gem',
      citation: WIKI_MINING,
    },
    {
      ids: [
        'mawfish-bones',
        'khut-khut-venom-sac',
        'yogwun-stomach',
        'tralok-eyes',
        'norg-brain',
        'cuthol-tendrils',
        'goopolla-spleen',
        'sharrac-teeth',
        'karkina-antenna',
        'murkray-liver',
        'charc-electroplax',
        'mortus-horn',
        'fish-scales',
      ],
      method: 'Fishing',
      citation: WIKI_PLAINS,
    },
    { ids: ['cetus-wisp'], method: 'Gathered on the Plains', citation: WIKI_PLAINS },
    {
      // Mineral deposits, Konzu's bounties and Tusk Thumpers all yield it.
      ids: ['iradite'],
      method: 'Mineral deposits and bounties',
      citation: {
        title: 'Iradite — WARFRAME Wiki',
        url: 'https://wiki.warframe.com/w/Iradite',
        retrieved: '2026-09-02',
      },
    },
  ],
  'Solaris United': [
    { ids: ['pyrol'], method: 'Mining — ore', citation: WIKI_MINING },
    { ids: ['devar', 'esher-devar'], method: 'Mining — gem', citation: WIKI_MINING },
    {
      ids: ['calda-toroid', 'sola-toroid', 'vega-toroid'],
      method: 'Toroid — enemy drop',
      citation: WIKI_VALLIS,
    },
    {
      ids: ['gyromag-systems', 'atmo-systems', 'repeller-systems'],
      method: 'Heist reward',
      citation: WIKI_VALLIS,
    },
    {
      ids: ['thermal-sludge', 'gorgaricus-spore', 'mytocardia-spore', 'tepa-nodule'],
      method: 'Gathered in the Vallis',
      citation: WIKI_VALLIS,
    },
  ],
  Deimos: [
    {
      ids: ['ganglion', 'pustulite', 'lucent-teroglobe'],
      method: 'Mining',
      citation: WIKI_CAMBION,
    },
    { ids: ['fass-residue', 'vome-residue'], method: 'Fass and Vome cycle', citation: WIKI_CAMBION },
  ],
  Duviri: [
    {
      ids: ['scuttler-husk', 'temporal-dust', 'kullervos-bane'],
      method: 'Duviri reward',
      citation: WIKI_DUVIRI,
    },
    {
      ids: ['entrati-obols', 'necracoil', 'stela'],
      method: 'The Murmur, in Isleweaver',
      citation: WIKI_DUVIRI,
    },
  ],
}

/** A planet whose name is a Railjack region or a game mode, not a place with a resource
 *  identity of its own. Skipped rather than rendered as an empty page. */
const NOT_A_PLANET = /proxima$|^sanctuary|^dark refractory|^hex$|^veil /i

export interface PlanetInput {
  nodes: readonly { planet?: string | undefined; faction?: string | undefined }[]
  sources: readonly Source[]
  edges: readonly DropEdge[]
  items: readonly Item[]
}

export interface PlanetBuild {
  planets: Planet[]
  /** Curated ids that matched no item. Non-empty means the build must fail. */
  unresolved: string[]
}

/**
 * Merge the curated claims with the derived ones into one list per planet.
 *
 * A resource can be reached more than one way — Saturn's region pool has Orokin Cell, and its
 * bounty tables happen to list it too. The strongest basis wins, ordered so the reader sees
 * the most specific claim first. That order also means a region row is never hidden behind a
 * 0.4% reward-table entry for the same thing.
 */
const BASIS_RANK: Record<string, number> = { region: 0, gathered: 1, 'reward-table': 2 }
const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2 }

export function buildPlanets(input: PlanetInput): PlanetBuild {
  const { nodes, sources, edges, items } = input
  const known = new Set(items.map((item) => item.id))

  /**
   * QUIRK — `Ferrite` and `Neurodes` are categorised `Other`, not `Resource`, upstream.
   *
   * Filtering the derived pass on the category alone would drop the two most commonly farmed
   * resources in the game from every reward-table row, so anything named in a curated table
   * counts as a resource here regardless of how it is filed.
   */
  const curatedIds = new Set([
    ...Object.values(REGION_RESOURCES).flatMap((pool) => pool.map(([id]) => id)),
    ...Object.values(GATHERED).flatMap((groups) => groups.flatMap((group) => group.ids)),
  ])
  const isResource = new Map(
    items.map((item) => [item.id, item.category === 'Resource' || curatedIds.has(item.id)]),
  )

  const names = new Set<string>()
  for (const source of sources) {
    if (source.planet !== undefined && !NOT_A_PLANET.test(source.planet)) names.add(source.planet)
  }
  for (const name of Object.keys(REGION_RESOURCES)) names.add(name)
  for (const name of Object.keys(GATHERED)) names.add(name)

  // Factions per planet from the node table, most nodes first. Kept for the page header —
  // "Grineer · Tenno · Infested" tells a reader what they will be shooting — but no longer
  // used to decide resources, which was the bug this table's previous life created.
  const factionCounts = new Map<string, Map<string, number>>()
  const nodeCounts = new Map<string, number>()
  for (const node of nodes) {
    if (node.planet === undefined) continue
    nodeCounts.set(node.planet, (nodeCounts.get(node.planet) ?? 0) + 1)
    if (node.faction === undefined) continue
    const counts = factionCounts.get(node.planet) ?? new Map<string, number>()
    counts.set(node.faction, (counts.get(node.faction) ?? 0) + 1)
    factionCounts.set(node.planet, counts)
  }

  // Best reward-table row per (planet, item). Missions and bounties only — they are the two
  // kinds that carry a planet at all.
  const byPlanet = new Map<string, Map<string, PlanetResource>>()
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  for (const edge of edges) {
    const source = sourceById.get(edge.sourceId)
    if (source?.planet === undefined) continue
    if (isResource.get(edge.itemId) !== true) continue
    const rows = byPlanet.get(source.planet) ?? new Map<string, PlanetResource>()
    const current = rows.get(edge.itemId)
    if (current === undefined || (current.chance ?? 0) < edge.chance) {
      rows.set(edge.itemId, {
        itemId: edge.itemId,
        basis: 'reward-table',
        chance: edge.chance,
        sourceId: edge.sourceId,
        ...(edge.quantity[1] > 1 ? { quantity: edge.quantity } : {}),
      })
    }
    byPlanet.set(source.planet, rows)
  }

  const unresolved: string[] = []
  const planets: Planet[] = []

  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const rows = new Map<string, PlanetResource>()

    const add = (row: PlanetResource): void => {
      if (!known.has(row.itemId)) {
        unresolved.push(`${name}: ${row.itemId}`)
        return
      }
      const current = rows.get(row.itemId)
      if (current === undefined || BASIS_RANK[row.basis]! < BASIS_RANK[current.basis]!) {
        rows.set(row.itemId, row)
      }
    }

    for (const row of byPlanet.get(name)?.values() ?? []) add(row)
    for (const group of GATHERED[name] ?? []) {
      for (const itemId of group.ids) add({ itemId, basis: 'gathered', method: group.method })
    }
    for (const [itemId, rarity] of REGION_RESOURCES[name] ?? []) {
      add({ itemId, basis: 'region', rarity })
    }

    if (rows.size === 0) continue

    const factions = [...(factionCounts.get(name) ?? new Map<string, number>())]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([faction]) => faction)

    planets.push({
      name,
      slug: slug(name),
      factions,
      nodes: nodeCounts.get(name) ?? 0,
      resources: [...rows.values()].sort(
        (a, b) =>
          BASIS_RANK[a.basis]! - BASIS_RANK[b.basis]! ||
          // Within the region pool, commons first: that is the order a player meets them in,
          // and the rare is the one they came for, so it reads as a climb to the point.
          (RARITY_RANK[a.rarity ?? 'common'] ?? 0) - (RARITY_RANK[b.rarity ?? 'common'] ?? 0) ||
          (a.method ?? '').localeCompare(b.method ?? '') ||
          (b.chance ?? 0) - (a.chance ?? 0) ||
          a.itemId.localeCompare(b.itemId),
      ),
      insights: (PLANET_INSIGHTS[name] ?? []) as Insight[],
    })
  }

  return { planets, unresolved }
}

/** Exposed so the pipeline can report how much of each page is asserted rather than derived. */
export { WIKI_REGION }
