'use client'

import { parseAsInteger, useQueryState } from 'nuqs'

import { formatRuns } from '@/components/DropChainTrace'
import { attemptLabel, chainNoun, chainRuns, type DropChain } from '@provenance/core'

/**
 * The squad control, and the cost figure it changes.
 *
 * Split out of the trace because this is the only part that reads a search param, and that
 * is what forces a Suspense boundary — see the note in DropChainTrace.
 *
 * Squad size is in the URL rather than component state so a radshare plan can be sent to the
 * three other people who would be running it and open showing the same numbers.
 */

/** Beyond four is not a squad. */
const SQUAD_SIZES = [1, 2, 3, 4] as const

export function ChainSquad({ chain }: { chain: DropChain }) {
  const [raw, setSquad] = useQueryState('squad', parseAsInteger.withDefault(1))
  // A hand-edited ?squad=97 must not produce a fictional number.
  const players = SQUAD_SIZES.includes(raw as (typeof SQUAD_SIZES)[number]) ? raw : 1

  const runs = chainRuns(chain, players)
  const solo = chainRuns(chain, 1)

  return (
    <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-hairline pt-4">
      <div>
        <div className="label">{attemptLabel('Expected', chainNoun(chain))}</div>
        <div className="data-num mt-1 text-lg text-gold">{formatRuns(runs)}</div>
        {players > 1 && Number.isFinite(solo) && (
          // The gap is the entire reason the control exists (DESIGN.md § 5.2): a rare at
          // Radiant is ~10 relics solo and ~2.9 in a full share.
          <div className="mt-1 text-xs text-text-faint">{formatRuns(solo)} solo</div>
        )}
      </div>

      {/* A share splits the relic hop only, so offering it on a direct drop would promise a
          speed-up that does not exist. */}
      {chain.relic !== undefined && (
        <div>
          <div className="label mb-1.5">Squad</div>
          <div className="flex gap-1.5">
            {SQUAD_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={players === size}
                onClick={() => {
                  // Back to a clean URL rather than ?squad=1.
                  void setSquad(size === 1 ? null : size)
                }}
                className={`chamfer-sm size-8 border text-xs transition-colors ${
                  players === size
                    ? 'border-gold bg-void-700 text-gold'
                    : 'border-hairline text-text-faint hover:border-gold-dim hover:text-text'
                }`}
              >
                {size}
                <span className="sr-only"> player{size === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
