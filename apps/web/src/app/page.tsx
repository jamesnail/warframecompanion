import { REFINEMENT_TABLE, expectedRuns, runsForConfidence, shareChance } from '@provenance/core'
import { site } from '@/config/site'

/**
 * Phase 1 holding page. The search palette replaces this in Phase 3 — the palette *is*
 * the home page (DESIGN.md § 7).
 *
 * It renders one real computation rather than lorem ipsum, so that a green deploy proves
 * the workspace link to @provenance/core actually works end to end.
 */
const RARE_RADIANT = REFINEMENT_TABLE.radiant.rare

const rows = [
  { label: 'Solo', players: 1 },
  { label: 'Squad of 2', players: 2 },
  { label: 'Squad of 3', players: 3 },
  { label: 'Squad of 4', players: 4 },
] as const

function pct(p: number): string {
  return `${(p * 100).toFixed(2)}%`
}

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-2xl font-bold tracking-tight text-orokin">{site.name}</h1>
      <p className="mt-2 text-lg text-text-dim">{site.tagline}</p>

      <section className="chamfer mt-12 border border-hairline bg-void-800 p-6">
        <h2 className="font-display text-lg font-semibold">Radiant share — rare reward</h2>
        <p className="mt-1 text-sm text-text-dim">
          One rare slot at Radiant is {pct(RARE_RADIANT)} per player. Sharing changes the
          answer more than refinement does.
        </p>

        <table className="mt-5 w-full text-sm">
          <caption className="sr-only">
            Probability of at least one rare drop by squad size, and runs required
          </caption>
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase text-text-dim">
              <th scope="col" className="py-2 font-medium">
                Squad
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Chance
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Expected runs
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                95% confident
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const p = shareChance(RARE_RADIANT, row.players)
              return (
                <tr key={row.players} className="border-b border-hairline/40">
                  <th scope="row" className="py-2 font-normal">
                    {row.label}
                  </th>
                  <td className="data-num py-2 text-right">{pct(p)}</td>
                  <td className="data-num py-2 text-right">{expectedRuns(p).toFixed(1)}</td>
                  <td className="data-num py-2 text-right">{runsForConfidence(p)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <p className="mt-8 text-sm text-text-dim">
        Scaffold only — drop data lands in Phase 2.
      </p>
    </div>
  )
}
