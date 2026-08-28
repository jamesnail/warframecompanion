'use client'

import { useRef, useState } from 'react'

import { QUERY_EXAMPLES, activeToken, suggest, type QueryError } from '@provenance/core'

import { applySuggestion } from '@/lib/query-text'

/**
 * The query box: a text input, inline parse errors, and completion for the token being typed.
 *
 * Completion is the whole mitigation for "the palette becomes a syntax to learn". You never
 * have to learn it — type a letter and the keys appear, type a colon and that key's values
 * appear — and bare words keep behaving exactly as they did, so the language is additive.
 */

const MAX_SUGGESTIONS = 6

export function QueryInput({
  value,
  onChange,
  errors,
  placeholder = 'Search or filter…',
  label,
  autoFocus = false,
  inputRef,
  onKeyDown,
}: {
  value: string
  onChange: (next: string) => void
  errors: readonly QueryError[]
  placeholder?: string
  label: string
  autoFocus?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const fallbackRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? fallbackRef
  const [caret, setCaret] = useState(0)

  const token = activeToken(value, caret)
  const suggestions = token.text === '' ? [] : suggest(token.text).slice(0, MAX_SUGGESTIONS)

  const accept = (insert: string): void => {
    const next = applySuggestion(value, token.start, token.text.length, insert)
    onChange(next)
    // Focus and caret go back to the end of what was just inserted, so completion chains:
    // pick `tier:`, then immediately pick `neo`.
    requestAnimationFrame(() => {
      const input = ref.current
      if (input === null) return
      input.focus()
      const at = token.start + insert.length + (insert.endsWith(':') ? 0 : 1)
      input.setSelectionRange(at, at)
      setCaret(at)
    })
  }

  return (
    <div>
      <label className="block">
        <span className="sr-only">{label}</span>
        <input
          ref={ref}
          type="search"
          value={value}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(event) => {
            onChange(event.target.value)
            setCaret(event.target.selectionStart ?? event.target.value.length)
          }}
          onKeyUp={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0)
          }}
          onClick={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          // text-base: iOS zooms any focused input under 16px and does not zoom back.
          className="chamfer-sm w-full border border-hairline bg-void-900 px-3 py-2.5 text-base text-text outline-none transition-colors focus:border-gold placeholder:text-text-faint sm:text-sm"
        />
      </label>

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.insert}
              type="button"
              // Mouse-down rather than click: the input blurs on click, and a blur that
              // dismisses the list before it fires makes the suggestion unclickable.
              onMouseDown={(event) => {
                event.preventDefault()
                accept(suggestion.insert)
              }}
              className="chamfer-sm border border-hairline px-2 py-1 text-xs text-text-dim transition-colors hover:border-gold-dim hover:text-text"
            >
              <span className="data-num">{suggestion.label}</span>
              <span className="ml-2 text-text-faint">{suggestion.hint}</span>
            </button>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1" role="status" aria-live="polite">
          {errors.map((error) => (
            <li key={`${error.kind}-${String(error.start)}`} className="text-xs text-r-legendary">
              {error.message}
              {error.suggestion !== undefined && (
                <>
                  {' '}
                  Did you mean <span className="data-num">{error.suggestion}</span>?
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {value === '' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-faint">
          <span className="label">Try</span>
          {QUERY_EXAMPLES.map((example) => (
            <button
              key={example.query}
              type="button"
              onClick={() => {
                onChange(example.query)
              }}
              className="data-num underline underline-offset-4 transition-colors hover:text-gold"
              title={example.caption}
            >
              {example.query}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
