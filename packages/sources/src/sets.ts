import type { Item, ItemCategory } from '@provenance/core'

import { slug } from './slug'
import type { RawWfcdComponent, RawWfcdItem } from './enrich'
import type { z } from 'zod'

/**
 * Assembled items — "Braton Prime", "Saryn Prime" — and the recipes that build them.
 *
 * The catalogue is built from drop tables, so it holds every PART and almost no assembled
 * weapon or frame: Braton Prime itself never drops, only its four pieces do. That left the
 * tool unable to answer the question players actually ask — "what do I need to farm for
 * Braton Prime" — because no page listed a full recipe. Before this, 64 of 4,566 items
 * carried components and only 5.3% of those references resolved to anything.
 *
 * Sets are emitted ONLY when every component resolves. A page that lists four of five
 * required pieces is worse than no page: it reads as a complete answer and is not. The
 * partials are counted and reported instead — see `SetResult.partial`.
 */

/** A component is a PART of its parent only when it is one of the parent's recipes. Shared
 *  build ingredients — Orokin Cell, Neurodes — sit in the same array but are their own
 *  items, and prefixing them would invent "Braton Prime Orokin Cell". Mirrors enrich.ts. */
function isPartOfParent(component: z.infer<typeof RawWfcdComponent>): boolean {
  return component.uniqueName?.includes('/Recipes/') === true
}

function stripSpriteToken(name: string): string {
  return name.replace(/^<[^>]*>\s*/, '').trim()
}

/**
 * The ids a component might be known by in the drop tables, most specific first.
 *
 * Two rules, both load-bearing:
 *
 *  - A part is named relative to its parent. WFCD nests a component called simply "Barrel"
 *    under "Braton Prime"; the drop tables say "Braton Prime Barrel". An ingredient is its
 *    own item and keeps its bare name.
 *
 *  - QUIRK — Warframe parts drop as BLUEPRINTS while weapon parts drop as the part itself.
 *    WFCD calls the component "Chassis"; the drop table says "Ash Prime Chassis Blueprint".
 *    Without the suffix fallback every one of the 77 frame sets lost three components and
 *    was discarded as partial — this single rule took fully-resolved sets from 206 to 309.
 */
export function componentIdCandidates(
  parentName: string,
  component: z.infer<typeof RawWfcdComponent>,
): string[] {
  const base = isPartOfParent(component)
    ? `${parentName} ${stripSpriteToken(component.name)}`
    : stripSpriteToken(component.name)
  return [slug(base), slug(`${base} Blueprint`)]
}

export interface SetResult {
  /** Assembled items to append to the catalogue. Every one has a complete recipe. */
  sets: Item[]
  /** Component item id -> the sets it builds into. Applied to the existing items. */
  buildsInto: Map<string, string[]>
  /** Recipes that had at least one real part but could not be completed, with what was
   *  missing. Real and expected: a non-prime frame's own blueprint is bought or quest-locked
   *  rather than dropped, so "Ash" can never resolve in full. Reported, not thrown. */
  partial: string[]
}

/**
 * Build the set catalogue.
 *
 * `has` decides whether a component id names something the drop data actually knows about,
 * which is what makes a recipe completable. Passed in rather than imported so this stays a
 * pure function over the item table it is handed.
 */
export function buildSets(
  files: ReadonlyArray<{ category: ItemCategory; rows: RawWfcdItem[] }>,
  has: (itemId: string) => boolean,
): SetResult {
  const sets: Item[] = []
  const buildsInto = new Map<string, string[]>()
  const partial: string[] = []
  const seen = new Set<string>()

  for (const { category, rows } of files) {
    for (const row of rows) {
      const components = row.components ?? []
      if (components.length === 0) continue

      const name = stripSpriteToken(row.name)
      const setId = slug(name)
      if (setId === '') continue

      // The assembled thing already drops, so it has a real page with real sources. A
      // synthesised recipe must never shadow an item the drop data knows first-hand.
      if (has(setId)) continue
      // The same name can appear in two category files; first writer wins, matching the
      // ordering contract buildEnrichmentIndex relies on.
      if (seen.has(setId)) continue

      const resolved = components.map((component) => {
        const candidates = componentIdCandidates(name, component)
        const itemId = candidates.find(has)
        return {
          part: isPartOfParent(component),
          name: component.name,
          itemId,
          count: component.itemCount ?? 1,
        }
      })

      // A recipe of nothing but shared ingredients is a crafting note, not a farm. Requiring
      // a real part is what keeps "some resource that happens to have a recipe" out.
      if (!resolved.some((entry) => entry.part)) continue

      // Collected by narrowing rather than filtered and cast: the recipe that reaches the
      // Item must be provably complete, not asserted to be.
      const complete: { itemId: string; count: number }[] = []
      const missing: string[] = []
      for (const entry of resolved) {
        if (entry.itemId === undefined) missing.push(entry.name)
        else complete.push({ itemId: entry.itemId, count: entry.count })
      }

      if (missing.length > 0) {
        partial.push(`${name}: ${missing.join(', ')}`)
        continue
      }

      seen.add(setId)
      sets.push({
        id: setId,
        name,
        category,
        tradable: row.tradable ?? false,
        ...(row.uniqueName === undefined ? {} : { uniqueName: row.uniqueName }),
        ...(row.imageName === undefined ? {} : { imageName: row.imageName }),
        ...(row.masteryReq === undefined ? {} : { masteryReq: row.masteryReq }),
        components: complete,
      })

      for (const { itemId } of complete) {
        const list = buildsInto.get(itemId)
        if (list === undefined) buildsInto.set(itemId, [setId])
        else if (!list.includes(setId)) list.push(setId)
      }
    }
  }

  return { sets, buildsInto, partial }
}

/**
 * Fold the sets into the item table, stamp the reverse links onto their components, and
 * guarantee that no item points at an id the table does not contain.
 *
 * The pruning is not defensive padding. `buildEnrichmentIndex` mints component ids from
 * WFCD's recipe nesting without checking any of them exist, which is why only 5.3% of
 * component references resolved before this: a component literally named "Blueprint" became
 * `advanced-nosam-cutter-blueprint`, an item nothing drops. Those references were already
 * being written to disk and were harmless only because nothing rendered them. They are about
 * to become links, so this is where they stop.
 *
 * Everything is sorted so the output is byte-identical between builds — the whole
 * content-addressed scheme depends on a rebuild that found nothing new producing the same hash.
 */
export function applySets(items: Item[], result: SetResult): Item[] {
  const all = [...items, ...result.sets]
  const ids = new Set(all.map((item) => item.id))

  const resolved = all.map((item) => {
    const next = { ...item }

    const components = (next.components ?? []).filter((component) => ids.has(component.itemId))
    if (next.components !== undefined) {
      if (components.length === 0) delete next.components
      else next.components = components
    }

    const targets = result.buildsInto.get(item.id) ?? next.buildsInto
    if (targets !== undefined) {
      const kept = [...new Set(targets)].filter((id) => ids.has(id)).sort((a, b) => a.localeCompare(b))
      if (kept.length === 0) delete next.buildsInto
      else next.buildsInto = kept
    }

    return next
  })

  return resolved.sort((a, b) => a.id.localeCompare(b.id))
}
