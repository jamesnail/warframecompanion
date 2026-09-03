import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { compileQuery, parseQuery, type DropEdge, type Item, type QueryItem, type Source } from '@provenance/core'

import { buildQueryItems, isPrimeName, tierFromSourceName } from './query-index'

/**
 * The counts here are asserted against the REAL shipped dataset, not fixtures.
 *
 * That is deliberate and it is the point of the file: the defect this design exists to prevent
 * — `is:prime cat:warframe` returning 0 because assembled sets have no drop edges — is
 * invisible on any fixture small enough to hand-write. A synthetic Ash Prime with a synthetic
 * Orokin Cell would also have caught the rollup bug, but only because I already knew to build
 * the fixture that way.
 *
 * The numbers move when the pipeline runs. Where a count is a property of the data rather than
 * of this code (item totals), the assertion is a range; where it is a property of the CODE
 * (prime Warframes resolve, Ash Prime is relic-only), it is exact.
 */

const DATA = join(process.cwd(), 'public', 'data')

function chunk<T>(name: string): T[] {
  const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')) as {
    files: Record<string, string>
  }
  const file = manifest.files[name]
  if (file === undefined) throw new Error(`manifest has no ${name} chunk`)
  return JSON.parse(readFileSync(join(DATA, file), 'utf8')) as T[]
}

const items = chunk<Item>('items')
const sources = chunk<Source>('sources')
const edges = chunk<DropEdge>('edges')

const index = buildQueryItems(items, sources, edges)
const byId = new Map(index.map((entry) => [entry.id, entry]))
const sourcesById = new Map(sources.map((source) => [source.id, source]))

const matching = (query: string): QueryItem[] => {
  const parsed = parseQuery(query)
  expect(parsed.errors, `${query} should parse cleanly`).toEqual([])
  const compiled = compileQuery(parsed.query)
  return index.filter((entry) => compiled.matchItem(entry))
}

describe('the dataset itself', () => {
  it('is the shape the rest of these tests assume', () => {
    expect(items.length).toBeGreaterThan(4000)
    expect(edges.length).toBeGreaterThan(20000)
  })
})

describe('is:prime cat:warframe', () => {
  it('finds every prime Warframe', () => {
    // THE regression. Evaluated over edges this is 0, because all 50 prime Warframes have
    // zero drop edges of their own — a set is built, never dropped.
    const primes = matching('is:prime cat:warframe')
    expect(primes.length).toBe(50)
    expect(primes.map((entry) => entry.name)).toContain('Ash Prime')
  })

  it('and every prime Warframe reaches a source through the rollup', () => {
    for (const frame of matching('is:prime cat:warframe')) {
      expect(frame.kinds.size, frame.name).toBeGreaterThan(0)
    }
  })

  it('finds prime weapons too, which have the same shape', () => {
    expect(matching('is:prime cat:melee').length).toBeGreaterThan(0)
    expect(matching('is:prime cat:primary').length).toBeGreaterThan(0)
  })
})

