/**
 * Pipeline entrypoint. Run by CI (daily) and by hand via `pnpm data:build`.
 *
 * Contract (CLAUDE.md § The pipeline is the product):
 *   - every fetch retried with backoff behind a hard timeout
 *   - every payload Zod-parsed before use; schema drift fails the build
 *   - sanity gates before writing anything; exit nonzero and write nothing on failure
 *   - content-addressed output so /data/* can be served immutable
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DropEdge,
  FARM_OVERRIDES,
  Item,
  Manifest,
  Planet,
  REFINEMENT_TABLE,
  ResourceGuide,
  STALE_AFTER_DAYS,
  isStale,
  RelicDetail,
  MarketPrice,
  RivenFamily,
  SolNode,
  Source,
  refinementRowTotal,
} from '@provenance/core'
import { z } from 'zod'

import {
  RawBountyTier,
  RawEnemyTable,
  RawInfo,
  RawKeyReward,
  RawMissionRewards,
  RawNamedReward,
  RawRelics,
  RawSyndicateItem,
  RawTransient,
  aggregateEdges,
  allCitations,
  buildGuides,
  buildPlanets,
  pricableItems,
  sweepPrices,
  sweptEnough,
  SWEEP_FLOOR,
  buildItems,
  fetchJson,
  fetchText,
  mergeParsed,
  parseBounties,
  parseEnemyTables,
  parseKeys,
  parseMissions,
  RawWfcdItem,
  WFCD_FILES,
  buildEnrichmentIndex,
  enrichItems,
  applySets,
  buildSets,
  normalizeDisplayName,
  RawRivenFile,
  buildRivens,
  RawMarketItems,
  buildMarketIndex,
  linkMarketSlugs,
  parseSolNodes,
  parseRelics,
  parseRewardName,
  parseSorties,
  parseSyndicates,
  parseTransient,
  relicDisplayName,
  relicEdges,
  slug,
} from '@provenance/sources'

const DIFF_ONLY = process.argv.includes('--diff')

/** Floor for the WFCD metadata join. Written once: a threshold repeated in its own error
 *  message is a threshold that will eventually contradict itself. */
const COVERAGE_FLOOR = 0.85

/**
 * Assembled items are the only thing in the catalogue that is SYNTHESISED rather than read,
 * so a WFCD restructure could silently drop every one of them and still look like a healthy
 * build. 309 resolve fully today, 161 of the 163 prime sets among them. The floor sits well
 * below that so ordinary churn passes and a structural break does not.
 */
const SET_FLOOR = 250

/** Explicit human override for the +/-15% count gates. Never set in CI. */
const ACCEPT_DRIFT = process.argv.includes('--accept-drift')

/**
 * Skip the eighteen-minute market sweep. For local runs that care about drop data.
 * The daily workflow never passes it.
 */
const SKIP_PRICES = process.argv.includes('--skip-prices')

/** Sweep only the first N items. Local smoke-testing; CI sweeps everything. */
const PRICE_LIMIT = (() => {
  const flag = process.argv.find((arg) => arg.startsWith('--price-limit='))
  const value = flag === undefined ? NaN : Number(flag.slice('--price-limit='.length))
  return Number.isInteger(value) && value > 0 ? value : undefined
})()

const REPO = 'https://raw.githubusercontent.com/WFCD/warframe-drop-data/master/data'
const ITEMS_REPO = 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json'

/**
 * Digital Extremes' weekly riven trade statistics, mirrored by WFCD's status API.
 *
 * Fetched here rather than in the browser, like every other DE-derived dataset: it is read,
 * validated and committed as static JSON, so the riven surface needs no runtime market call
 * and no server route (CLAUDE.md constraints 2 and 3).
 */
const RIVENS_API = 'https://api.warframestat.us/pc/rivens'

/**
 * warframe.market's own item catalogue — one request for all 3,840 entries, read at build
 * time so item pages can link to where a thing is traded. Only slugs are taken; live prices
 * would need a runtime proxy, because this API sends no CORS headers.
 */
const MARKET_API = 'https://api.warframe.market/v2/items'

/**
 * The star chart keyed by DE's internal node id, from the Warframe wiki.
 *
 * The only published mapping from "SolNode232" to a place a player recognises, which the
 * live world state feed needs because it identifies everything that way. Also the only
 * source for per-node faction, level range and tileset.
 *
 * A Lua page rather than an API — that instance has no Cargo — so it is fetched raw and
 * parsed field-wise. Brittle by comparison with everything else here, hence the floor below.
 */
const WIKI_NODES = 'https://wiki.warframe.com/index.php?title=Module%3AMissions%2Fdata&action=raw'

/** 354 nodes parse today. A collapse means the wiki restructured the module, and the world
 *  state page would degrade to raw internal ids rather than place names. */
const NODE_FLOOR = 250

/** 2,699 of 2,713 tradable items resolve today, plus 486 more their catalogue sells that
 *  ours marks untradable. A collapse means they restructured, not that trading stopped. */
const MARKET_FLOOR = 2500

