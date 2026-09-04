import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isSet, type DropEdge, type Item, type RivenFamily, type Source } from '@provenance/core'

/**
 * The measurements this codebase argues from, checked against the data it ships.
 *
 * Several comments justify a design decision with a count — "0 of 2,417 sources carry a
 * faction, so there is no `faction:` key", "Orokin Cell builds into 177 sets, so cap the
 * backlink". Those are the load-bearing kind: if the number changes, the decision it supports
 * may no longer be right, and nothing was watching. Three had already drifted silently by the
 * time anyone looked, which is exactly what `about/page.tsx` warns about in its own header —
 * "a hand-written '4,800 items' becomes a lie on the next daily build and nobody notices".
 *
 * Each test asserts the CLAIM, not the literal figure. `data.yml` commits a refresh without
 * running anything, and the push then triggers CI, so an exact assertion would turn the build
 * red the morning after a routine data change, over a number that was never the point. The
 * bounds are wide enough to absorb DE adding a Warframe and tight enough that a structural
 * break cannot pass. Where a claim IS structural — every undropped item is a vaulted relic or
 * a set — it is asserted exactly, because there the number is the argument.
 *
 * A failure here is not necessarily a bug in the code. It means a comment now says something
 * untrue: read the one this test names, and either update it or reconsider what it justifies.
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
const rivens = chunk<RivenFamily>('rivens')

const itemsById = new Map(items.map((item) => [item.id, item]))
const sourcesById = new Map(sources.map((source) => [source.id, source]))
const withEdge = new Set(edges.map((edge) => edge.itemId))

describe('packages/core/src/query/keys.ts — why there is no faction: key', () => {
  it('still finds the faction field empty on every source', () => {
    // The comment's whole argument: a key that silently matches nothing is worse than a
    // missing key. Exact, because "some" is a different world from "none" — the day this
    // stops being zero is the day the key becomes worth adding, and that is a decision
    // someone should make deliberately rather than a drift to absorb.
    expect(sources.filter((source) => source.faction !== undefined)).toHaveLength(0)
    expect(sources.length).toBeGreaterThan(2000)
  })
})

describe('apps/web/src/lib/query-index.ts — why the query language is item-grained', () => {
  it('still leaves a thousand-odd items with no drop edge of their own', () => {
    // The reason /browse carries an item grain at all, and defaults to it. If this collapsed
    // toward zero the second grain would be dead weight. It is currently 1,046.
    const undropped = items.filter((item) => !withEdge.has(item.id))
    expect(undropped.length).toBeGreaterThan(800)
  })

  it('still accounts for every one of them as a vaulted relic or an assembled set', () => {
    // Structural, so asserted exactly: those are the only two ways to be in the catalogue and
    // in no drop table at all. A third kind appearing means something new is unreachable, and
    // the comment — probably also a page — needs to learn about it.
    const undropped = items.filter((item) => !withEdge.has(item.id))
    const unexplained = undropped.filter((item) => item.category !== 'Relic' && !isSet(item))
    expect(unexplained.map((item) => item.id)).toEqual([])
  })

  it('still finds every prime Warframe among them', () => {
    const primeFrames = items.filter(
      (item) => item.category === 'Warframe' && / Prime\b/.test(item.name),
    )
    expect(primeFrames.length).toBeGreaterThan(40)
    expect(primeFrames.filter((item) => withEdge.has(item.id))).toHaveLength(0)
  })
})

describe('packages/core/src/parts.ts — every recipe-carrying item is a set', () => {
  it('still gives every item with a recipe at least one part', () => {
    // The build gate asserts this on the way out of the pipeline; this asserts it on the way
    // in, over the data actually shipped. A recipe of nothing but resources is a crafting
    // note, and /farm and /collection have no answer for one.
    const withRecipe = items.filter(
      (item) => item.parts !== undefined || item.ingredients !== undefined,
    )
    expect(withRecipe.length).toBeGreaterThan(200)
    expect(withRecipe.filter((item) => !isSet(item)).map((item) => item.id)).toEqual([])
  })
})

describe('the shared-ingredient comments — collection.ts, farm.ts, RecipeTable.tsx', () => {
  it('still has Orokin Cell in the recipe of well over a hundred sets', () => {
    // Cited in four places to justify three separate decisions: the capped "Part of" backlink,
    // tracking by stated intent rather than inferred from owned parts, and the parts/
    // ingredients split itself. All three are unmotivated if this is a handful.
    const cell = itemsById.get('orokin-cell')
    expect(cell).toBeDefined()
    expect((cell?.buildsInto ?? []).length).toBeGreaterThan(100)
  })

  it('still has it dropping from enemies, which is what made the old rollup wrong', () => {
    const kinds = new Set(
      edges
        .filter((edge) => edge.itemId === 'orokin-cell')
        .map((edge) => sourcesById.get(edge.sourceId)?.kind),
    )
    expect(kinds.has('enemy')).toBe(true)
    expect(kinds.size).toBeGreaterThan(2)
  })
})

describe('apps/web/src/components/BrowseTable.tsx — the Farmable now chip', () => {
  it('still finds most prime parts reachable only through a vaulted relic', () => {
    // The chip earns its place only while this is true of the majority: it is the difference
    // between "where is it from" and "what can I farm tonight".
    const relicReached = new Set<string>()
    const liveRelicReached = new Set<string>()
    const directReached = new Set<string>()
    for (const edge of edges) {
      if (!edge.sourceId.startsWith('relic:')) {
        directReached.add(edge.itemId)
        continue
      }
      relicReached.add(edge.itemId)
      // The relic source and its item twin are the same object under two ids, and only the
      // item carries the vaulted flag (DESIGN.md § 10.5).
      const twin = `${edge.sourceId.slice('relic:'.length)}-relic`
      if (itemsById.get(twin)?.vaulted !== true) liveRelicReached.add(edge.itemId)
    }

    const primeParts = items.filter(
      (item) =>
        / Prime\b/.test(item.name) &&
        (item.category === 'Component' || item.category === 'Blueprint'),
    )
    const vaultedOnly = primeParts.filter(
      (item) =>
        relicReached.has(item.id) &&
        !liveRelicReached.has(item.id) &&
        !directReached.has(item.id),
    )

    expect(primeParts.length).toBeGreaterThan(400)
    expect(vaultedOnly.length / primeParts.length).toBeGreaterThan(0.6)
  })
})

describe('packages/core/src/types.ts — why marketSlug is independent of tradable', () => {
  it('still finds hundreds of items the tradable flag denies but the market sells', () => {
    // The comment's point: warframe.market's own catalogue is the authority on what is traded
    // and ours is not. One or two would be noise; hundreds is a rule.
    const sold = items.filter((item) => !item.tradable && item.marketSlug !== undefined)
    expect(sold.length).toBeGreaterThan(300)
  })
})

describe('apps/web/src/lib/client/dataset.ts — why rivens ship as their own chunk', () => {
  it('still finds most riven weapons absent from the drop catalogue', () => {
    const weapons = rivens.flatMap((family) => family.weapons)
    const orphaned = weapons.filter((weapon) => weapon.itemId === undefined)
    expect(weapons.length).toBeGreaterThan(500)
    expect(orphaned.length / weapons.length).toBeGreaterThan(0.5)
  })
})
