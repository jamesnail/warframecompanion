'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useSearch } from '@/lib/client/use-search'

/**
 * The ⌘K palette. In a later phase it becomes the home page itself (DESIGN.md § 7).
 *
 * The dialog lives in the root layout so the shortcut works on every page — previously it
 * was mounted only on the home page, so ⌘K did nothing on the ~4800 item pages, which is
 * where you most want to look something else up.
 *
 * Triggers communicate with it by a window event rather than context, so a button anywhere
 * in the tree can open it without threading state through the layout.
 */
const OPEN_EVENT = 'provenance:open-search'

export function openSearch(): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

/** A button that opens the palette. Safe to render anywhere. */
export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={openSearch}
        className="flex items-center gap-2 text-text-faint transition-colors hover:text-text"
      >
        <span>Search</span>
        <kbd className="data-num border border-hairline px-1.5 py-0.5 text-[0.65rem]">⌘K</kbd>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={openSearch}
      className="chamfer-sm flex w-full items-center gap-3 border border-hairline bg-void-800 px-4 py-3 text-left text-sm text-text-faint transition-colors hover:border-hairline-strong hover:text-text-dim"
    >
      <span className="flex-1">Search items…</span>
      <kbd className="data-num border border-hairline px-1.5 py-0.5 text-xs">⌘K</kbd>
    </button>
  )
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Whatever had focus before we stole it, so it can be given back on close.
  const restoreFocusTo = useRef<HTMLElement | null>(null)

  const router = useRouter()
  const { status, results, search, count } = useSearch()

  useEffect(() => {
    function onOpenRequest(): void {
      setOpen(true)
    }

    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true

      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault()
        setOpen((wasOpen) => !wasOpen)
      }
    }

    window.addEventListener(OPEN_EVENT, onOpenRequest)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpenRequest)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Focus in on open, focus back out on close, and lock the background while open —
  // a modal that leaves the page scrolling behind it, and drops focus to the top of the
  // document when dismissed, is a keyboard user's dead end.
  useEffect(() => {
    if (open) {
      restoreFocusTo.current = document.activeElement as HTMLElement | null
      inputRef.current?.focus()
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = previousOverflow
      }
    }

    // Clear the RESULTS too, not just the input. Leaving them meant reopening the
    // palette showed the previous query's hits under an empty box, and Enter navigated
    // to one of them.
    setQuery('')
    setActive(0)
    search('')
    restoreFocusTo.current?.focus()
    return undefined
  }, [open, search])

  useEffect(() => {
    setActive(0)
  }, [results])

  const onChange = useCallback(
    (value: string) => {
      setQuery(value)
      search(value)
    },
    [search],
  )

  const commit = useCallback(
    (id: string) => {
      setOpen(false)
      router.push(`/item/${id}`)
    },
    [router],
  )

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (results.length === 0 ? 0 : Math.min(index + 1, results.length - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      const hit = results[active]
      if (hit !== undefined) commit(hit.id)
    } else if (event.key === 'Tab') {
      // The dialog holds exactly one focusable control, so trapping is simply refusing to
      // let Tab leave it while the background is inert.
      event.preventDefault()
    }
  }

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const activeId = results[active] === undefined ? undefined : `palette-option-${results[active].id}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void-950/80 px-4 pt-[10vh]"
      onMouseDown={() => {
        setOpen(false)
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search items"
        className="panel w-full max-w-xl"
        // mousedown, not click: a drag that starts inside and ends outside should not
        // dismiss the dialog.
        onMouseDown={(event) => {
          event.stopPropagation()
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onKeyDown={onKeyDown}
          placeholder={status === 'ready' ? `Search ${String(count)} items…` : 'Search items…'}
          aria-label="Search items"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="palette-results"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          className="w-full border-b border-hairline bg-transparent px-5 py-4 text-base text-text outline-none transition-colors focus:border-orokin placeholder:text-text-faint"
        />

        <ul
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-[50vh] overflow-y-auto"
        >
          {results.map((hit, index) => (
            <li
              key={hit.id}
              id={`palette-option-${hit.id}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => {
                setActive(index)
              }}
              onMouseDown={(event) => {
                // Keep focus in the input so the dialog never loses its anchor.
                event.preventDefault()
                commit(hit.id)
              }}
              className={`flex cursor-pointer items-baseline justify-between gap-4 px-5 py-2.5 text-sm ${
                index === active ? 'bg-void-700 text-text' : 'text-text-dim'
              }`}
            >
              <span className="truncate">{hit.name}</span>
              <span className="label shrink-0">{hit.category}</span>
            </li>
          ))}
        </ul>

        {query !== '' && results.length === 0 && (
          <p className="px-5 py-4 text-sm text-text-faint">
            {status === 'loading'
              ? 'Loading items…'
              : status === 'failed'
                ? 'Search unavailable. Drop data failed to load.'
                : 'No item matches. Check the spelling, or try a shorter term.'}
          </p>
        )}
      </div>
    </div>
  )
}
