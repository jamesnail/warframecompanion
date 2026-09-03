import type { AttemptNoun, FarmStrategy } from '@provenance/core'

import { Panel, PanelHeader } from '@/components/Primitives'

/**
 * What to actually do, per item type.
 *
 * The drop chain answers "which single row has the best odds", and for four of these six
 * strategies that is the wrong question. This block says the right one in the tool's voice:
 * terse, no encouragement, naming the thing players name.
 *
 * Everything here is CURATED — community consensus, not a DE publication — so it renders in
 * a panel that says so rather than sitting beside drop rates as though it were measured
 * (DESIGN.md § 16). It is copy rather than data because it varies by item TYPE, not by item:
 * ten blocks cover 4,875 items, and shipping it as a chunk would be shipping a constant.
 */

interface Guide {
  title: string
  body: string
  /** What the route table below is ranked on, stated so the ordering is never a mystery. */
  ranking: string
}

const GUIDES: Record<FarmStrategy, Guide> = {
  'relic-chain': {
    title: 'Farm the relic, then crack it',
    body:
      'This is relic-gated, so the route is two hops and the second one is a fissure. Refine ' +
      'to the level that maximises this part’s rarity — Radiant is not always right, and for ' +
      'a common reward it makes the odds worse. Crack in a squad where you can: each player ' +
      'opens their own relic and the squad takes the best reward, which is the single largest ' +
      'swing available to you.',
    ranking: 'Ranked by the odds of one drop, composed across both hops.',
  },
  resource: {
    title: 'Farm it off enemies, not off the reward screen',
    body:
      'Resources drop continuously from enemies and containers during a mission. The end-of-' +
      'mission reward tables below list some of them too, but that is one roll per run against ' +
      'hundreds of kills, so it is never the efficient route. Pick a dense endless node on a ' +
      'planet that carries this resource and stay in it; resource boosters and a Nekros or ' +
      'Khora multiply everything you pick up.',
    ranking: 'Ranked by expected units per run — quantity, not just odds.',
  },
  currency: {
    title: 'This is a currency — the drop table is not the route',
    body:
      'It appears in drop tables, and farming it that way is not what anyone does. The real ' +
      'routes are repeatable activities that pay it in bulk rather than roll for it, so the ' +
      'table below is reference, not instruction. Check what pays the most per run rather than ' +
      'what has the highest chance.',
    ranking: 'Ranked by expected units per run — quantity, not just odds.',
  },
  mod: {
    title: 'Find the source with the best odds and repeat it',
    body:
      'This drops from specific sources rather than accumulating, so one is all you need and ' +
      'the odds are the whole question. Where that source is an enemy, what matters is a ' +
      'place it spawns densely rather than the node with the highest listed rate.',
    ranking: 'Ranked by the odds of one drop per attempt.',
  },
  assembled: {
    title: 'Built, not dropped',
    body:
      'Nothing drops this whole. Farm the parts below and craft it; each has its own ' +
      'route, and the slowest one sets your timeline.',
    ranking: '',
  },
  direct: {
    title: 'Direct drop',
    body: 'One hop: run the source, take the roll.',
    ranking: 'Ranked by the odds of one drop per attempt.',
  },
}

export function FarmingGuide({
  strategy,
  noun,
}: {
  strategy: FarmStrategy
  noun: AttemptNoun | undefined
}) {
  const guide = GUIDES[strategy]
  const ranking =
    noun === undefined
      ? guide.ranking
      : guide.ranking.replace('per attempt', `per ${noun.one}`)

  return (
    <Panel className="mt-6">
      <PanelHeader title="How this is farmed" aside="community knowledge" />
      <div className="px-3 py-4 sm:px-5">
        <p className="text-sm text-text">{guide.title}</p>
        <p className="mt-2 max-w-prose text-sm text-text-dim">{guide.body}</p>
        {ranking !== '' && <p className="mt-2 text-xs text-text-faint">{ranking}</p>}
      </div>
    </Panel>
  )
}
