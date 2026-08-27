'use client'

import { useEffect, useState } from 'react'

/**
 * Orokin decode.
 *
 * Text arrives as unreadable Orokin-ish glyphs and resolves character by character into the
 * real word, which is how the game's own interfaces introduce a readout. It is the one
 * decorative animation in the app, it plays once on mount, and it never blocks reading:
 * the final string is in the DOM from the first render, so a crawler, a screen reader and a
 * reader with `prefers-reduced-motion` all get the finished word immediately.
 *
 * The glyphs are geometric Unicode rather than a font: the Orokin alphabet is DE's art, and
 * mirroring it beyond the icons WFCD already publishes is not something this project does
 * (CLAUDE.md § Legal).
 */

const GLYPHS = '◇◆△▽◁▷○●□■◈⬡⬢⌬⏣⎔'
/** Per-character reveal step. Fast enough that the whole word settles in well under a second. */
const STEP_MS = 55

export function OrokinText({
  text,
  className = '',
  delayMs = 0,
}: {
  text: string
  className?: string
  delayMs?: number
}) {
  const [revealed, setRevealed] = useState(text.length)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    setRevealed(0)
    let index = 0
    let interval: ReturnType<typeof setInterval> | undefined

    const start = setTimeout(() => {
      interval = setInterval(() => {
        index += 1
        setRevealed(index)
        if (index >= text.length && interval !== undefined) clearInterval(interval)
      }, STEP_MS)
    }, delayMs)

    return () => {
      clearTimeout(start)
      if (interval !== undefined) clearInterval(interval)
    }
  }, [text, delayMs])

  return (
    <span className={className}>
      {/* The real text, always present and always what is announced. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {[...text].map((character, position) => (
          <span key={`${character}-${String(position)}`}>
            {position < revealed || character === ' '
              ? character
              : // Deterministic per position, so the scramble does not reshuffle on every
                // re-render and shimmer while it is meant to be settling.
                GLYPHS[(position * 7 + character.charCodeAt(0)) % GLYPHS.length]}
          </span>
        ))}
      </span>
    </span>
  )
}
