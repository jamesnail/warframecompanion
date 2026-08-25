import { RelicTier, type RelicDetail, type RelicRarity, type Refinement } from '@provenance/core'
import { parseRewardName, relicItemId, slug } from './slug'
import { normalizeChance, type RawRelic } from './upstream'

/**
 * QUIRK — relics.json's `rarity` field is systematically wrong and must not be trusted.
 *
 * Verified across all 3086 entries on 2026-08-22: the string "Common" never appears once.
 * Every common-tier chance (25.33 / 23.33 / 20 / 16.67) is labelled "Uncommon", and the
 * Radiant rare rate of 10% is labelled "Uncommon" as well.
 *
 * So rarity is DERIVED from (state, chance), which is deterministic. Chance alone is not:
 * 20% means common at Flawless but uncommon at Radiant, so the state has to be part of
 * the key. These figures are the same ones REFINEMENT_TABLE in core validates against.
 */
const RARITY_BY_STATE_AND_CHANCE: Record<Refinement, ReadonlyArray<[number, RelicRarity]>> = {
  intact: [
    [0.2533, 'common'],
    [0.11, 'uncommon'],
    [0.02, 'rare'],
  ],
  exceptional: [
    [0.2333, 'common'],
    [0.13, 'uncommon'],
    [0.04, 'rare'],
  ],
  flawless: [
    [0.2, 'common'],
    [0.17, 'uncommon'],
    [0.06, 'rare'],
  ],
  radiant: [
    [0.1667, 'common'],
    [0.2, 'uncommon'],
    [0.1, 'rare'],
  ],
}

const CHANCE_TOLERANCE = 0.0005

/** Validates rather than casts: an unrecognised tier means DE shipped something new,
 *  which must fail the build rather than enter the dataset untyped. */
export function parseTier(tier: string): RelicDetail['tier'] {
  const parsed = RelicTier.safeParse(tier)
  if (!parsed.success) {
    throw new Error(`Unknown relic tier: ${JSON.stringify(tier)}`)
  }
  return parsed.data
}

export function parseRefinement(state: string): Refinement {
  const key = state.trim().toLowerCase()
  if (key === 'intact' || key === 'exceptional' || key === 'flawless' || key === 'radiant') {
    return key
  }
  throw new Error(`Unknown relic refinement state: ${JSON.stringify(state)}`)
}

/** The non-throwing form. Returns undefined for a chance that is not on the table. */
export function tryDeriveRarity(
  refinement: Refinement,
  chance: number,
): RelicRarity | undefined {
  for (const [expected, rarity] of RARITY_BY_STATE_AND_CHANCE[refinement]) {
    if (Math.abs(chance - expected) <= CHANCE_TOLERANCE) return rarity
  }
  return undefined
}

export function deriveRarity(refinement: Refinement, chance: number): RelicRarity {
  const rarity = tryDeriveRarity(refinement, chance)
  if (rarity !== undefined) return rarity

  throw new Error(
    `Relic chance ${String(chance)} does not match any ${refinement} rarity tier. ` +
      `DE may have changed the relic reward table — verify before shipping.`,
  )
}

/**
 * Collapse the four refinement states into one RelicDetail per relic.
 *
 * Upstream ships each relic four times, once per state, with identical reward lists and
 * differing chances. The reward set is refinement-invariant, so we read the Intact row
 * for membership and let core's REFINEMENT_TABLE supply the per-state probabilities.
 */
/**
 * Whether a relic is modelled is decided by its SHAPE, not by its tier.
 *
 * This used to be an allowlist of Lith/Meso/Neo/Axi, on the belief that Requiem and
 * Vanguard "ship eight equally-weighted slots". Checked against every row on 2026-08-25,
 * that was wrong and far too broad. All 16 Vanguard rows and all 16 Requiem I-IV rows are
 * ordinary 3-common / 2-uncommon / 1-rare tables summing to 100%. Exactly ONE row is
 * genuinely irregular: Requiem ETERNA, eight flat 9.5% slots totalling 76%.
 *
 * The cost of that guess was real — Vanguard relics hold Caliban, Mesa, Ash, Protea, Ember
 * and Volt Prime parts, so four relics' worth of prime-part sources were simply missing.
 *
 * A relic now qualifies when its Intact row derives cleanly to exactly 3/2/1. Anything else
 * is counted and reported, and the caller gates on that count so a table change by DE fails
 * the build instead of quietly emptying the dataset.
 */
const SLOTS: Record<RelicRarity, number> = { common: 3, uncommon: 2, rare: 1 }

export interface ParsedRelics {
  relics: RelicDetail[]
  /** Rows dropped because upstream gave them no name. Caller must gate on this:
   *  one is a known defect, a sudden increase is a schema change. */
  skipped: number
  /** Relics excluded for not having the 3/2/1 reward structure. */
  nonStandard: number
  /** Which ones, so the build log names them instead of just counting. */
  nonStandardNames: string[]
}

export function parseRelics(raw: RawRelic[]): ParsedRelics {
  const byRelic = new Map<string, RelicDetail>()
  let skipped = 0
  let nonStandard = 0
  const nonStandardNames: string[] = []

  for (const entry of raw) {
    const refinement = parseRefinement(entry.state)
    if (refinement !== 'intact') continue

    if (entry.relicName === undefined || entry.relicName.trim() === '') {
      skipped++
      continue
    }

    const id = relicItemId(entry.tier, entry.relicName)
    if (byRelic.has(id)) continue

    const rewards = entry.rewards.map((reward) => {
      // Parsed, not slugged: some relic rewards carry a count in the name ("2X Forma
      // Blueprint", "1200X Kuva"). Slugging those raw pointed the reward at an item id
      // that buildItems no longer mints, which the orphan gate correctly rejected — and
      // the count has to be kept, or the slot silently claims to pay one.
      const { name, quantity } = parseRewardName(reward.itemName)
      return {
        itemId: slug(name),
        rarity: tryDeriveRarity(refinement, normalizeChance(reward.chance)),
        ...(quantity === undefined ? {} : { quantity }),
      }
    })

    // Structural test, not a tier guess. Every chance must be on the table AND the slots
    // must come out 3/2/1, which is what the refinement math and the drop-chain
    // composition both assume.
    const tally: Record<RelicRarity, number> = { common: 0, uncommon: 0, rare: 0 }
    let offTable = false
    for (const reward of rewards) {
      if (reward.rarity === undefined) offTable = true
      else tally[reward.rarity]++
    }
    const standard =
      !offTable &&
      tally.common === SLOTS.common &&
      tally.uncommon === SLOTS.uncommon &&
      tally.rare === SLOTS.rare

    if (!standard) {
      nonStandard++
      nonStandardNames.push(`${entry.tier} ${entry.relicName}`)
      continue
    }

    byRelic.set(id, {
      id,
      tier: parseTier(entry.tier),
      // Vaulting is derived later, from whether anything still drops this relic.
      vaulted: false,
      rewards: rewards.map((reward) => ({
        ...reward,
        // Narrowed by the structural test above: a reward with no rarity would have made
        // `standard` false and skipped the whole relic.
        rarity: reward.rarity as RelicRarity,
      })),
    })
  }

  return { relics: [...byRelic.values()], skipped, nonStandard, nonStandardNames }
}
