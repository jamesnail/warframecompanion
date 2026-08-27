import Link from 'next/link'
import type { Metadata } from 'next'

import { PAGE, PageHeader, Panel, PanelHeader } from '@/components/Primitives'
import { site } from '@/config/site'
import { getDataset } from '@/lib/data'

export const metadata: Metadata = {
  title: 'About the data',
  description:
    'Where Provenance gets its drop data, how it is validated, and where the numbers are estimates rather than facts.',
  alternates: { canonical: '/about' },
}

/**
 * The methodology page (DESIGN.md § 7).
 *
 * Its job is the part most tools skip: saying plainly where the numbers come from, what has
 * been derived rather than read, and what is missing. Everything countable is read from the
 * live dataset rather than typed in, because a hand-written "4,800 items" becomes a lie on
 * the next daily build and nobody notices.
 */
export default async function AboutPage() {
  const { manifest, items, sources, edges, relics } = await getDataset()

  const sets = items.filter((item) => item.components !== undefined)
  const vaulted = relics.filter((relic) => relic.vaulted).length
  const derived = edges.filter((edge) => edge.provenance === 'derived').length
  const withRotation = edges.filter((edge) => edge.rotation != null).length

  const published = new Date(manifest.builtAt)
  const publishedLabel = published.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className={PAGE}>
      <PageHeader title="About the data" />
      <p className="mt-2 max-w-prose text-sm text-text-dim">
        {site.description}
      </p>

      <Panel className="mt-8">
        <PanelHeader title="This build" aside={manifest.hash} />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-3 py-4 sm:grid-cols-3 sm:px-5">
          <Figure label="Items" value={items.length} />
          <Figure label="Sources" value={sources.length} />
          <Figure label="Drop edges" value={edges.length} />
          <Figure label="Relics" value={relics.length} />
          <Figure label="Vaulted relics" value={vaulted} />
          <Figure label="Buildable sets" value={sets.length} />
        </dl>
        <p className="border-t border-hairline px-3 py-3 text-xs text-text-faint sm:px-5">
          Digital Extremes published these drop tables on{' '}
          <time dateTime={manifest.builtAt}>{publishedLabel}</time>. That is their timestamp,
          not ours — it does not move when our pipeline runs and finds nothing changed.
        </p>
      </Panel>

      <Section title="Where it comes from">
        <p>
          Every number here is derived from Digital Extremes&rsquo; own published drop tables,
          by way of the community mirror maintained by WFCD. Item metadata — categories,
          mastery ranks, trade status, build recipes — comes from{' '}
          <code className="text-text">@wfcd/items</code>.
        </p>
        <p>
          None of that is fetched by your browser. It is downloaded, parsed, validated and
          committed as static JSON when the site is built, so a page load talks only to this
          site. Riven prices come the same way, from Digital Extremes&rsquo; weekly trade
          statistics — there is no live market call, so the numbers are as fresh as the last
          build and no fresher.
        </p>
        <p>
          <strong className="text-text">One page is live.</strong> World state — open fissures,
          invasions, Baro — cannot be committed: a fissure expires in about an hour, so a daily
          build would publish a page that is wrong most of the time. That page alone talks to a
          third party — Digital Extremes’ own world state, mirrored by browse.wf — it says so,
          and if the connection fails the rest of the site is unaffected. Node names come from
          the Warframe wiki, which publishes the only mapping from Digital Extremes’ internal
          ids to the places players recognise.
        </p>
        <p>
          <strong className="text-text">Trade prices are a link, not a number.</strong> Items
          that warframe.market sells link straight to their page, resolved at build time
          against their own catalogue so the link always lands. Quoting a price here would
          mean a live proxy and a figure minutes out of date; their page shows every open
          order, on both sides, right now.
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          {manifest.attributions.map((attribution) => (
            <li key={attribution.url}>
              <a
                href={attribution.url}
                className="text-text-dim underline underline-offset-4 transition-colors hover:text-text"
              >
                {attribution.name}
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="How it is checked">
        <p>
          A build that produces a broken dataset must fail rather than ship. Before anything is
          written, the pipeline requires that item and drop-edge counts stay within 15% of the
          previous build, that every relic&rsquo;s rarity tiers sum to 100%, and that no drop
          edge, recipe or set backlink points at something that does not exist. Any failure
          exits without touching the committed data.
        </p>
        <p>
          The upstream files have real defects, and they are worked around rather than ignored:
          chances that arrive as malformed strings, rewards whose quantity is buried in their
          name, a relic with no name at all, and one relic whose reward table does not have the
          standard three-two-one structure. Each is handled explicitly and commented.
        </p>
      </Section>

      <Section title="Where the numbers are estimates">
        <p>
          <strong className="text-text">Drop rates are as published.</strong> They are not
          measured, and Digital Extremes rounds them. Where a reward is listed more than once
          in the same table, those chances are summed into one edge.
        </p>
        <p>
          <strong className="text-text">&ldquo;Expected runs&rdquo; is the mean, not a
          promise.</strong> It is <code className="text-text">1 / chance</code>, so a 25% drop
          reads as four runs — but roughly a third of players will still not have it after
          four. The 95% figure on item pages is the honest one to plan around.
        </p>
        <p>
          <strong className="text-text">Refinement odds are computed, not read.</strong>{' '}
          Upstream publishes only the Intact table; Exceptional, Flawless and Radiant are
          derived from the fixed rarity ladder the game uses.
        </p>
        <p>
          <strong className="text-text">Nothing is ranked by time.</strong> Tables sort by drop
          rate alone, which deliberately ignores that a Survival rotation C takes twenty
          minutes and a Capture takes ninety seconds. Comparing unlike missions by effort needs
          a duration model that is not finished, and a wrong one would be worse than none.
        </p>
        <p>
          <strong className="text-text">Vaulted status is derived.</strong> A relic is called
          vaulted when nothing currently drops it, rather than from any upstream flag —{' '}
          {vaulted.toLocaleString()} of {relics.length.toLocaleString()} relics today.
        </p>
      </Section>

      <Section title="What is missing">
        <p>
          <strong className="text-text">Build recipes are incomplete by design.</strong> A set
          is only listed when every one of its components can be traced to a source. That
          covers {sets.length.toLocaleString()} items, including nearly every Prime, but
          excludes most non-Prime Warframes: their main blueprint is bought or quest-locked
          rather than dropped, so no complete farm path exists to show. Listing four pieces of
          five would read as a complete answer and would not be one.
        </p>
        <p>
          <strong className="text-text">Sources carry no faction or level range.</strong> The
          available data covers under half of mission nodes and confuses factions with weapon
          classes for enemies, so rather than fill most of the site with guesses, the field is
          left out and the Factions view is unbuilt.
        </p>
        <p>
          <strong className="text-text">Some content is not modelled.</strong> Archon shards,
          Netracells and Deep Archimedea do not fit the relic model and are not represented as
          chains.
        </p>
        <p>
          <strong className="text-text">Rivens are listed per family.</strong> One riven mod
          fits every variant of a weapon — a Cernos riven works on the Cernos, the Cernos Prime
          and the Rakta Cernos — so the price belongs to the family while the disposition
          belongs to each weapon separately. The families are derived from which weapons
          actually have riven trades, because no source publishes the grouping directly.
        </p>
        <p>
          <strong className="text-text">Rivens cover disposition and price, not grading.</strong>{" "}
          Both of those are published facts. Judging an individual roll is not: it would mean
          comparing each stat against the range that weapon&rsquo;s disposition allows, and no
          source publishes those ranges. Riven prices are also violently skewed, so the median
          is shown rather than the mean, and any figure drawn from fewer than three trades is
          marked as such — several of the highest prices in the set come from a single sale.
        </p>
      </Section>

      <Section title="Your data">
        <p>
          Anything you mark as owned lives in this browser&rsquo;s local storage and nowhere
          else. There is no account, no server-side profile, and nothing is uploaded — the
          site has no database to put it in. Clearing site data deletes it, so{' '}
          <Link href="/collection" className="text-text underline underline-offset-4 hover:text-gold">
            export a backup
          </Link>{' '}
          if you want to keep it.
        </p>
      </Section>

      <Section title="Corrections">
        <p>
          If a number here disagrees with the game, the game is right and this is a bug worth
          reporting. The pipeline, the probability maths and every workaround described above
          are readable in the{' '}
          <a
            href={site.repository}
            className="text-text underline underline-offset-4 hover:text-gold"
          >
            source
          </a>
          .
        </p>
        <p className="text-xs text-text-faint">
          {edges.length.toLocaleString()} edges, of which {withRotation.toLocaleString()} carry
          a reward rotation and {derived.toLocaleString()} are derived rather than published.
        </p>
      </Section>

      <p className="mt-10 max-w-prose text-xs text-text-faint">
        Warframe and all game data are the property of Digital Extremes. This is an unofficial
        fan project, not affiliated with or endorsed by them.
      </p>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="data-num mt-1 text-lg text-text">{value.toLocaleString()}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-sm font-semibold text-text">{title}</h2>
      <div className="mt-2 max-w-prose space-y-3 text-sm text-text-dim">{children}</div>
    </section>
  )
}
