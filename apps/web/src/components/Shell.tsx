'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { SearchTrigger } from '@/components/CommandPalette'
import { isActive, visibleGroups, type NavItem } from '@/config/nav'
import { site } from '@/config/site'
import { useAppliedSettings } from '@/lib/client/use-settings'

/**
 * The app shell: a persistent sidebar on desktop, a top bar and drawer on small screens.
 *
 * A client component, but a thin one — it renders no page data, only the chrome around it.
 * Every page inside it is still statically prerendered; this hydrates on top. It needs to be
 * a client component at all for exactly two reasons: `usePathname` to mark the current route,
 * and the drawer's open state.
 */

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { dropsOnly } = useAppliedSettings()
  // Prerendered with the full list, so a viewer with the preference off — nearly everyone —
  // sees no change at all, and the one with it on loses a row once IndexedDB answers.
  const groups = visibleGroups(dropsOnly)

  // Route changes close the drawer. Without this, tapping a link on mobile navigates
  // underneath a drawer that stays open over the page you asked for.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Escape closes it, which is the expected exit for anything modal and is the only way
  // out for a keyboard user who opened it and does not want to tab through every link.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* ---- mobile top bar -------------------------------------------------------- */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-hairline bg-void-900/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v)
          }}
          aria-expanded={open}
          aria-controls="primary-nav"
          className="chamfer-sm border border-hairline px-2.5 py-1.5 text-text-dim transition-colors hover:border-gold-dim hover:text-text"
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <MenuIcon open={open} />
        </button>
        <Brand />
      </div>

      {/* ---- sidebar --------------------------------------------------------------- */}
      <nav
        id="primary-nav"
        aria-label="Primary"
        // Hidden rather than unmounted on mobile so the markup is identical between
        // server and client render, and so aria-controls always points at a real element.
        className={`${
          open ? 'block' : 'hidden'
        } border-b border-hairline px-4 py-5 lg:sticky lg:top-0 lg:block lg:h-dvh lg:w-60 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-5 lg:py-7`}
      >
        <div className="hidden lg:block">
          <Brand />
        </div>

        <div className="mt-0 lg:mt-8">
          {groups.map((group) => (
            <div key={group.title} className="mb-6 last:mb-0">
              <p className="label mb-2">{group.title}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={isActive(pathname, item)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 lg:hidden">
          <SearchTrigger />
        </div>
      </nav>

      {/* ---- content --------------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The palette is the fastest route to a named item, so on desktop it sits at the
            top of the content column rather than inside the nav, where it would be
            competing with the route list for the same glance. */}
        <div className="mx-auto hidden w-full max-w-5xl px-5 pt-8 sm:px-6 lg:block">
          <div className="max-w-md">
            <SearchTrigger />
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function Brand() {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-2.5 transition-colors hover:text-gold"
    >
      <span
        className="size-2.5 rotate-45 border border-gold bg-gold/20 transition-colors group-hover:bg-gold"
        aria-hidden="true"
      />
      <span className="font-display text-sm font-bold tracking-tight uppercase">{site.name}</span>
    </Link>
  )
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`hover-edge block py-1.5 pl-3 text-sm transition-colors ${
        active ? 'text-gold' : 'text-text-dim hover:bg-void-800 hover:text-text'
      }`}
    >
      {/* The active row keeps its gold edge permanently; hover-edge animates the same bar
          in for the others, so the two states are the same object at rest and in motion. */}
      {active && (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-gold" aria-hidden="true" />
      )}
      {item.name}
    </Link>
  )
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {open ? (
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  )
}
