/**
 * The browsable surfaces of the tool, and the single place their names and order live.
 *
 * Most of these are one route: /browse, pre-filtered by a search param. That is what the
 * URL-as-state rule buys — a tile is just a link, and the page it opens is a view the user
 * can then edit, bookmark or send to someone.
 *
 * The two that remain unbuilt are listed anyway, deliberately: the home page's job is to say
 * what kind of tool this is, and a menu that hides the gaps describes it wrongly. Entries
 * without an `href` render as non-interactive and marked — NOT as links to routes that would
 * 404. A dead link on a public, indexable site is a defect, and "coming soon" pages are pages
 * we would then have to keep static and crawlable for no benefit.
 *
 * To ship one: build the route, add its `href` here. Nothing else needs to change.
 */

/** Keys the home page resolves against the dataset. Counts are real or absent, never guessed. */
export type SurfaceCount =
  | 'items'
  | 'relics'
  | 'mods'
  | 'arcanes'
  | 'resources'
  | 'missions'
  | 'factions'
  | 'enemies'
  | 'bounties'
  | 'syndicates'
  | 'sorties'

export interface Surface {
  name: string
  blurb: string
  /** Absent until the route exists. */
  href?: string
  /** Absent where the dataset does not model the thing yet — a tile with no number is
   *  honest; a tile showing 0 reads as "empty" rather than "not counted". */
  count?: SurfaceCount
}

export interface SurfaceGroup {
  title: string
  surfaces: Surface[]
}

export const surfaceGroups: SurfaceGroup[] = [
  {
    title: 'By item',
    surfaces: [
      { name: 'Items', blurb: 'Everything, filterable', href: '/browse', count: 'items' },
      {
        name: 'Relics',
        blurb: 'By tier and vault status',
        href: '/browse?category=Relic',
        count: 'relics',
      },
      { name: 'Mods', blurb: 'Where each mod drops', href: '/browse?category=Mod', count: 'mods' },
      {
        name: 'Arcanes',
        blurb: 'Ranks and sources',
        href: '/browse?category=Arcane',
        count: 'arcanes',
      },
      {
        name: 'Resources',
        blurb: 'Best farm per resource',
        href: '/browse?category=Resource',
        count: 'resources',
      },
    ],
  },
  {
    title: 'By source',
    surfaces: [
      { name: 'Missions', blurb: 'Nodes by planet', href: '/source/mission', count: 'missions' },
      { name: 'Factions', blurb: 'Grineer, Corpus, Infested', count: 'factions' },
      { name: 'Enemies', blurb: 'Individual drop tables', href: '/source/enemy', count: 'enemies' },
      {
        name: 'Bounties',
        blurb: 'Open-world reward tables',
        href: '/source/bounty',
        count: 'bounties',
      },
      {
        name: 'Syndicates',
        blurb: 'Bought with standing',
        href: '/source/syndicate',
        count: 'syndicates',
      },
      {
        name: 'Sorties',
        blurb: 'Daily and weekly rotations',
        href: '/source/sortie',
        count: 'sorties',
      },
      { name: 'Vendors', blurb: 'Baro, Darvo, and the rest' },
    ],
  },
  {
    title: 'Yours',
    surfaces: [
      {
        name: 'Collection',
        blurb: 'Parts you own, sets in progress',
        href: '/collection',
      },
      { name: 'Rivens', blurb: 'Rolls, grading, dispositions' },
    ],
  },
]