/** Riven FAMILIES, not weapons — one mod fits every variant it covers, so the family count
 *  is well below the weapon count. A collapse here means upstream moved. */
const RIVEN_FLOOR = 350
const OUT_DIR = fileURLToPath(new URL('../apps/web/public/data/', import.meta.url))

const ATTRIBUTIONS = [
  { name: 'WFCD / warframe-drop-data', url: 'https://github.com/WFCD/warframe-drop-data' },
  { name: '@wfcd/items', url: 'https://github.com/WFCD/warframe-items' },
  { name: 'WFCD / warframe-status-api', url: 'https://docs.warframestat.us' },
  { name: 'warframe.market', url: 'https://warframe.market' },
  { name: 'WARFRAME Wiki', url: 'https://wiki.warframe.com' },
  { name: 'Digital Extremes', url: 'https://www.warframe.com' },
]

/** Intact per-slot odds, keyed by derived rarity. Relic edges are emitted at Intact;
 *  the client re-derives other refinements from core's REFINEMENT_TABLE. */
const INTACT: Record<string, number> = {
  common: REFINEMENT_TABLE.intact.common,
  uncommon: REFINEMENT_TABLE.intact.uncommon,
  rare: REFINEMENT_TABLE.intact.rare,
}

/**
 * The secondary drop tables, declared once so fetching, validating and parsing stay in
 * step. `key` is the single top-level property each file wraps its payload in.
 *
 * Deliberately absent: modLocations.json, which is the inverse index of enemyModTables —
 * including both would emit every enemy mod drop twice.
 */
const SECONDARY = [
  { file: 'cetusBountyRewards', key: 'cetusBountyRewards', kind: 'bounty', label: 'Cetus' },
  {
    file: 'solarisBountyRewards',
    key: 'solarisBountyRewards',
    kind: 'bounty',
    label: 'Solaris United',
  },
  { file: 'deimosRewards', key: 'deimosRewards', kind: 'bounty', label: 'Deimos' },
  { file: 'zarimanRewards', key: 'zarimanRewards', kind: 'bounty', label: 'Zariman' },
  { file: 'entratiLabRewards', key: 'entratiLabRewards', kind: 'bounty', label: 'Entrati Lab' },
  { file: 'hexRewards', key: 'hexRewards', kind: 'bounty', label: 'Hex' },
  { file: 'transientRewards', key: 'transientRewards', kind: 'transient', label: '' },
  { file: 'sortieRewards', key: 'sortieRewards', kind: 'sortie', label: '' },
  { file: 'keyRewards', key: 'keyRewards', kind: 'key', label: '' },
  { file: 'syndicates', key: 'syndicates', kind: 'syndicate', label: '' },
  { file: 'enemyModTables', key: 'enemyModTables', kind: 'enemy', label: '' },
  { file: 'enemyBlueprintTables', key: 'enemyBlueprintTables', kind: 'enemy', label: '' },
  { file: 'miscItems', key: 'miscItems', kind: 'enemy', label: '' },
  { file: 'resourceByAvatar', key: 'resourceByAvatar', kind: 'enemy', label: '' },
] as const

function fail(message: string): never {
  console.error(`\n  FAILED  ${message}\n`)
  process.exit(1)
}

function within(actual: number, previous: number, tolerance: number): boolean {
  if (previous === 0) return true
  return Math.abs(actual - previous) / previous <= tolerance
}

/**
 * The previous manifest is what both +/-15% drift gates compare against, so a corrupt one
 * must not silently disable them. A MISSING manifest is the legitimate first-run case and
 * returns undefined; a present-but-unparseable one fails the build.
 */
async function readPreviousManifest(): Promise<Manifest | undefined> {
  let raw: string
  try {
    raw = await readFile(join(OUT_DIR, 'manifest.json'), 'utf8')
  } catch {
    return undefined // first run: nothing to compare against yet
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail('existing manifest.json is not valid JSON. Refusing to run without working drift gates.')
  }

  const result = Manifest.safeParse(parsed)
  if (!result.success) {
    fail(
      'existing manifest.json does not match the Manifest schema, so the drift gates ' +
        'cannot compare against it: ' + result.error.message,
    )
  }
  return result.data
}

