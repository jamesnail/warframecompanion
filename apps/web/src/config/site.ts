/**
 * The single place the product name lives. The GitHub repo and the Vercel project are both
 * named "warframecompanion" for historical reasons; nothing user-facing should reference that.
 * Renaming the product means editing this file and package.json, nowhere else.
 */
export const site = {
  name: 'Provenance',
  tagline: 'Every way to get it, ranked by effort.',
  description:
    'Warframe drop-source lookup. Given an item, see every path to it — including relic chains — ranked by expected time.',
  repository: 'https://github.com/jamesnail/warframecompanion',
} as const

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
