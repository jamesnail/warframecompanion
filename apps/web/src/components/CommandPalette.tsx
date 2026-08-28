'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { QUERY_EXAMPLES, activeToken, suggest } from '@provenance/core'

import { useSearch } from '@/lib/client/use-search'
import { applySuggestion } from '@/lib/query-text'

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

/**
 * A button that opens the palette. Safe to render anywhere.
 *
 * The ⌘K hint is hidden below `sm`: a phone has no ⌘ key, so on the devices that most need
 * the button the badge advertises a shortcut that cannot be pressed. The button itself is
 * the affordance there.
 */
export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={openSearch}
        // -my-2 keeps the row height while giving the tap target its 44px.
        className="-my-2 flex items-center gap-2 py-2 text-text-faint transition-colors hover:text-text"
      >
        <span>Search</span>
        <kbd className="data-num hidden border border-hairline px-1.5 py-0.5 text-xs sm:inline-block">
          ⌘K
        </kbd>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={openSearch}
      className="chamfer-sm flex w-full items-center gap-3 border border-hairline bg-void-800 px-4 py-3.5 text-left text-sm text-text-faint transition-colors hover:border-hairline-strong hover:text-text-dim"
    >
      <span className="flex-1">Search items…</span>
      <kbd className="data-num hidden border border-hairline px-1.5 py-0.5 text-xs sm:inline-block">
        ⌘K
      </kbd>
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
  const { status, results, total, search, count, errors, loadingPaths } = useSearch()
  // Caret position drives completion: which token you are in is not derivable from the
  // value alone once the query has more than one term.
  const [caret, setCaret] = useState(0)

  const token = activeToken(query, caret)
  const suggestions = token.text === '' ? [] : suggest(token.text).slice(0, 5)

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
    // Otherwise a new query inherits the old scroll offset and the highlighted first
    // row sits off-screen, with Enter navigating to something invisible.
    if (listRef.current !== null) listRef.current.scrollTop = 0
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

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // Arrow/Enter must not fire mid-IME-composition: a Japanese or Chinese user
    // selecting a candidate would otherwise navigate away on the confirming Enter.
    if (event.nativeEvent.isComposing) return
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
      // dvh, not vh: with the on-screen keyboard open, vh still reports the FULL viewport,
      // so a 10vh offset plus a 50vh list pushed the results under the keyboard on a phone.
      // dvh tracks the visible viewport, and the offset is small on mobile because there is
      // no room to spend on a decorative gap.
      className="fixed inset-0 z-50 flex items-start justify-center bg-void-950/80 px-3 pt-4 sm:px-4 sm:pt-[10vh]"
      onPointerDown={() => {
        setOpen(false)
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search items"
        className="panel flex max-h-[85dvh] w-full max-w-xl flex-col"
        // pointerdown, not click: a drag that starts inside and ends outside should not
        // dismiss the dialog. Pointer events cover touch and pen as well as mouse, so a
        // tap inside is stopped from reaching the backdrop the same way a click is.
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          onKeyUp={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0)
          }}
          onClick={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0)
          }}
          placeholder={status === 'ready' ? `Search ${String(count)} items, or filter…` : 'Search items…'}
          aria-label="Search items"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="palette-results"
          aria-activedescendant={activeId}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          // text-base is load-bearing on iOS: Safari zooms the page when a focused input is
          // under 16px, and the zoom is not undone on blur. Do not drop this to text-sm.
          className="w-full shrink-0 border-b border-hairline bg-transparent px-4 py-4 text-base text-text outline-none transition-colors focus:border-gold placeholder:text-text-faint sm:px-5"
        />

        {/* Completion, parse errors and the empty-box examples all sit between the input and
            the results, so the language is discoverable without being something to learn. */}
        {suggestions.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-hairline px-4 py-2 sm:px-5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.insert}
                type="button"
                // Mouse-down, not click: the input blurs first and the list would be gone.
                onMouseDown={(event) => {
                  event.preventDefault()
                  const next = applySuggestion(query, token.start, token.text.length, suggestion.insert)
                  onChange(next)
                  requestAnimationFrame(() => {
                    inputRef.current?.focus()
                    setCaret(next.length)
                  })
                }}
                className="chamfer-sm border border-hairline px-2 py-1 text-xs text-text-dim transition-colors hover:border-gold-dim hover:text-text"
              >
                <span className="data-num">{suggestion.label}</span>
              </button>
            ))}
          </div>
        )}

        {errors.length > 0 && (
          <ul className="shrink-0 space-y-1 border-b border-hairline px-4 py-2 text-xs text-r-legendary sm:px-5">
            {errors.map((error) => (
              <li key={`${error.kind}-${String(error.start)}`}>
                {error.message}
                {error.suggestion !== undefined && ` Did you mean ${error.suggestion}?`}
              </li>
            ))}
          </ul>
        )}

        {query.trim() === '' && status === 'ready' && (
          <div className="shrink-0 border-b border-hairline px-4 py-3 sm:px-5">
            <p className="label mb-1.5">Or filter</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {QUERY_EXAMPLES.map((example) => (
                <button
                  key={example.query}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onChange(example.query)
                    inputRef.current?.focus()
                  }}
                  className="data-num text-xs text-text-faint underline underline-offset-4 transition-colors hover:text-gold"
                  title={example.caption}
                >
                  {example.query}
                </button>
              ))}
            </div>
          </div>
        )}

        <ul
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="Search results"
          // Flexes inside the dvh-capped dialog rather than carrying its own vh cap, so the
          // list is exactly the space left over after the input. min-h-0 is required or the
          // flex item refuses to shrink below its content and scrolls the page instead.
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
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
              // mousedown only prevents the focus steal; click is what actually
              // activates, so assistive tech (which dispatches click) works too.
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={() => {
                commit(hit.id)
              }}
              className={`flex cursor-pointer items-baseline justify-between gap-4 px-4 py-3 text-sm sm:px-5 sm:py-2.5 ${
                index === active ? 'bg-void-700 text-text' : 'text-text-dim'
              }`}
            >
              <span className="truncate">{hit.name}</span>
              <span className="label shrink-0">{hit.category}</span>
            </li>
          ))}
        </ul>

        {/* Every other list in the app discloses when it is truncating; this one silently
            showed 20 of however many and looked like a complete answer. */}
        {total > results.length && (
          <p className="shrink-0 border-t border-hairline px-4 py-2.5 text-xs text-text-faint sm:px-5">
            Showing {results.length} of {total} matches. Keep typing to narrow it.
          </p>
        )}

        {/* A live region must exist BEFORE its text changes to be announced. */}
        <p role="status" aria-live="polite" className="sr-only">
          {status === 'ready' && query.trim() !== ''
            ? total > results.length
              ? `Showing ${String(results.length)} of ${String(total)} results`
              : `${String(results.length)} results`
            : ''}
        </p>
        {query.trim() !== '' && results.length === 0 && (
          <p className="shrink-0 px-4 py-4 text-sm text-text-faint sm:px-5">
            {status === 'loading'
              ? 'Loading items…'
              : status === 'failed'
                ? 'Search unavailable. Drop data failed to load.'
                : loadingPaths
                  ? // A path query needs the drop-edge chunk, which is fetched on first use.
                    'Loading drop data…'
                  : errors.length > 0
                    ? 'Nothing to search yet — fix the filter above.'
                    : 'No item matches. Check the spelling, or try a shorter term.'}
          </p>
        )}
      </div>
    </div>
  )
}
