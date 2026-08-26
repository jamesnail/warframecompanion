// Derive the site icons from assets/provenance_logo.png.
//
// The source is a 1408x768 canvas that is 95.5% transparent; the artwork occupies
// x 455-952, y 88-673. Resizing the canvas directly gives an icon that is mostly empty space,
// so everything here crops first.
//
// A row-density scan of the badge shows three bands: hexagon outline to y~185, the monogram
// from ~190 to ~430, an empty gap 431-460, then the wordmark 464-552. The favicon uses the
// MONOGRAM only — at 16px the wordmark is an unreadable smudge — while the social card uses
// the full lockup, which is the size that can carry it.
//
// The artwork is dark slate (rgb 48,64,64) on transparency, so it is composited onto a light
// plate. Left transparent it would be invisible against this site's near-black background.
//
// NOTE: sharp applies only ONE resize per pipeline — a second call replaces the first, it
// does not compose. Padding therefore has to come from extend(), which does compose. Getting
// that wrong produced icons with the mark flush to every edge.

// Run by hand after the logo changes, not in CI:
//
//   node scripts/build-icons.mjs <path-to-sharp> assets/provenance_logo.png apps/web/src/app
//
// sharp is not a declared dependency — it arrives transitively with Next — so the path is
// passed in rather than imported. The three PNGs it writes are committed, like the data
// chunks: derived output that happens to live in the repo.

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const sharp = require(process.argv[2])

const SOURCE = process.argv[3]
const OUT = process.argv[4]
mkdirSync(OUT, { recursive: true })

const PLATE = { r: 246, g: 247, b: 248, alpha: 1 }
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 }

/** Measured bounding box of every non-transparent pixel: the whole badge. */
const LOCKUP = { left: 455, top: 88, width: 498, height: 586 }

/**
 * The monogram, found by column density rather than by a bounding box.
 *
 * A plain bounding box over the monogram band also catches the hexagon outline, which passes
 * through it as two 5px slivers at the far left and right — those came out as stray fragments
 * either side of the mark. Ink-per-column separates them cleanly: the outline strokes are
 * narrow runs, the monogram is one wide one, so the widest run is the mark.
 */
async function monogramBox() {
  const { data, info } = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true })
  const { width: W, channels: C } = info
  const top = 188
  const bottom = 432
  const MIN_INK = 30

  const runs = []
  let current = null
  for (let x = LOCKUP.left; x < LOCKUP.left + LOCKUP.width; x++) {
    let ink = 0
    for (let y = top; y <= bottom; y++) if (data[(y * W + x) * C + 3] > 16) ink++
    if (ink >= MIN_INK) {
      current = current ?? { start: x, end: x }
      current.end = x
    } else if (current !== null) {
      runs.push(current)
      current = null
    }
  }
  if (current !== null) runs.push(current)

  const widest = runs.sort((a, b) => b.end - b.start - (a.end - a.start))[0]
  if (widest === undefined) throw new Error('found no monogram: the artwork changed shape')
  return { left: widest.start, top, width: widest.end - widest.start + 1, height: bottom - top + 1 }
}

const box = await monogramBox()
console.log('monogram box:', JSON.stringify(box))

/** Pad a square inner image out to `size`, splitting any odd pixel. */
function margins(inner, size) {
  const total = size - inner
  const half = Math.floor(total / 2)
  return { top: half, bottom: total - half, left: half, right: total - half }
}

for (const [name, size] of [
  ['icon.png', 512],
  ['apple-icon.png', 180],
]) {
  // 78% of the frame leaves the mark room to breathe without looking lost.
  const inner = Math.round(size * 0.78)
  await sharp(SOURCE)
    .extract(box)
    .resize(inner, inner, { fit: 'contain', background: CLEAR })
    .extend({ ...margins(inner, size), background: PLATE })
    .flatten({ background: PLATE })
    .png()
    .toFile(`${OUT}/${name}`)
  console.log('wrote', name, `${String(size)}x${String(size)} (monogram)`)
}

// Social card: the full lockup, which reads fine at this size.
const CARD = { width: 1200, height: 630 }
const inner = { width: 1040, height: 520 }
await sharp(SOURCE)
  .extract(LOCKUP)
  .resize(inner.width, inner.height, { fit: 'contain', background: CLEAR })
  .extend({
    top: (CARD.height - inner.height) / 2,
    bottom: (CARD.height - inner.height) / 2,
    left: (CARD.width - inner.width) / 2,
    right: (CARD.width - inner.width) / 2,
    background: PLATE,
  })
  .flatten({ background: PLATE })
  .png()
  .toFile(`${OUT}/opengraph-image.png`)
console.log('wrote opengraph-image.png 1200x630 (full lockup)')
