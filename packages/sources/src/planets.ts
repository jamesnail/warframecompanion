import type { DropEdge, Faction, Item, Planet, PlanetResource, Source } from '@provenance/core'

import { slug } from './slug'

/**
 * What each planet is farmed for.
 *
 * ── Why this file is curated at all ────────────────────────────────────────────────
 *
 * DE's drop repository publishes what an enemy drops and never where that enemy spawns. An
 * enemy record has exactly three fields: id, kind, name. No faction, no planet, no tileset.
 * So the join a planet-resource page is made of does not exist upstream, and 1,055 of the
 * 2,417 sources cannot be placed anywhere.
 *
 * Built from the drop tables alone, Earth reports 14 "resources", four of the top six being
 * credit caches, and omits Ferrite, Rubedo, Detonite Ampule, Neurodes, Oxium and Circuits —
 * every resource a player actually means by the question. Ferrite has 15 edges in the whole
 * dataset and all 15 are mission reward tables; Detonite Ampule has one.
 *
 * ── How the curation is kept small ─────────────────────────────────────────────────
 *
 * Most of the answer is still derived. `nodes.json` records which factions hold which planet
 * — that is real data, 353 nodes of it — and a planet's common resources follow from its
 * factions almost exactly. So the curated surface is two small tables:
 *
 *   FACTION_RESOURCES   what a faction's units drop         4 factions, ~20 rows
 *   PLANET_EXCLUSIVES   what belongs to one place only      ~20 planets, ~90 rows
 *
 * and the planet → faction half of the first one comes out of the node table for free.
 *
 * Everything here is community knowledge, not a DE publication. It renders marked as such,
 * and every id is validated against the real item table at build time so a rename fails the
 * build loudly instead of quietly dropping a row.
 */

/**
 * What a faction's rank-and-file drop, anywhere they are fought.
 *
 * Only the four star-chart factions appear. Tenno nodes are relays and quest missions with no
 * resource identity of their own; Duviri, Techrot, Scaldra, The Murmur and the Anarchs hold
 * self-contained regions whose resources are all listed as exclusives below, because they do
 * not follow the faction pattern at all.
 */
export const FACTION_RESOURCES: Record<string, readonly string[]> = {
  Grineer: ['ferrite', 'alloy-plate', 'detonite-ampule', 'salvage'],
  Corpus: ['circuits', 'alloy-plate', 'rubedo', 'fieldron', 'oxium'],
  Infested: ['nano-spores', 'mutagen-sample', 'plastids', 'neurodes'],
  Corrupted: ['control-module', 'orokin-cell', 'rubedo', 'argon-crystal'],
}

/**
 * What belongs to one place and nowhere else.
 *
 * These are the rows no join can produce: the rare a planet is specifically farmed for, and
 * the whole contents of an open world, where fishing and mining resources are not dropped by
 * anything and so appear in no drop table at any grain.
 *
 * Keyed by the planet name as the SOURCE table spells it, because that is the string every
 * existing edge already joins on. `buildPlanets` fails loudly on a key it cannot place.
 */
export const PLANET_EXCLUSIVES: Record<string, readonly string[]> = {
  // ── Star chart ────────────────────────────────────────────────────────────────
  Mercury: ['morphics', 'polymer-bundle'],
  Venus: ['polymer-bundle'],
  Earth: ['neurodes', 'oxium', 'rubedo', 'circuits'],
  Lua: ['nav-coordinate'],
  Mars: ['gallium', 'morphics'],
  Phobos: ['rubedo', 'morphics'],
  Ceres: ['orokin-cell', 'plastids', 'circuits'],
  Jupiter: ['neural-sensors'],
  Europa: ['control-module', 'rubedo'],
  Saturn: ['orokin-cell', 'nano-spores'],
  Uranus: ['polymer-bundle', 'gallium', 'titanium'],
  Neptune: ['control-module', 'nano-spores'],
  Pluto: ['morphics', 'plastids'],
  Eris: ['neural-sensors', 'neurodes'],
  Sedna: ['control-module', 'rubedo'],
  Void: ['argon-crystal', 'control-module', 'orokin-cell'],
  'Kuva Fortress': ['kuva', 'neural-sensors', 'oxium'],

  // ── Open worlds. Fishing and mining yield these; nothing drops them, so they are
  //    absent from every drop table at every grain. ───────────────────────────────
  Cetus: [
    'iradite',
    'grokdrul',
    'maprico',
    'cetus-wisp',
    'nistlepod',
    'condroc-wing',
    'mortus-horn',
    'norg',
    'murkray-liver',
    'sharrac-teeth',
    'tralok-eyes',
    'yogwun-stomach',
    'khut-khut-venom-sac',
  ],
  'Solaris United': [
    'gorgaricus-spore',
    'mytocardia-spore',
    'thermal-sludge',
    'tepa-nodule',
    'calda-toroid',
    'sola-toroid',
    'vega-toroid',
    'gyromag-systems',
    'atmo-systems',
    'repeller-systems',
    'goopolla-spleen',
    'mawfish-bones',
    'scintillant',
  ],
  Deimos: [
    'bellow-voca',
    'echo-voca',
    'shrill-voca',
    'dracroot',
    'pustulite',
    'ueymag',
    'heart-nyth',
    'nistlepod',
    'necracoil',
    'entrati-lanthorn',
  ],
  Zariman: ['voidplume-crest', 'voidplume-down', 'voidplume-vane', 'entrati-obols'],
  // Pathos Clamps are deliberately absent: they are a Duviri reward but appear nowhere in
  // the item table, so listing one would be a link to a page that does not exist.
  Duviri: ['connla-sprout', 'aggristone', 'lamentus'],
  'Entrati Lab': ['lua-thrax-plasm', 'thrax-plasm', 'voidgel-orb'],
  Höllvania: ['techrot-chitin', 'techrot-motherboard', 'hollvanian-pitchweave-fragment'],
}

