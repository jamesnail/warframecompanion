import type { SolNode } from '@provenance/core'

import { normalizeDisplayName } from './names'

/**
 * The star chart, keyed by Digital Extremes' internal node id.
 *
 * This exists because the live world state feed identifies everything by internal id —
 * "SolNode232", "CrewBattleNode518" — and nothing else we hold can turn those into a place a
 * player recognises. Every node the live feed referenced resolved through this map when it
 * was measured: 44 of 44, Railjack nodes included.
 *
 * Source: the Warframe wiki's `Module:Missions/data`, which is a Lua table rather than an
 * API. There is no Cargo or Semantic MediaWiki on that instance, so there is nothing to
 * query; the page is fetched raw and parsed. That is more brittle than the Zod-validated
 * JSON everything else here uses, which is why the pipeline gates on the parsed count.
 *
 * It carries faction, level range and tileset as well, none of which DE's drop tables
 * publish at all.
 */

/**
 * The records are machine-regular: one per line, flat `Key = value` pairs inside braces.
 * Parsed field-wise rather than by evaluating Lua, because evaluating a page anyone can edit
 * is not something this build should ever do.
 */
const RECORD = /\{\s*Name\s*=\s*"((?:[^"\\]|\\.)*)"[^\n]*\}/g

function stringField(line: string, key: string): string | undefined {
  const match = new RegExp(`\\b${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(line)
  return match?.[1]
}

function numberField(line: string, key: string): number | undefined {
  const match = new RegExp(`\\b${key}\\s*=\\s*(-?\\d+)`).exec(line)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

export interface ParsedNodes {
  nodes: SolNode[]
  /** Records that carried no InternalName and so cannot be keyed. Counted, not thrown. */
  skipped: number
}

export function parseSolNodes(lua: string): ParsedNodes {
  const nodes: SolNode[] = []
  const seen = new Set<string>()
  let skipped = 0

  for (const match of lua.matchAll(RECORD)) {
    const line = match[0]
    const id = stringField(line, 'InternalName')
    const name = match[1]
    // Empty is as good as absent: one record in the module carries InternalName = "",
    // which the output-shape gate caught as a zero-length id.
    if (id === undefined || id === '' || name === undefined || name === '') {
      skipped++
      continue
    }
    // The module holds a few dev duplicates; first writer wins, matching every other index here.
    if (seen.has(id)) continue
    seen.add(id)

    const min = numberField(line, 'MinLevel')
    const max = numberField(line, 'MaxLevel')
    const planet = stringField(line, 'Planet')
    const faction = stringField(line, 'Enemy')
    const missionType = stringField(line, 'Type')
    const tileset = stringField(line, 'Tileset')

    nodes.push({
      id,
      name: normalizeDisplayName(name),
      ...(planet === undefined ? {} : { planet: normalizeDisplayName(planet) }),
      ...(faction === undefined ? {} : { faction }),
      ...(missionType === undefined ? {} : { missionType }),
      ...(tileset === undefined ? {} : { tileset }),
      ...(min === undefined || max === undefined ? {} : { levelRange: [min, max] as [number, number] }),
    })
  }

  // Stable order so a rebuild that found nothing new hashes identically.
  nodes.sort((a, b) => a.id.localeCompare(b.id))
  return { nodes, skipped }
}
