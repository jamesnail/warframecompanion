/**
 * The primary navigation, and the single place its shape lives.
 *
 * This is deliberately shorter than `surfaces.ts`. That file is the home page's directory —
 * it lists everything, including the pre-filtered views of /browse and the surfaces that do
 * not exist yet, because the home page's job is to describe the tool honestly. Navigation
 * has the opposite job: it is used dozens of times a session and every extra row costs the
 * reader something. So this lists routes only, never a filtered view of one, and never a
 * surface that has not shipped.
 */

export interface NavItem {
  name: string
  href: string
  /** Sub-routes live under the parent, so /source/mission/lith must light up "Missions". */
  match?: string
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    title: 'Items',
    items: [
      { name: 'Browse', href: '/browse' },
      { name: 'Relics', href: '/relics' },
      { name: 'Rivens', href: '/rivens' },
    ],
  },
  {
    title: 'Sources',
    items: [
      { name: 'Missions', href: '/source/mission', match: '/source/mission' },
      { name: 'Enemies', href: '/source/enemy', match: '/source/enemy' },
      { name: 'Bounties', href: '/source/bounty', match: '/source/bounty' },
      { name: 'Syndicates', href: '/source/syndicate', match: '/source/syndicate' },
      { name: 'World state', href: '/world' },
    ],
  },
  {
    title: 'Yours',
    items: [
      // The plan comes before the inventory: the collection is what you have, this is what
      // to do about it, and the second is the reason to keep the first up to date.
      { name: 'Farm now', href: '/farm' },
      { name: 'Collection', href: '/collection' },
    ],
  },
]

/** True when `href` is the route being viewed, or an ancestor of it. */
export function isActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true
  const prefix = item.match
  return prefix !== undefined && pathname.startsWith(`${prefix}/`)
}