/** A planet whose name is a Railjack region or a game mode, not a place with a resource
 *  identity. These are skipped rather than rendered as empty pages. */
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
 * A resource can be reached more than one way — Ceres is Grineer, so it gets Ferrite from the
 * faction table, and its bounty tables happen to list Ferrite too. The strongest basis wins,
 * ordered so the reader sees the most specific claim: an exclusive beats a faction row, and a
 * faction row beats a reward table. That order also means a curated row is never hidden
 * behind a 0.4% reward-table entry for the same thing.
 */
const BASIS_RANK: Record<string, number> = { exclusive: 0, faction: 1, 'reward-table': 2 }

/** Position of a faction row's faction in the planet's own ordering; anything else sorts
 *  equal, so this only ever separates faction rows from each other. */
function factionRank(row: PlanetResource, factions: readonly string[]): number {
  if (row.faction === undefined) return 0
  const index = factions.indexOf(row.faction)
  return index === -1 ? factions.length : index
}

export function buildPlanets(input: PlanetInput): PlanetBuild {
  const { nodes, sources, edges, items } = input
  const known = new Set(items.map((item) => item.id))

  /**
   * QUIRK — `Ferrite` and `Neurodes` are categorised `Other`, not `Resource`, upstream.
   *
   * Filtering the derived pass on the category alone would therefore drop the two most
   * commonly farmed resources in the game from every reward-table row. So anything named in
   * a curated table counts as a resource here regardless of how it is filed.
   */
  const curated = new Set([
    ...Object.values(FACTION_RESOURCES).flat(),
    ...Object.values(PLANET_EXCLUSIVES).flat(),
  ])
  const isResource = new Map(
    items.map((item) => [item.id, item.category === 'Resource' || curated.has(item.id)]),
  )

  // Every planet name the SOURCE table uses — the string edges already join on.
  const names = new Set<string>()
  for (const source of sources) {
    if (source.planet !== undefined && !NOT_A_PLANET.test(source.planet)) names.add(source.planet)
  }
  for (const name of Object.keys(PLANET_EXCLUSIVES)) names.add(name)

  // Factions per planet from the node table, most nodes first. Node names and source names
  // agree for every star-chart planet; where they do not, the planet simply has no factions
  // listed rather than being dropped.
  const factionCounts = new Map<string, Map<string, number>>()
  for (const node of nodes) {
    if (node.planet === undefined || node.faction === undefined) continue
    const counts = factionCounts.get(node.planet) ?? new Map<string, number>()
    counts.set(node.faction, (counts.get(node.faction) ?? 0) + 1)
    factionCounts.set(node.planet, counts)
  }
  const nodeCounts = new Map<string, number>()
  for (const node of nodes) {
    if (node.planet === undefined) continue
    nodeCounts.set(node.planet, (nodeCounts.get(node.planet) ?? 0) + 1)
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

    const counts = factionCounts.get(name)
    const factions = [...(counts ?? new Map<string, number>())]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([faction]) => faction)

    for (const faction of factions) {
      for (const itemId of FACTION_RESOURCES[faction] ?? []) {
        add({ itemId, basis: 'faction', faction: faction as Faction })
      }
    }

    for (const itemId of PLANET_EXCLUSIVES[name] ?? []) {
      add({ itemId, basis: 'exclusive' })
    }

    if (rows.size === 0) continue

    planets.push({
      name,
      slug: slug(name),
      factions,
      nodes: nodeCounts.get(name) ?? 0,
      /**
       * Curated first, then reward-table rows by descending chance. The reader wants "what is
       * this place for" before "what else its tables happen to pay".
       *
       * Faction rows are ordered by how much of the planet that faction actually holds, so
       * Earth leads with its Grineer resources and its three Infested outposts come last.
       * Without this the tie broke on item id and every Grineer planet opened with Alloy
       * Plate regardless of who is really there.
       */
      resources: [...rows.values()].sort(
        (a, b) =>
          BASIS_RANK[a.basis]! - BASIS_RANK[b.basis]! ||
          factionRank(a, factions) - factionRank(b, factions) ||
          (b.chance ?? 0) - (a.chance ?? 0) ||
          a.itemId.localeCompare(b.itemId),
      ),
    })
  }

  return { planets, unresolved }
}
