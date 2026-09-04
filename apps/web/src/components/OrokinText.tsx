'use client'

import { useEffect, useState } from 'react'

/**
 * Orokin decode.
 *
 * Text arrives as unreadable Orokin-ish glyphs and resolves character by character into the
 * real word, which is how the game's own interfaces introduce a readout. It then holds, folds
 * back into glyphs, and decodes again — a slow idle cycle, not a shimmer.
 *
 * It never blocks reading: the final string is in the DOM from the first render, so a crawler,
 * a screen reader and a reader with `prefers-reduced-motion` all get the finished word
 * immediately, and the glyph layer is `aria-hidden` decoration on top of it. The readable
 * state is also the state the cycle spends most of its time in — the hold is longer than the
 * decode and the encode put together.
 *
 * This is the one looping animation in the app, and it is confined to the home title card,
 * where there is no data to read behind it (CLAUDE.md § Motion budget).
 *
 * The glyphs are geometric Unicode rather than a font: the Orokin alphabet is DE's art, and
 * mirroring it beyond the icons WFCD already publishes is not something this project does
 * (CLAUDE.md § Legal).
 */

const GLYPHS = '◇◆△▽◁▷○●□■◈⬡⬢⌬⏣⎔'
/** Per-character step. Fast enough that the whole word settles in well under a second. */
const STEP_MS = 55
/** How long the word stays readable before it folds back up. */
const HOLD_MS = 5200
/** How long it stays scrambled at the bottom of the cycle. A beat, not a pause. */
const SCRAMBLED_MS = 420

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
    /**
     * Read the RESOLVED preference, not the OS one.
     *
     * `data-motion` is written before first paint by the script in layout.tsx, which already
     * folds together the viewer's own setting and `prefers-reduced-motion` — and the setting
     * can say `reduced` while the OS says nothing at all. Asking `matchMedia` directly missed
     * exactly that case, so a viewer who turned motion down in Settings stopped every CSS
     * animation on the site and kept the one that loops.
     */
    if (document.documentElement.dataset.motion === 'reduced') return

    setRevealed(0)

    // One self-rescheduling timer rather than an interval per phase: the cycle has four
    // phases with different cadences, and a single handle is the only thing that has to be
    // cleared on unmount or when the text changes.
    let timer: ReturnType<typeof setTimeout>
    let index = 0
    let decoding = true

    const tick = (): void => {
      if (decoding) {
        index += 1
        setRevealed(index)
        if (index >= text.length) {
          decoding = false
          timer = setTimeout(tick, HOLD_MS)
          return
        }
      } else {
        index -= 1
        setRevealed(index)
        if (index <= 0) {
          decoding = true
          timer = setTimeout(tick, SCRAMBLED_MS)
          return
        }
      }
      timer = setTimeout(tick, STEP_MS)
    }

    timer = setTimeout(tick, delayMs)
    return () => {
      clearTimeout(timer)
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