async function main(): Promise<void> {
  console.log(DIFF_ONLY ? 'data:diff - dry run, nothing will be written' : 'data:build')

  // ---- fetch ------------------------------------------------------------------
  console.log('fetching upstream...')
  const [info, missionsRaw, relicsRaw, ...secondaryRaw] = await Promise.all([
    fetchJson<unknown>(`${REPO}/info.json`),
    fetchJson<unknown>(`${REPO}/missionRewards.json`),
    fetchJson<unknown>(`${REPO}/relics.json`),
    ...SECONDARY.map((table) => fetchJson<unknown>(`${REPO}/${table.file}.json`)),
  ])

  // ---- validate ---------------------------------------------------------------
  const infoParsed = RawInfo.safeParse(info)
  if (!infoParsed.success) fail(`info.json failed validation: ${infoParsed.error.message}`)

  const missionsParsed = RawMissionRewards.safeParse(missionsRaw)
  if (!missionsParsed.success) {
    fail(`missionRewards.json failed validation: ${missionsParsed.error.message}`)
  }

  const relicsParsed = RawRelics.safeParse(relicsRaw)
  if (!relicsParsed.success) fail(`relics.json failed validation: ${relicsParsed.error.message}`)

  // ---- transform --------------------------------------------------------------
  const { sources: missionSources, edges: missionDrops } = parseMissions(
    missionsParsed.data.missionRewards,
  )
  const { relics, skipped, nonStandard, nonStandardNames } = parseRelics(
    relicsParsed.data.relics,
  )

  /**
   * Exactly one relic is genuinely irregular today: Requiem ETERNA, eight flat 9.5% slots.
   * The exclusion is structural now rather than a tier allowlist, which means a change to
   * DE's reward table would show up here as a flood of "non-standard" relics and silently
   * empty the dataset. Budget it, so that failure is loud.
   */
  const NONSTANDARD_BUDGET = 3
  if (nonStandard > NONSTANDARD_BUDGET) {
    fail(
      `${String(nonStandard)} relics failed the 3/2/1 structure test (budget ` +
        `${String(NONSTANDARD_BUDGET)}). DE likely changed the relic reward table. ` +
        `Offenders: ${nonStandardNames.slice(0, 10).join(', ')}`,
    )
  }
  if (nonStandard > 0) {
    console.log(
      `  note    excluded ${String(nonStandard)} relic(s) without the 3/2/1 structure: ` +
        nonStandardNames.join(', '),
    )
  }

  // One nameless Requiem row is a known upstream defect. More than a handful means the
  // shape changed and the dataset should not ship.
  const SKIP_BUDGET = 5
  if (skipped > SKIP_BUDGET) {
    fail(
      `${String(skipped)} relics had no name (budget ${String(SKIP_BUDGET)}). ` +
        `Upstream shape likely changed — inspect relics.json before shipping.`,
    )
  }
  if (skipped > 0) {
    console.log(`  note    skipped ${String(skipped)} nameless relic row(s) (known defect)`)
  }

  const relicRewardNames = new Map<string, string>()
  for (const relic of relicsParsed.data.relics) {
    for (const reward of relic.rewards) {
      // Keyed and named canonically, so the item table and the relic rewards that point
      // at it cannot disagree about an id.
      const canonical = parseRewardName(reward.itemName).name
      relicRewardNames.set(slug(canonical), canonical)
    }
  }

  const relicSources: Source[] = relics.map((relic) => ({
    id: `relic:${relic.id.replace(/-relic$/, '')}`,
    kind: 'relic' as const,
    // Same display name as the relic item, so 'AXI A1' and 'Axi A1 Relic' stop
    // disagreeing across surfaces.
    name: relicDisplayName(relic.id, relic.tier),
  }))

  // ---- secondary tables -------------------------------------------------------
  const secondary = mergeParsed(
    SECONDARY.map((table, index) => {
      const payload = secondaryRaw[index]
      const unwrapped = (payload as Record<string, unknown> | undefined)?.[table.key]
      if (unwrapped === undefined) {
        fail(`${table.file}.json did not contain the expected "${table.key}" key`)
      }

      switch (table.kind) {
        case 'bounty': {
          const parsed = z.array(RawBountyTier).safeParse(unwrapped)
          if (!parsed.success) fail(`${table.file}.json failed validation: ${parsed.error.message}`)
          return parseBounties(parsed.data, table.label)
        }
        case 'transient': {
          const parsed = z.array(RawTransient).safeParse(unwrapped)
          if (!parsed.success) fail(`${table.file}.json failed validation: ${parsed.error.message}`)
          return parseTransient(parsed.data)
        }
        case 'sortie': {
          const parsed = z.array(RawNamedReward).safeParse(unwrapped)
          if (!parsed.success) fail(`${table.file}.json failed validation: ${parsed.error.message}`)
          return parseSorties(parsed.data)
        }
        case 'key': {
          const parsed = z.array(RawKeyReward).safeParse(unwrapped)
          if (!parsed.success) fail(`${table.file}.json failed validation: ${parsed.error.message}`)
          return parseKeys(parsed.data)
        }
        case 'syndicate': {
          const parsed = z.record(z.string(), z.array(RawSyndicateItem)).safeParse(unwrapped)
          if (!parsed.success) fail(`${table.file}.json failed validation: ${parsed.error.message}`)
          return parseSyndicates(parsed.data)
        }
        case 'enemy': {
          const parsed = z.array(RawEnemyTable).safeParse(unwrapped)
          if (!parsed.success) fail(`${table.file}.json failed validation: ${parsed.error.message}`)
          return parseEnemyTables(parsed.data)
        }
      }
    }),
  )

  console.log(
    `  tables  ${String(SECONDARY.length)} secondary tables -> ` +
      `${String(secondary.sources.length)} sources, ${String(secondary.edges.length)} edges`,
  )

  // A few enemy-table rewards carry no chance at all. Dropping them is right — emitting 0
  // would render as "impossible" — but a jump means upstream changed shape, not that the
  // game gained a hundred unknown drops.
  const UNKNOWN_CHANCE_BUDGET = 80
  if (secondary.unknownChance > UNKNOWN_CHANCE_BUDGET) {
    fail(
      `${String(secondary.unknownChance)} rewards had no drop chance ` +
        `(budget ${String(UNKNOWN_CHANCE_BUDGET)}). Upstream shape likely changed.`,
    )
  }
  if (secondary.unknownChance > 0) {
    console.log(
      `  note    skipped ${String(secondary.unknownChance)} reward(s) with no upstream chance`,
    )
  }

  // Vaulting is DERIVED, never trusted as an upstream flag (DESIGN.md 10.5): a relic is
  // vaulted exactly when nothing currently in rotation drops it.
  //
  // This must consider EVERY source, not just missions — bounties, transient objectives
  // and keys all drop relics too. Today every bounty-dropped relic happens to have a
  // mission source as well, so a mission-only check gives the same answer; relying on
  // that overlap holding would be a silent trap the next time DE moves a relic.
  const droppedRelicIds = new Set(
    [...missionDrops, ...secondary.edges]
      .filter((edge) => edge.itemId.endsWith('-relic'))
      .map((edge) => edge.itemId),
  )
  for (const relic of relics) {
    relic.vaulted = !droppedRelicIds.has(relic.id)
  }
  const vaultedCount = relics.filter((relic) => relic.vaulted).length
  console.log(
    `  vaulted ${String(vaultedCount)} of ${String(relics.length)} relics have no active source`,
  )

  // Upstream lists an item once per reward SLOT, so the same item can appear six times in
  // one table. Collapse them: the real chance is that of hitting ANY slot.
  const rawEdges: DropEdge[] = [
    ...missionDrops,
    ...relicEdges(relics, INTACT),
    ...secondary.edges,
  ]
  const edges: DropEdge[] = aggregateEdges(rawEdges)
  console.log(
    `  merged  ${String(rawEdges.length - edges.length)} repeated reward slots into existing edges`,
  )

  // Several enemies appear in more than one table (a mod table and an item table), so the
  // same source id can be produced twice. Dedupe by id, keeping the first.
  const sourceById = new Map<string, Source>()
  for (const source of [...missionSources, ...relicSources, ...secondary.sources]) {
    if (!sourceById.has(source.id)) sourceById.set(source.id, source)
  }
  const sources: Source[] = [...sourceById.values()]

  const namesSeen: string[] = []
  for (const nodes of Object.values(missionsParsed.data.missionRewards)) {
    for (const node of Object.values(nodes)) {
      const list = Array.isArray(node.rewards)
        ? node.rewards
        : Object.values(node.rewards).flat()
      for (const reward of list) namesSeen.push(reward.itemName)
    }
  }

  const bare: Item[] = buildItems([...namesSeen, ...secondary.names], relics, relicRewardNames)

  // ---- enrich -----------------------------------------------------------------
  // Item metadata from WFCD's warframe-items. The drop tables carry names and odds and
  // nothing else, so without this every category is a regex guess over the name.
  const wfcdRaw = await Promise.all(
    WFCD_FILES.map((entry) => fetchJson<unknown>(`${ITEMS_REPO}/${entry.file}.json`)),
  )
  const wfcdFiles = WFCD_FILES.map((entry, i) => {
    const parsed = z.array(RawWfcdItem).safeParse(wfcdRaw[i])
    if (!parsed.success) {
      fail(`${entry.file}.json failed validation: ${parsed.error.message}`)
    }
    return { ...entry, rows: parsed.data }
  })

  const enriched = enrichItems(bare, buildEnrichmentIndex(wfcdFiles))
  const enrichedItems: Item[] = enriched.items
  const enrichedIds = new Set(enrichedItems.map((item) => item.id))

  /**
   * Coverage is a gate, not a statistic. A rename upstream, or a change to how components
   * are nested, would silently return the catalogue to "everything is Other" — which looks
   * like a working build. 96.8% of non-relic items match today; the floor is set well below
   * that so ordinary churn passes and a structural break does not.
   */
  const enrichable = bare.filter((item) => item.category !== 'Relic').length
  const coverage = enrichable === 0 ? 1 : enriched.matched / enrichable
  console.log(
    `  wfcd    ${String(enriched.matched)}/${String(enrichable)} non-relic items enriched ` +
      `(${(coverage * 100).toFixed(1)}%)`,
  )
  if (coverage < COVERAGE_FLOOR) {
    fail(
      `item metadata coverage fell to ${(coverage * 100).toFixed(1)}% ` +
        `(floor ${(COVERAGE_FLOOR * 100).toFixed(0)}%). ` +
        `WFCD likely renamed or restructured something. ` +
        `First few unmatched: ${enriched.unmatched.slice(0, 8).join(', ')}`,
    )
  }

  /**
   * Assembled sets — "Braton Prime", built from parts that each drop somewhere.
   *
   * Runs after enrichment because it resolves component names against the FINAL item table,
   * and enrichment is what puts parts in it. Emits only recipes whose every component
   * resolves; see packages/sources/src/sets.ts for why a partial recipe is worse than none.
   */
  const setResult = buildSets(wfcdFiles, (id) => enrichedIds.has(id))
  /**
   * QUIRK — both upstreams title-case roman numerals, so "Lavan Apoc Mk III" arrives as
   * "Mk Ii/Iii/Iv". DE ships 30 such names and zero correct ones, so this is not a WFCD
   * artefact. Applied once here, after every name has been minted, and ids are untouched
   * because they are slugged lowercase.
   */
  let items: Item[] = applySets(enrichedItems, setResult).map((item) => {
    const name = normalizeDisplayName(item.name)
    return name === item.name ? item : { ...item, name }
  })

  const partCount = setResult.sets.reduce((sum, set) => sum + (set.parts?.length ?? 0), 0)
  console.log(
    `  sets    ${String(setResult.sets.length)} assembled items, ` +
      `${String(partCount)} parts ` +
      `(${String(setResult.partial.length)} recipes incomplete, not shipped)`,
  )
  /**
   * A recipe with ingredients and no parts is a crafting note, and shipping it as a set puts
   * an item on /farm and /collection with nothing to farm or collect. sets.ts refuses to emit
   * one; this is the assertion that the refusal held, since the whole parts/ingredients split
   * rests on it.
   */
  const partless = setResult.sets.filter((set) => (set.parts?.length ?? 0) === 0)
  if (partless.length > 0) {
    fail(
      `${String(partless.length)} sets have ingredients but no parts: ` +
        partless
          .slice(0, 5)
          .map((set) => set.id)
          .join(', '),
    )
  }
  if (setResult.sets.length < SET_FLOOR) {
    fail(
      `only ${String(setResult.sets.length)} set recipes resolved (floor ${String(SET_FLOOR)}). ` +
        `WFCD likely renamed components or restructured its recipe nesting. ` +
        `First few incomplete: ${setResult.partial.slice(0, 5).join(' | ')}`,
    )
  }

  /**
   * warframe.market slugs. After sets, deliberately: assembled items are exactly what the
   * market sells as "<name>_set", so linking before they exist would miss all 309 of them.
   *
   * Joined on gameRef, which is the /Lotus/... uniqueName enrichment already attached.
   * Deriving their slug from ours instead is wrong 26% of the time and the misses are not
   * random — see packages/sources/src/market.ts.
   */
  const marketRaw = await fetchJson<unknown>(MARKET_API)
  const marketParsed = RawMarketItems.safeParse(marketRaw)
  if (!marketParsed.success) {
    fail(`warframe.market item list failed validation: ${marketParsed.error.message}`)
  }
  const marketLinked = linkMarketSlugs(items, buildMarketIndex(marketParsed.data.data))
  items = marketLinked.items

  console.log(
    `  market  ${String(marketLinked.linked)} of ${String(items.length)} items link to warframe.market`,
  )
  if (marketLinked.linked < MARKET_FLOOR) {
    fail(
      `only ${String(marketLinked.linked)} items matched warframe.market (floor ${String(MARKET_FLOOR)}). ` +
        `They likely restructured their catalogue or renamed gameRef.`,
    )
  }

  /**
   * The star chart. Fetched as raw wikitext, not JSON, so it is parsed rather than validated
   * — see packages/sources/src/nodes.ts for why evaluating the Lua would be worse.
   */
  const nodeSource = await fetchText(WIKI_NODES)
  const parsedNodes = parseSolNodes(nodeSource)
  const nodes = parsedNodes.nodes

  console.log(
    `  nodes   ${String(nodes.length)} star-chart nodes ` +
      `(${String(nodes.filter((n) => n.faction !== undefined).length)} with a faction, ` +
      `${String(nodes.filter((n) => n.levelRange !== undefined).length)} with levels, ` +
      `${String(parsedNodes.skipped)} skipped)`,
  )
  if (nodes.length < NODE_FLOOR) {
    fail(
      `only ${String(nodes.length)} star-chart nodes parsed (floor ${String(NODE_FLOOR)}). ` +
        `The wiki likely restructured Module:Missions/data.`,
    )
  }

  /**
   * Rivens. Disposition from the same WFCD files the enrichment already read, price from
   * DE's weekly trade statistics. Both are per-WEAPON facts; individual roll grading is
   * deliberately absent because no upstream source publishes the stat ranges it would need,
   * and a confident wrong grade is worse than none.
   */
  const rivenRaw = await fetchJson<unknown>(RIVENS_API)
  const rivenParsed = RawRivenFile.safeParse(rivenRaw)
  if (!rivenParsed.success) {
    fail(`riven trade data failed validation: ${rivenParsed.error.message}`)
  }
  const rivenBuild = buildRivens(wfcdFiles, rivenParsed.data, items)
  const rivens: RivenFamily[] = rivenBuild.families

  const pricedCount = rivens.filter((f) => f.unrolled !== undefined || f.rerolled !== undefined).length
  const weaponCount = rivens.reduce((total, f) => total + f.weapons.length, 0)
  console.log(
    `  rivens  ${String(rivens.length)} families covering ${String(weaponCount)} weapons, ` +
      `${String(pricedCount)} with a traded price (${String(rivenBuild.excluded)} non-rivenable ` +
      `excluded, ${String(rivenBuild.veiled)} veiled, ${String(rivenBuild.unmatched.length)} traded ` +
      `without a matching weapon)`,
  )
  if (rivens.length < RIVEN_FLOOR) {
    fail(
      `only ${String(rivens.length)} riven weapons resolved (floor ${String(RIVEN_FLOOR)}). ` +
        `WFCD or DE likely changed the disposition field or the trade file shape.`,
    )
  }

  console.log(
    `  parsed  ${String(items.length)} items, ${String(sources.length)} sources, ` +
      `${String(edges.length)} edges, ${String(relics.length)} relics`,
  )

  /**
   * Live trade prices.
   *
   * Runs after items are final, because it needs the market slugs resolved above. This is the
   * one dataset allowed to fail without failing the build: warframe.market is a third party,
   * a garnish rather than the product, and an outage there is not a reason to stop shipping
   * drop tables. A sweep that does not clear the floor leaves the published prices alone.
   */
  let prices: MarketPrice[] | undefined
  if (SKIP_PRICES) {
    console.log('  prices  skipped (--skip-prices)')
  } else {
    const pricable = pricableItems(items).length
    const planned = PRICE_LIMIT ?? pricable
    console.log(
      `  prices  sweeping ${String(planned)} of ${String(pricable)} priceable items at 3/s ` +
        `(~${String(Math.ceil(planned / 3 / 60))} min)`,
    )
    const sweep = await sweepPrices(items, {
      ...(PRICE_LIMIT === undefined ? {} : { limit: PRICE_LIMIT }),
      onProgress: (done, total, failures) => {
        console.log(`          ${String(done)}/${String(total)} (${String(failures)} failed)`)
      },
    })
    if (sweptEnough(sweep)) {
      prices = sweep.prices
      console.log(
        `  prices  ${String(sweep.prices.length)} priced, ${String(sweep.failed)} failed ` +
          `of ${String(sweep.attempted)}`,
      )
    } else {
      // Loud, and not fatal. Keeping yesterday's prices is honest; replacing them with a
      // half-empty sweep would read as "nobody is selling this" across half the site.
      console.warn(
        `  prices  SWEEP REJECTED — ${String(sweep.failed)} of ${String(sweep.attempted)} failed, ` +
          `below the ${String(Math.round(SWEEP_FLOOR * 100))}% floor. Keeping the published prices.`,
      )
    }
  }

  // ---- curated planets --------------------------------------------------------
  /**
   * The one place the pipeline asserts something DE never published (DESIGN.md § 16).
   *
   * Curated ids are validated against the item table that was just built, not against a
   * snapshot, so a slug change upstream fails THIS build rather than silently dropping a row
   * from a page months later. There is no tolerance here: one unresolved id is a build
   * failure, because the curated tables are small enough that every entry is meant to resolve.
   */
  const planetBuild = buildPlanets({ nodes, sources, edges, items })
  const planets = planetBuild.planets
  if (planetBuild.unresolved.length > 0) {
    fail(
      `${String(planetBuild.unresolved.length)} curated planet resources match no item: ` +
        `${planetBuild.unresolved.slice(0, 8).join(', ')}. Fix packages/sources/src/planets.ts.`,
    )
  }
  /**
   * Community farming routes, and the checks that keep them honest.
   *
   * Three gates, because this is the softest data on the site and the easiest to let rot:
   * an insight whose item no longer exists fails the build; a citation dated in the future is
   * a typo and fails the build; and a node name that resolves to no source is reported, since
   * a misspelling there is otherwise invisible — the name simply renders unlinked.
   */
  const guideBuild = buildGuides(sources, items)
  const guides = guideBuild.guides
  if (guideBuild.unresolved.length > 0) {
    fail(
      `${String(guideBuild.unresolved.length)} farming insight(s) match no item: ` +
        `${guideBuild.unresolved.join(', ')}. Fix packages/sources/src/guides.ts.`,
    )
  }
  const today = new Date().toISOString().slice(0, 10)
  const future = allCitations().filter(
    (citation) => (citation.updated ?? '') > today || citation.retrieved > today,
  )
  if (future.length > 0) {
    fail(
      `${String(future.length)} citation(s) are dated in the future: ` +
        `${future.map((c) => c.title).join(', ')}. Fix packages/sources/src/guides.ts.`,
    )
  }
  if (guideBuild.unlinkedNodes.length > 0) {
    console.warn(
      `  guides  ${String(guideBuild.unlinkedNodes.length)} named node(s) matched no source ` +
        `and will render unlinked: ${[...new Set(guideBuild.unlinkedNodes)].join(', ')}`,
    )
  }
  const staleCitations = allCitations().filter((citation) => isStale(citation, new Date()))
  console.log(
    `  guides  ${String(guides.length)} resources with routes, ` +
      `${String(allCitations().length)} citations (${String(staleCitations.length)} past ${String(STALE_AFTER_DAYS)} days, flagged in the UI)`,
  )

  // The other curated table. Its ids never reach a chunk — the strategy is chosen at render
  // time — so nothing else would ever notice one going stale.
  const knownIds = new Set(items.map((item) => item.id))
  const staleOverrides = Object.keys(FARM_OVERRIDES).filter((id) => !knownIds.has(id))
  if (staleOverrides.length > 0) {
    fail(
      `${String(staleOverrides.length)} farming override(s) match no item: ` +
        `${staleOverrides.join(', ')}. Fix packages/core/src/farming.ts.`,
    )
  }

  const curatedRows = planets.reduce(
    (total, planet) => total + planet.resources.filter((row) => row.basis !== 'reward-table').length,
    0,
  )
  console.log(
    `  planets ${String(planets.length)} places, ` +
      `${String(planets.reduce((t, p) => t + p.resources.length, 0))} resource rows ` +
      `(${String(curatedRows)} curated, all ids resolved)`,
  )

  // ---- sanity gates -----------------------------------------------------------
  // These run BEFORE anything is written. A failure must leave the committed dataset
  // untouched rather than half-replaced.
  const previous = await readPreviousManifest()

  if (previous?.counts !== undefined) {
    const drift: string[] = []
    if (!within(items.length, previous.counts.items, 0.15)) {
      drift.push(
        `item count ${String(previous.counts.items)} -> ${String(items.length)}`,
      )
    }
    if (!within(edges.length, previous.counts.edges, 0.15)) {
      drift.push(
        `edge count ${String(previous.counts.edges)} -> ${String(edges.length)}`,
      )
    }

    if (drift.length > 0) {
      // The gate cannot distinguish an intentional coverage expansion from upstream
      // corruption, so a human has to say which it is. --accept-drift is deliberately
      // absent from the daily workflow: the cron must never be able to wave through a
      // dataset that halved overnight.
      if (!ACCEPT_DRIFT) {
        fail(
          `${drift.join('; ')} — more than 15%. If this is expected, rerun with ` +
            `--accept-drift. If it is not, upstream changed and nothing should ship.`,
        )
      }
      console.log(`  DRIFT   accepted by hand: ${drift.join('; ')}`)
    }
  }

  // The fixture itself must still hold — if DE changes the reward table, core's
  // REFINEMENT_TABLE is the thing that has to be updated.
  for (const [refinement, row] of Object.entries(REFINEMENT_TABLE)) {
    const total = refinementRowTotal(row)
    if (Math.abs(total - 1) > 0.001) {
      fail(`${refinement} rarity tiers sum to ${(total * 100).toFixed(3)}%, expected 100% +/- 0.1`)
    }
  }

  // And every PARSED relic must sum to 100% too. Checking only the fixture above would
  // validate a constant rather than the data, so a relic whose rarities were derived
  // wrongly (say 4 commons and no rare) would sail straight through.
  for (const relic of relics) {
    const total = relic.rewards.reduce((sum, reward) => sum + (INTACT[reward.rarity] ?? 0), 0)
    if (Math.abs(total - 1) > 0.001) {
      const breakdown = relic.rewards.map((r) => r.rarity).join('/')
      fail(
        `relic ${relic.id} rarity tiers sum to ${(total * 100).toFixed(2)}%, ` +
          `expected 100% +/- 0.1 (slots: ${breakdown})`,
      )
    }
  }

  const itemIds = new Set(items.map((item) => item.id))
  const sourceIds = new Set(sources.map((source) => source.id))
  const orphans = edges.filter(
    (edge) => !itemIds.has(edge.itemId) || !sourceIds.has(edge.sourceId),
  )
  if (orphans.length > 0) {
    const sample = orphans
      .slice(0, 5)
      .map((o) => `${o.itemId} <- ${o.sourceId}`)
      .join(', ')
    fail(`${String(orphans.length)} orphaned edges. First few: ${sample}`)
  }

  /**
   * The same gate, for the two reference types sets introduced. An edge is not the only way
   * one row can point at another any more: a set's `parts` and `ingredients` and a part's
   * `buildsInto` are all item ids, and a dangling one renders as a link to a page that does
   * not exist. Hazard 14 is that every id must be minted the same way and the orphan gate is
   * what proves it — that argument does not stop applying because the reference is not an edge.
   */
  const danglingRefs: string[] = []
  for (const item of items) {
    for (const field of ['parts', 'ingredients'] as const) {
      for (const component of item[field] ?? []) {
        if (!itemIds.has(component.itemId)) {
          danglingRefs.push(`${item.id}.${field} -> ${component.itemId}`)
        }
      }
    }
    for (const target of item.buildsInto ?? []) {
      if (!itemIds.has(target)) danglingRefs.push(`${item.id}.buildsInto -> ${target}`)
    }
  }
  if (danglingRefs.length > 0) {
    fail(
      `${String(danglingRefs.length)} dangling item references. ` +
        `First few: ${danglingRefs.slice(0, 5).join(', ')}`,
    )
  }

  // Re-parse what we are about to WRITE, not just what we read.
  //
  // Every upstream payload is Zod-parsed on the way in, but nothing checked the shape on
  // the way out — so a mapping bug in this file could ship a dataset that the client then
  // refuses to parse, and the failure would surface as a blank search box in production
  // rather than a red build. The one thing the pipeline must never do is commit a bad
  // dataset, and this is the last place to catch it.
  const shapes: [string, z.ZodType, unknown[]][] = [
    ['items', Item, items],
    ['sources', Source, sources],
    ['edges', DropEdge, edges],
    ['relics', RelicDetail, relics],
    ['rivens', RivenFamily, rivens],
    ['nodes', SolNode, nodes],
    ['planets', Planet, planets],
    ['guides', ResourceGuide, guides],
    ...(prices === undefined ? [] : ([['prices', MarketPrice, prices]] as [string, z.ZodType, unknown[]][])),
  ]
  for (const [name, schema, rows] of shapes) {
    const result = z.array(schema).safeParse(rows)
    if (!result.success) {
      const sample = result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
      fail(
        `emitted ${name} failed its own schema (${String(result.error.issues.length)} issues). First few: ${sample}`,
      )
    }
  }

  console.log('  gates   all passed')

  // ---- emit -------------------------------------------------------------------
  /**
   * Prices are hashed SEPARATELY from the drop data, and deliberately.
   *
   * The market moves every day, so a combined hash would change every day — and because a
   * chunk's filename carries the hash, every one of the 5 MB of unchanged drop chunks would
   * be rewritten under a new immutable URL daily, forcing every returning visitor to
   * re-download all of it to read a price tick. Two hashes keep `manifest.hash` meaning what
   * it has always meant: the drop data changed.
   */
  const chunks: Record<string, unknown> = { items, sources, edges, relics, rivens, nodes, planets, guides }
  const payload = JSON.stringify(chunks)
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 12)

  const priceHash =
    prices === undefined
      ? undefined
      : createHash('sha256').update(JSON.stringify(prices)).digest('hex').slice(0, 12)
  const priceFile = priceHash === undefined ? undefined : `prices.${priceHash}.json`
  // Carried forward when this run did not produce a usable sweep, so a market outage does not
  // delete every price on the site.
  const keptPriceFile = previous?.files.prices
  const nextPriceFile = priceFile ?? keptPriceFile

  const dropUnchanged = previous?.hash === hash
  const pricesUnchanged = nextPriceFile === keptPriceFile
  if (dropUnchanged && pricesUnchanged) {
    console.log(`  no change (hash ${hash}). Nothing to write.`)
    return
  }

  console.log(`  hash    ${previous?.hash ?? '(none)'} -> ${hash}`)
  if (priceFile !== undefined) {
    console.log(`  prices  ${keptPriceFile ?? '(none)'} -> ${priceFile}`)
  }

  if (DIFF_ONLY) {
    console.log('  dry run - stopping before write')
    return
  }

  await mkdir(OUT_DIR, { recursive: true })

  const files: Record<string, string> = {}
  for (const [name, data] of Object.entries(chunks)) {
    const filename = `${name}.${hash}.json`
    await writeFile(join(OUT_DIR, filename), JSON.stringify(data), 'utf8')
    files[name] = filename
  }

  if (prices !== undefined && priceFile !== undefined) {
    await writeFile(join(OUT_DIR, priceFile), JSON.stringify(prices), 'utf8')
    files.prices = priceFile
  } else if (keptPriceFile !== undefined) {
    // Left on disk from the previous build; naming it again keeps it live and keeps the
    // pruner below from deleting it.
    files.prices = keptPriceFile
  }

  const manifest: Manifest = {
    hash,
    builtAt: new Date(infoParsed.data.timestamp).toISOString(),
    files,
    upstream: {
      'warframe-drop-data': infoParsed.data.hash,
      // The riven trade file carries no timestamp of its own — DE republishes it weekly and
      // dates nothing — so the only honest provenance is when we read it. Recorded here
      // rather than rendered as a publication date, which it is not. It only advances when
      // a chunk actually changed, because an unchanged build returns before writing this.
      'riven-trades-fetched': new Date().toISOString(),
    },
    attributions: ATTRIBUTIONS,
    counts: {
      items: items.length,
      sources: sources.length,
      edges: edges.length,
      rivens: rivens.length,
      planets: planets.length,
      guides: guides.length,
      ...(prices === undefined ? {} : { prices: prices.length }),
    },
  }
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  // Old hashed chunks would otherwise accumulate in the repo forever.
  // Keyed on every filename the manifest names, not on the drop hash alone: prices carry
  // their own hash, and matching on `hash` would have deleted the price chunk every run.
  const live = new Set(Object.values(files))
  const stale = (await readdir(OUT_DIR)).filter(
    (file) => file.endsWith('.json') && file !== 'manifest.json' && !live.has(file),
  )
  for (const file of stale) await unlink(join(OUT_DIR, file))
  if (stale.length > 0) console.log(`  pruned  ${String(stale.length)} stale chunk(s)`)

  console.log(`  wrote   ${String(Object.keys(files).length)} chunks + manifest to public/data/`)
}

await main()
