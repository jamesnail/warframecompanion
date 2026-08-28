/**
 * The single place the product name lives. The GitHub repo and the Vercel project are both
 * named "warframecompanion" for historical reasons; nothing user-facing should reference that.
 * Renaming the product means editing this file and package.json, nowhere else.
 *
 * "Nowhere else" is load-bearing and was not quite true at the 2026-08-28 rename: /about had
 * the name typed into its metadata description. Read `site.name` rather than typing it, in
 * metadata as much as in JSX.
 *
 * Three things deliberately keep the old name and must NOT be renamed with the product:
 * the IndexedDB database and the settings mirror key (they are where viewers' data physically
 * lives — see db.ts), and `DropEdge.provenance`, which is a domain term meaning "where this
 * claim came from" and has nothing to do with the product's name.
 */
export const site = {
  name: 'Cephalon Tel',
  tagline: 'Every way to get it, ranked by effort.',
  description:
    'Warframe drop-source lookup. Given an item, see every source that drops it and every relic that contains it, ranked by drop rate.',
  repository: 'https://github.com/jamesnail/warframecompanion',

  /**
   * The canonical origin. Used for metadataBase, sitemap.xml and robots.txt, all of which
   * need absolute URLs that a relative path cannot supply.
   *
   * Hardcoded rather than read from an environment variable, deliberately: CLAUDE.md says
   * the build needs no env vars, and Vercel's own VERCEL_URL is per-deployment, so a preview
   * build would emit canonicals pointing at itself and invite search engines to index a
   * throwaway origin. If a custom domain is ever attached, change this line and nothing else
   * — which also lifts the SSO gate, since Vercel exempts custom domains from it.
   */
  url: 'https://warframecompanion-superskarmory5689595-1747s-projects.vercel.app',
} as const

/**
 * The social card, served by `app/opengraph-image.png`.
 *
 * Stated explicitly rather than left to Next's file convention, because a page that declares
 * its own `openGraph` REPLACES the parent's object rather than merging into it — every item
 * page was shipping with no og:image at all, which is precisely the page most likely to be
 * shared.
 */
export const socialImage = '/opengraph-image.png'

/**
 * Attribution is a legal requirement, not a courtesy (CLAUDE.md § Legal and attribution).
 * The pipeline also writes these into manifest.json; this list is the fallback for the
 * footer before any data has shipped.
 */
export const attributions = [
  { name: 'WFCD / warframe-drop-data', url: 'https://github.com/WFCD/warframe-drop-data' },
  { name: '@wfcd/items', url: 'https://github.com/WFCD/warframe-items' },
  { name: 'warframe.market', url: 'https://warframe.market' },
] as const
