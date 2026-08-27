import type { Metadata } from 'next'

import { OrokinText } from '@/components/OrokinText'
import { PAGE } from '@/components/Primitives'
import { getDataset } from '@/lib/data'
import { site } from '@/config/site'

/**
 * The home page is a title card, not a directory.
 *
 * It has been three things. First a dashboard of corpus statistics, which described the
 * dataset rather than offering a way in. Then a grid of tiles for every surface — which was
 * the right answer until the sidebar shipped and started carrying every one of those links
 * on every page. A second copy of the navigation is not a landing page; it is duplication
 * in a bigger font.
 *
 * What is left is what only this page can do: say what the thing is called, in the tool's
 * own visual language, and state the facts that change when the data does. Everything else
 * is one click away in the rail on the left.
 */
export const metadata: Metadata = { alternates: { canonical: '/' } }

export default async function HomePage() {
  const { items, relics, rivens, sources, manifest } = await getDataset()
  const built = new Date(manifest.builtAt)

  const readouts = [
    { label: 'Items', value: items.length },
    { label: 'Relics', value: relics.length },
    { label: 'Sources', value: sources.length },
    { label: 'Rivens', value: rivens.length },
  ]

  return (
    <div className={`${PAGE} flex min-h-[60vh] flex-col justify-center`}>
      <div className="animate-rise">
        <h1 className="font-display text-2xl font-bold tracking-tight text-gold sm:text-[3.25rem] sm:leading-[1.05]">
          <OrokinText text={site.name} />
        </h1>

        <p className="mt-4 max-w-md font-display text-sm text-text-dim sm:text-base">
          <OrokinText text="Every way to get it." delayMs={420} />
        </p>

        <span className="rule-gold mt-8 block max-w-md" aria-hidden="true" />

        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
          {readouts.map((readout) => (
            <div key={readout.label}>
              <dt className="label">{readout.label}</dt>
              <dd className="data-num mt-1 text-lg text-text">{readout.value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>

        <p className="label mt-10">
          Drop data published {built.toISOString().slice(0, 10)} · build {manifest.hash}
        </p>
      </div>
    </div>
  )
}
