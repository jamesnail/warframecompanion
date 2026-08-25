import type { Item, ItemCategory, RelicDetail, DropEdge } from '@provenance/core'
import { parseRewardName, relicDisplayName, slug } from './slug'

/**
 * Items are derived from the names appearing in the drop data itself.
 *
 * This is deliberately provisional. The real source of item metadata is @wfcd/items
 * (categories, mastery rank, tradability, icons, unique paths) per DESIGN.md § 3 — that
 * enrichment is a follow-up. Until it lands, category is inferred from the name, which
 * is good enough to browse by but must not be presented as authoritative.
 */

const RELIC_NAME = /\b(Lith|Meso|Neo|Axi|Requiem|Vanguard)\s+\S+\s+Relic\b/i
const BLUEPRINT = /\bBlueprint\b/i
const COMPONENT =
  /\b(Barrel|Receiver|Stock|Blade|Handle|Hilt|Head|Grip|Link|Chassis|Systems|Neuroptics|Carapace|Cerebrum|Harness|Wings|String|Limb|Ornament|Disc|Boot|Gauntlet|Buckle|Guard|Band|Bracket)\b/i
const CURRENCY = /\b(Credits|Endo|Cache|Kuva|Void Traces)\b/i

function inferCategory(name: string): ItemCategory {
  if (RELIC_NAME.test(name)) return 'Relic'
  if (CURRENCY.test(name)) return 'Resource'
  if (COMPONENT.test(name)) return 'Component'
  if (BLUEPRINT.test(name)) return 'Blueprint'
  return 'Other'
}

export interface ItemSeed {
  name: string
}

/**
 * Build the item table from every name referenced by an edge or a relic reward.
 *
 * The name -> id mapping must agree exactly with how edges were slugged, otherwise the
 * pipeline emits orphaned edges and the sanity gate rejects the build. That coupling is
 * intentional: it turns a naming mistake into a failed build rather than a broken page.
 */
export function buildItems(
  edgeNames: Iterable<string>,
  relics: RelicDetail[],
  relicRewardNames: Map<string, string>,
): Item[] {
  const byId = new Map<string, Item>()

  const add = (rawName: string): void => {
    // Canonical, so "Lith A12 Relic (Radiant)" does not mint a second relic item.
    const name = parseRewardName(rawName).name
    const id = slug(name)
    if (id === '' || byId.has(id)) return
    byId.set(id, {
      id,
      name,
      category: inferCategory(name),
      // Unknown until @wfcd/items lands. Defaulting to false understates rather than
      // overstates what a player can trade.
      tradable: false,
    })
  }

  for (const name of edgeNames) add(name)
  for (const name of relicRewardNames.values()) add(name)
  for (const relic of relics) {
    const existing = byId.get(relic.id)
    if (existing === undefined) {
      byId.set(relic.id, {
        id: relic.id,
        // Derived, not the slug. A vaulted relic has no source naming it, so this fallback
        // is the ONLY name it ever gets — using relic.id here headed 729 pages
        // "axi-a1-relic" and put raw slugs in the search palette.
        name: relicDisplayName(relic.id, relic.tier),
        category: 'Relic',
        tradable: true,
        vaulted: relic.vaulted,
      })
    } else {
      // A relic that something currently drops was already added from that drop's name.
      // Stamp the derived fields on it too, so "vaulted" means the same thing for every
      // relic rather than being absent on the 64 that happen to be in rotation.
      existing.category = 'Relic'
      existing.tradable = true
      existing.vaulted = relic.vaulted
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** Relics are sources as well as items — every relic gets a Source row so that
 *  "what does this relic drop" is answerable by the same forward lookup as a mission. */
export function relicEdges(relics: RelicDetail[], intactChance: Record<string, number>): DropEdge[] {
  const edges: DropEdge[] = []
  for (const relic of relics) {
    for (const reward of relic.rewards) {
      const chance = intactChance[reward.rarity]
      if (chance === undefined) continue
      edges.push({
        itemId: reward.itemId,
        sourceId: `relic:${relic.id.replace(/-relic$/, '')}`,
        chance,
        // A relic slot that pays 2 Forma is a different offer from one that pays 1.
        quantity: reward.quantity === undefined ? [1, 1] : [reward.quantity, reward.quantity],
        provenance: 'official',
      })
    }
  }
  return edges
}
