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

import { DropEdge, Item, Manifest, REFINEMENT_TABLE, RelicDetail, Source, refinementRowTotal } from '@provenance/core'
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
  buildItems,
  fetchJson,
  mergeParsed,
  parseBounties,
  parseEnemyTables,
  parseKeys,
  parseMissions,
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

/** Explicit human override for the +/-15% count gates. Never set in CI. */
const ACCEPT_DRIFT = process.argv.includes('--accept-drift')

const REPO = 'https://raw.githubusercontent.com/WFCD/warframe-drop-data/master/data'
const OUT_DIR = fileURLToPath(new URL('../apps/web/public/data/', import.meta.url))

const ATTRIBUTIONS = [
  { name: 'WFCD / warframe-drop-data', url: 'https://github.com/WFCD/warframe-drop-data' },
  { name: '@wfcd/items', url: 'https://github.com/WFCD/warframe-items' },
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
  const { relics, skipped, nonStandard } = parseRelics(relicsParsed.data.relics)

  if (nonStandard > 0) {
    console.log(
      `  note    excluded ${String(nonStandard)} non-standard relic row(s) ` +
        `(Requiem/Vanguard — see DESIGN.md 10.4)`,
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

  const items: Item[] = buildItems([...namesSeen, ...secondary.names], relics, relicRewardNames)

  console.log(
    `  parsed  ${String(items.length)} items, ${String(sources.length)} sources, ` +
      `${String(edges.length)} edges, ${String(relics.length)} relics`,
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
  const chunks: Record<string, unknown> = { items, sources, edges, relics }
  const payload = JSON.stringify(chunks)
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 12)

  if (previous?.hash === hash) {
    console.log(`  no change (hash ${hash}). Nothing to write.`)
    return
  }

  console.log(`  hash    ${previous?.hash ?? '(none)'} -> ${hash}`)

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

  const manifest: Manifest = {
    hash,
    builtAt: new Date(infoParsed.data.timestamp).toISOString(),
    files,
    upstream: { 'warframe-drop-data': infoParsed.data.hash },
    attributions: ATTRIBUTIONS,
    counts: { items: items.length, sources: sources.length, edges: edges.length },
  }
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  // Old hashed chunks would otherwise accumulate in the repo forever.
  const stale = (await readdir(OUT_DIR)).filter(
    (file) => file.endsWith('.json') && file !== 'manifest.json' && !file.includes(hash),
  )
  for (const file of stale) await unlink(join(OUT_DIR, file))
  if (stale.length > 0) console.log(`  pruned  ${String(stale.length)} stale chunk(s)`)

  console.log(`  wrote   ${String(Object.keys(files).length)} chunks + manifest to public/data/`)
}

await main()
