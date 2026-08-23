'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useSearch } from '@/lib/client/use-search'

/**
 * The ⌘K palette. In a later phase this becomes the home page itself (DESIGN.md § 7).
 *
 * Keyboard is the primary interface here, not a fallback: open with ⌘K or /, move with
 * arrows, commit with Enter, dismiss with Escape.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const router = useRouter()
  const { status, results, search, count } = useSearch()

  // Global shortcut. "/" is ignored while typing elsewhere, so it cannot hijack a form.
  useEffect(() => {
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
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else {
      setQuery('')
      setActive(0)
    }
  }, [open])

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
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      const hit = results[active]
      if (hit !== undefined) commit(hit.id)
    }
  }

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
        className="chamfer-sm flex w-full items-center gap-3 border border-hairline bg-void-800 px-4 py-3 text-left text-sm text-text-faint transition-colors hover:border-hairline-strong hover:text-text-dim"
      >
        <span className="flex-1">Search items…</span>
        <kbd className="data-num rounded-sm border border-hairline px-1.5 py-0.5 text-xs">⌘K</kbd>
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void-950/80 px-4 pt-[10vh]"
      onClick={() => {
        setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search items"
        className="panel w-full max-w-xl"
        onClick={(event) => {
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
          aria-controls="palette-results"
          className="w-full border-b border-hairline bg-transparent px-5 py-4 text-base text-text outline-none placeholder:text-text-faint"
        />

        <ul ref={listRef} id="palette-results" className="max-h-[50vh] overflow-y-auto">
          {results.map((hit, index) => (
            <li key={hit.id}>
              <button
                type="button"
                onMouseEnter={() => {
                  setActive(index)
                }}
                onClick={() => {
                  commit(hit.id)
                }}
                aria-current={index === active}
                className={`flex w-full items-baseline justify-between gap-4 px-5 py-2.5 text-left text-sm ${
                  index === active ? 'bg-void-700 text-text' : 'text-text-dim'
                }`}
              >
                <span className="truncate">{hit.name}</span>
                <span className="label shrink-0">{hit.category}</span>
              </button>
            </li>
          ))}
        </ul>

        {/* Status is only worth showing when it changes what the user should do. */}
        {query !== '' && results.length === 0 && (
          <p className="px-5 py-4 text-sm text-text-faint">
            {status === 'loading'
              ? 'Building index…'
              : status === 'failed'
                ? 'Search unavailable. Drop data failed to load.'
                : 'No item matches. Check the spelling, or try a shorter term.'}
          </p>
        )}
      </div>
    </div>
  )
}
