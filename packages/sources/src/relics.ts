import { RelicTier, type RelicDetail, type RelicRarity, type Refinement } from '@provenance/core'
import { relicItemId, slug } from './slug'
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

/** Requiem relics do not follow the standard table — they carry an off-table 9.5% rare.
 *  Handled as an explicit special case rather than by bending the shared math
 *  (DESIGN.md § 10.4). */
const OFF_TABLE_RARE = new Set([0.095])

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

export function deriveRarity(refinement: Refinement, chance: number): RelicRarity {
  if (OFF_TABLE_RARE.has(chance)) return 'rare'

  for (const [expected, rarity] of RARITY_BY_STATE_AND_CHANCE[refinement]) {
    if (Math.abs(chance - expected) <= CHANCE_TOLERANCE) return rarity
  }

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
 * Only these four follow the 3-common / 2-uncommon / 1-rare structure that the refinement
 * table and the composed drop-chain math assume.
 *
 * Requiem and Vanguard do not: Requiem ships eight equally-weighted slots with off-table
 * odds. Rather than bend the relic math to cover them (DESIGN.md § 10.4), they are excluded
 * here and need their own model. Their reward items still reach the dataset through the
 * missions that drop them; what is missing is the relic-as-source hop.
 */
const STANDARD_TIERS = new Set(['Lith', 'Meso', 'Neo', 'Axi'])

export interface ParsedRelics {
  relics: RelicDetail[]
  /** Rows dropped because upstream gave them no name. Caller must gate on this:
   *  one is a known defect, a sudden increase is a schema change. */
  skipped: number
  /** Relics excluded for using a non-standard reward structure (Requiem, Vanguard). */
  nonStandard: number
}

export function parseRelics(raw: RawRelic[]): ParsedRelics {
  const byRelic = new Map<string, RelicDetail>()
  let skipped = 0
  let nonStandard = 0

  for (const entry of raw) {
    const refinement = parseRefinement(entry.state)
    if (refinement !== 'intact') continue

    if (entry.relicName === undefined || entry.relicName.trim() === '') {
      skipped++
      continue
    }

    if (!STANDARD_TIERS.has(entry.tier)) {
      nonStandard++
      continue
    }

    const id = relicItemId(entry.tier, entry.relicName)
    if (byRelic.has(id)) continue

    byRelic.set(id, {
      id,
      tier: parseTier(entry.tier),
      // Vaulting is derived later, from whether anything still drops this relic.
      vaulted: false,
      rewards: entry.rewards.map((reward) => ({
        itemId: slug(reward.itemName),
        rarity: deriveRarity(refinement, normalizeChance(reward.chance)),
      })),
    })
  }

  return { relics: [...byRelic.values()], skipped, nonStandard }
}