describe('the rollup rule', () => {
  it('gives Ash Prime relic paths and NOT enemy paths', () => {
    // The hazard test. Ash Prime's recipe is four relic-only blueprints plus one Orokin
    // Cell, which has 121 edges across missions, bounties, transients and enemies. A rollup
    // that follows the whole recipe rather than the parts inherits all of them, and makes
    // from:enemy match every prime Warframe in the game.
    const ash = byId.get('ash-prime')
    expect(ash).toBeDefined()
    expect([...(ash?.kinds ?? [])].sort()).toEqual(['relic'])
  })

  it('so from:enemy does not match a single prime Warframe', () => {
    expect(matching('is:prime cat:warframe from:enemy')).toHaveLength(0)
  })

  it('does not roll up through a component shared by many sets', () => {
    // Orokin Cell builds into 177 things; it contributes to none of them.
    const cell = byId.get('orokin-cell')
    expect(cell?.kinds.size).toBeGreaterThan(0)
    expect(cell?.kinds.has('enemy')).toBe(true)
  })

  it('leaves an item with its own edges alone', () => {
    const barrel = index.find((entry) => entry.id === 'braton-prime-barrel')
    expect(barrel?.kinds.has('relic')).toBe(true)
  })

  it('no part is shared between two sets, so nothing is counted twice', () => {
    // What the parts/ingredients split bought. The rule it replaced — inherit a component
    // unless it builds into more than one thing — was wrong in both directions: it let
    // through 16 single-use resources (Oxium, Cryotic, Nullstones, Neural Sensors and 12
    // more), and it stripped genuine parts from the four Ak- weapons. Fan-in over parts is
    // the measurement, and it is now exactly 1 everywhere.
    const fanIn = new Map<string, number>()
    for (const item of items) {
      for (const part of item.parts ?? []) {
        fanIn.set(part.itemId, (fanIn.get(part.itemId) ?? 0) + 1)
      }
    }
    expect([...fanIn].filter(([, n]) => n > 1)).toEqual([])
  })

  it('an Ak- weapon keeps the single it is built from as an ingredient, at a real count', () => {
    // Upstream lists the single twice rather than once at times two, which rendered as a
    // recipe needing two different things with the same name.
    const akbronco = items.find((item) => item.id === 'akbronco-prime')
    expect(akbronco?.ingredients).toEqual([{ itemId: 'bronco-prime-blueprint', count: 2 }])
  })

  it('rolls up parts and nothing else, across the whole corpus', () => {
    // Stated over every item rather than over one known-bad case, because the two times this
    // broke it broke somewhere nobody was looking. `kinds` must be exactly the union over
    // the item and its parts — an ingredient contributing even one kind fails here.
    const kindsOf = new Map<string, Set<string>>()
    for (const edge of edges) {
      const kind = sourcesById.get(edge.sourceId)?.kind
      if (kind === undefined) continue
      const set = kindsOf.get(edge.itemId) ?? new Set<string>()
      set.add(kind.toLowerCase())
      kindsOf.set(edge.itemId, set)
    }

    let wouldLeak = 0
    for (const item of items) {
      const expected = new Set<string>()
      for (const id of [item.id, ...(item.parts ?? []).map((part) => part.itemId)]) {
        for (const kind of kindsOf.get(id) ?? []) expected.add(kind)
      }
      expect([...(byId.get(item.id)?.kinds ?? [])].sort(), item.id).toEqual([...expected].sort())

      for (const ingredient of item.ingredients ?? []) {
        for (const kind of kindsOf.get(ingredient.itemId) ?? []) {
          if (!expected.has(kind)) wouldLeak++
        }
      }
    }

    // And the rule is load-bearing rather than vacuous: this many item/kind pairs would be
    // wrong if ingredients were rolled up, which is what the old heuristic did for 16 of them.
    expect(wouldLeak).toBeGreaterThan(100)
  })
})

describe('the item-grain projection', () => {
  it('gives every prime Warframe a best path, through a named part', () => {
    for (const frame of matching('is:prime cat:warframe')) {
      expect(frame.paths, frame.name).toBeGreaterThan(0)
      expect(frame.best, frame.name).toBeDefined()
      // The frame is not what drops, so the row has to say which piece does.
      expect(frame.best?.via, frame.name).toBeDefined()
    }
  })

  it('counts zero paths for an item nothing drops, rather than guessing one', () => {
    // A vaulted relic: a real item, in no live drop table. "0 paths" is the answer.
    const undropped = index.filter((entry) => entry.paths === 0)
    expect(undropped.length).toBeGreaterThan(500)
    for (const entry of undropped) expect(entry.best, entry.name).toBeUndefined()
  })

  it('names the item itself, not a part, where the item is what drops', () => {
    expect(byId.get('braton-prime-barrel')?.best?.via).toBeUndefined()
  })

  it('agrees with bestChance about which path is best', () => {
    for (const entry of index) {
      if (entry.best === undefined) continue
      expect(entry.bestChance, entry.name).toBeGreaterThan(-1)
    }
  })
})

