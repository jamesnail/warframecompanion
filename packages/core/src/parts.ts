import type { Item } from './types'

/**
 * Sets, their parts, and which items' drop paths count as paths to them.
 *
 * This lived in `apps/web/src/lib/query-index.ts` as `isExclusiveComponent`, which is the
 * wrong place twice over: it is a domain rule, and it was re-derived at three call sites that
 * could drift on what "a set" means. It now has one home and one definition.
 */

/**
 * True where this item is assembled from farmable pieces.
 *
 * Parts, not ingredients: 313 items carry a recipe, and the two that consist purely of
 * resources — Bronco and Gammacor, whose only non-resource line is a blueprint shared with
 * another weapon — are craftable but are not sets, because there is nothing about them to
 * farm that is not already its own item.
 */
export function isSet(item: Pick<Item, 'parts'>): boolean {
  return (item.parts?.length ?? 0) > 0
}

/**
 * The items whose drop paths ARE paths to this one, most direct first.
 *
 * An assembled set is never dropped, so every path to it runs through a part. Ingredients are
 * deliberately absent: Ash Prime needs an Orokin Cell, but "Ash Prime drops from Kela De
 * Thaym" is false, and admitting it made `from:enemy` match every prime Warframe in the game.
 */
export function pathSourceIds(item: Pick<Item, 'id' | 'parts'>): string[] {
  return [item.id, ...(item.parts ?? []).map((part) => part.itemId)]
}

/** The full recipe in build order — what you farm, then what you supply. */
export function recipeOf(item: Pick<Item, 'parts' | 'ingredients'>): {
  itemId: string
  count: number
  part: boolean
}[] {
  return [
    ...(item.parts ?? []).map((entry) => ({ ...entry, part: true })),
    ...(item.ingredients ?? []).map((entry) => ({ ...entry, part: false })),
  ]
}
