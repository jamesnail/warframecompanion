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

import { REFINEMENT_TABLE, refinementRowTotal } from '@provenance/core'
import type { DropEdge, Item, Manifest, Source } from '@provenance/core'
import {
  RawInfo,
  RawMissionRewards,
  RawRelics,
  buildItems,
  fetchJson,
  parseMissions,
  parseRelics,
  relicEdges,
  slug,
} from '@provenance/sources'

const DIFF_ONLY = process.argv.includes('--diff')

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

function fail(message: string): never {
  console.error(`\n  FAILED  ${message}\n`)
  process.exit(1)
}

function within(actual: number, previous: number, tolerance: number): boolean {
  if (previous === 0) return true
  return Math.abs(actual - previous) / previous <= tolerance
}

async function readPreviousManifest(): Promise<Manifest | undefined> {
  try {
    const raw = await readFile(join(OUT_DIR, 'manifest.json'), 'utf8')
    return JSON.parse(raw) as Manifest
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  console.log(DIFF_ONLY ? 'data:diff - dry run, nothing will be written' : 'data:build')

  // ---- fetch ------------------------------------------------------------------
  console.log('fetching upstream...')
  const [info, missionsRaw, relicsRaw] = await Promise.all([
    fetchJson<unknown>(`${REPO}/info.json`),
    fetchJson<unknown>(`${REPO}/missionRewards.json`),
    fetchJson<unknown>(`${REPO}/relics.json`),
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
      relicRewardNames.set(slug(reward.itemName), reward.itemName)
    }
  }

  const relicSources: Source[] = relics.map((relic) => ({
    id: `relic:${relic.id.replace(/-relic$/, '')}`,
    kind: 'relic' as const,
    name: relic.id.replace(/-relic$/, '').replace(/-/g, ' ').toUpperCase(),
  }))

  // Vaulting is DERIVED, never trusted as an upstream flag (DESIGN.md 10.5): a relic is
  // vaulted exactly when nothing currently in rotation drops it. Recomputing it every
  // build is what keeps it correct across Prime Access rotations.
  const droppedRelicIds = new Set(
    missionDrops.filter((edge) => edge.itemId.endsWith('-relic')).map((edge) => edge.itemId),
  )
  for (const relic of relics) {
    relic.vaulted = !droppedRelicIds.has(relic.id)
  }
  const vaultedCount = relics.filter((relic) => relic.vaulted).length
  console.log(
    `  vaulted ${String(vaultedCount)} of ${String(relics.length)} relics have no active source`,
  )

  const edges: DropEdge[] = [...missionDrops, ...relicEdges(relics, INTACT)]
  const sources: Source[] = [...missionSources, ...relicSources]

  const namesSeen: string[] = []
  for (const nodes of Object.values(missionsParsed.data.missionRewards)) {
    for (const node of Object.values(nodes)) {
      const list = Array.isArray(node.rewards)
        ? node.rewards
        : Object.values(node.rewards).flat()
      for (const reward of list) namesSeen.push(reward.itemName)
    }
  }

  const items: Item[] = buildItems(namesSeen, relics, relicRewardNames)

  console.log(
    `  parsed  ${String(items.length)} items, ${String(sources.length)} sources, ` +
      `${String(edges.length)} edges, ${String(relics.length)} relics`,
  )

  // ---- sanity gates -----------------------------------------------------------
  // These run BEFORE anything is written. A failure must leave the committed dataset
  // untouched rather than half-replaced.
  const previous = await readPreviousManifest()

  if (previous?.counts !== undefined) {
    if (!within(items.length, previous.counts.items, 0.15)) {
      fail(
        `item count moved more than 15%: ${String(previous.counts.items)} -> ${String(items.length)}`,
      )
    }
    if (!within(edges.length, previous.counts.edges, 0.15)) {
      fail(
        `edge count moved more than 15%: ${String(previous.counts.edges)} -> ${String(edges.length)}`,
      )
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
