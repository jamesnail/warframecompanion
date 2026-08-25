import type { DropEdge, Rotation, Source } from '@provenance/core'
import { missionSourceId, parseRewardName, slug } from './slug'
import { normalizeChance, type RawNode, type RawReward } from './upstream'

export interface ParsedMissions {
  sources: Source[]
  edges: DropEdge[]
}

function toRotation(key: string): Rotation | null {
  if (key === 'A' || key === 'B' || key === 'C') return key
  return null
}

/**
 * Endless missions key their rewards by rotation; everything else ships a flat array.
 * Both shapes are normalized to (rotation, reward) pairs here so the rest of the
 * pipeline never has to branch on it again.
 */
function rewardEntries(rewards: RawNode['rewards']): Array<[Rotation | null, RawReward]> {
  if (Array.isArray(rewards)) {
    return rewards.map((reward) => [null, reward])
  }
  const out: Array<[Rotation | null, RawReward]> = []
  for (const [key, list] of Object.entries(rewards)) {
    const rotation = toRotation(key)
    for (const reward of list) out.push([rotation, reward])
  }
  return out
}

export function parseMissions(
  raw: Record<string, Record<string, RawNode>>,
): ParsedMissions {
  const sources: Source[] = []
  const edges: DropEdge[] = []

  for (const [planet, nodes] of Object.entries(raw)) {
    for (const [nodeName, node] of Object.entries(nodes)) {
      const sourceId = missionSourceId(planet, nodeName)

      sources.push({
        id: sourceId,
        kind: 'mission',
        name: nodeName,
        planet,
        missionType: node.gameMode,
      })

      for (const [rotation, reward] of rewardEntries(node.rewards)) {
        // Elite Sanctuary Onslaught pays in Radiant relics; the refinement rides on the
        // edge rather than minting a second item (see parseRewardName).
        const { name: rewardItemName, refinement, quantity } = parseRewardName(reward.itemName)
        edges.push({
          itemId: slug(rewardItemName),
          sourceId,
          chance: normalizeChance(reward.chance),
          rotation,
          // Upstream carries no separate quantity for mission rewards — the reward name
          // encodes it ("100X Plastids"), and parseRewardName has now pulled it out.
          quantity: quantity === undefined ? [1, 1] : [quantity, quantity],
          ...(refinement === undefined ? {} : { refinement }),
          provenance: 'official',
        })
      }
    }
  }

  return { sources, edges }
}
