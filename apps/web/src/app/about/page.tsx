import Link from 'next/link'
import type { Metadata } from 'next'

import { PAGE, PageHeader, Panel, PanelHeader } from '@/components/Primitives'
import { site } from '@/config/site'
import { getDataset } from '@/lib/data'

export const metadata: Metadata = {
  title: 'About the data',
  // Reads the name rather than repeating it: this line survived the 2026-08-28 rename only
  // because someone grepped for it.
  description: `Where ${site.name} gets its drop data, how it is validated, and where the numbers are estimates rather than facts.`,
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

  /**
   * Warframe recipe coverage, counted rather than asserted.
   *
   * This page used to claim recipes "exclude most non-Prime Warframes". That was true when it
   * was written and stopped being true when the Blueprint-suffix rule (hazard 17) took
   * resolved sets from 206 to 309 — and because the sentence was prose rather than a count,
   * nothing caught it. It is computed now for the same reason every other number here is.
   */
  const warframes = items.filter((item) => item.category === 'Warframe')
  const nonPrimeFrames = warframes.filter((item) => !/ Prime\b/.test(item.name))
  const nonPrimeWithRecipe = nonPrimeFrames.filter((item) => item.components !== undefined)
  const framesWithoutRecipe = nonPrimeFrames
    .filter((item) => item.components === undefined)
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b))
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

      <Section title="What you can type">
        <p>
          The search box and the <code className="text-text">/browse</code> filter take the same
          query language. Bare words match names; anything with a colon filters. Terms combine
          with AND, and a leading minus excludes — <code className="text-text">is:prime
          from:relic -is:vaulted</code> is every prime part you can farm today.
        </p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[8rem_1fr]">
          {[
            ['cat:', 'Item category — cat:warframe, cat:mod'],
            ['from:', 'Kind of source — from:relic, from:bounty'],
            ['planet:', 'Planet the source is on — planet:deimos'],
            ['tier:', 'Relic tier — tier:neo'],
            ['rotation:', 'Reward rotation — rotation:c'],
            ['mr:', 'Mastery rank — mr:<8, mr:>=14'],
            ['chance:', 'Drop chance as a percentage — chance:>5'],
            ['source:', 'Text in the source name — source:"plains of eidolon"'],
            ['price:', 'Cheapest live ask in platinum — price:<50'],
            ['is:', 'is:prime, is:vaulted, is:set, is:tradable'],
            ['has:', 'has:market — sold on warframe.market'],
          ].map(([key, hint]) => (
            <div key={key} className="contents">
              <dt className="data-num text-text">{key}</dt>
              <dd className="text-text-dim">{hint}</dd>
            </div>
          ))}
        </dl>
        <p>
          Two things it deliberately does not do. There is no <code className="text-text">or</code>
          {' '}— every term narrows. And there is no{' '}
          <code className="text-text">faction:</code>, because the drop tables carry no faction
          on any of their {sources.length.toLocaleString()} sources; the star chart knows it for
          about a fifth of the drop edges, which is not enough for a filter that would look like
          it covered everything.
        </p>
        <p>
          A query is the whole URL state, so any view you can reach is a link you can send. That
          is also why there is no &ldquo;save this filter&rdquo; button — the bookmark is the
          saved filter.
        </p>
      </Section>

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
          <strong className="text-text">Trade prices are the best live orders, not an
          average.</strong> Each priced item shows the cheapest thing anyone was asking and the
          most anyone was offering at the last build, counting only sellers who were online.
          Averaging the whole order book would be worse than useless: it is full of parked
          listings, and one Vitality offer at 99,999 platinum drags that item&rsquo;s mean from
          about 50 to over a thousand. Numbers move between builds, so the link to every open
          order on warframe.market is always there beside them.
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
          <strong className="text-text">Runs and kills are counted separately.</strong> A
          mission, a bounty or a fissure is counted in runs; an enemy is counted in kills,
          because one run of a mission can produce dozens of the enemy that drops the thing.
          Where an item drops both ways, the table names both and each row&rsquo;s own line
          says which it is.
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
          <strong className="text-text">A set is listed only when every component traces to a
          source.</strong> That covers {sets.length.toLocaleString()} items — nearly every
          Prime, and {nonPrimeWithRecipe.length} of the {nonPrimeFrames.length} non-Prime
          Warframes.
          {framesWithoutRecipe.length > 0 && (
            <>
              {' '}
              The {framesWithoutRecipe.length === 1 ? 'exception is' : 'exceptions are'}{' '}
              {formatList(framesWithoutRecipe)}, whose blueprints are not in the drop tables at
              all.
            </>
          )}{' '}
          Listing four pieces of five would read as a complete answer and would not be one, so
          an incomplete recipe is counted and withheld rather than shown.
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

/** "a, b and c" — so the sentence stays a sentence however many names the data yields. */
function formatList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
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