describe('keys against real data', () => {
  it('cat: covers every item', () => {
    const categories = new Set(index.map((entry) => entry.category.toLowerCase()))
    let total = 0
    for (const category of categories) total += matching(`cat:${category}`).length
    expect(total).toBe(index.length)
  })

  it('from: partitions by source kind', () => {
    expect(matching('from:relic').length).toBeGreaterThan(0)
    expect(matching('from:enemy').length).toBeGreaterThan(0)
    expect(matching('from:mission').length).toBeGreaterThan(0)
  })

  it('planet: matches mission-backed items only', () => {
    const earth = matching('planet:earth')
    expect(earth.length).toBeGreaterThan(0)
    for (const entry of earth) expect(entry.planets.has('earth')).toBe(true)
  })

  it('tier: reads the relic tier off the source name', () => {
    for (const tier of ['lith', 'meso', 'neo', 'axi']) {
      expect(matching(`tier:${tier}`).length, tier).toBeGreaterThan(0)
    }
  })

  it('is:vaulted marks relics that no longer drop', () => {
    const vaultedRelics = matching('cat:relic is:vaulted')
    // 737 of 772 relics are vaulted; the exact split moves with each prime rotation.
    expect(vaultedRelics.length).toBeGreaterThan(600)
    expect(matching('cat:relic -is:vaulted').length).toBeGreaterThan(0)
  })

  it('an item reachable through one live relic is not vaulted', () => {
    // The whole reason vaulted is computed per-path and then ALL-ed rather than per-item:
    // one live path is all you need.
    const live = matching('is:prime from:relic -is:vaulted')
    expect(live.length).toBeGreaterThan(0)
  })

  it('mr: never matches an item that has no mastery requirement', () => {
    for (const entry of matching('mr:<8')) expect(entry.masteryReq).toBeDefined()
  })

  it('chance: is typed as a percentage of the best path', () => {
    for (const entry of matching('chance:>50')) expect(entry.bestChance).toBeGreaterThan(0.5)
  })

  it('has:market matches items with a resolved warframe.market slug', () => {
    expect(matching('has:market').length).toBeGreaterThan(2000)
  })
})

describe('helpers', () => {
  it('isPrimeName reads the word on a boundary, not a substring', () => {
    expect(isPrimeName('Braton Prime')).toBe(true)
    expect(isPrimeName('Braton Prime Barrel')).toBe(true)
    // "Primed" mods are a different thing entirely and must not be swept in.
    expect(isPrimeName('Primed Continuity')).toBe(false)
    expect(isPrimeName('Braton')).toBe(false)
  })

  it('tierFromSourceName validates rather than trusting the first word', () => {
    expect(tierFromSourceName('Axi A1 Relic')).toBe('Axi')
    expect(tierFromSourceName('Cambria')).toBeUndefined()
  })

  it('every relic source in the real data names its tier first', () => {
    const relicSources = sources.filter((source) => source.kind === 'relic')
    const named = relicSources.filter((source) => tierFromSourceName(source.name) !== undefined)
    expect(named.length).toBe(relicSources.length)
  })
})

describe('performance', () => {
  it('evaluates the full corpus well inside a frame', () => {
    const compiled = compileQuery(parseQuery('is:prime from:relic -is:vaulted').query)
    const started = performance.now()
    for (let run = 0; run < 20; run++) index.filter((entry) => compiled.matchItem(entry))
    const perRun = (performance.now() - started) / 20
    // Measured at well under 1 ms; the assertion is loose enough to survive a busy CI box and
    // tight enough to catch a predicate that starts scanning edges per row.
    expect(perRun).toBeLessThan(16)
  })
})
