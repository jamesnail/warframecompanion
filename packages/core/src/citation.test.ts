import { describe, expect, it } from 'vitest'

import { STALE_AFTER_DAYS, isStale, type Citation } from './types'

const at = (iso: string): Date => new Date(`${iso}T12:00:00Z`)

const cite = (over: Partial<Citation> = {}): Citation => ({
  title: 'Orokin Cell Farming Guide — WARFRAME Wiki',
  url: 'https://wiki.warframe.com/w/Orokin_Cell_Farming_Guide',
  retrieved: '2026-09-02',
  ...over,
})

describe('isStale', () => {
  it('prefers the source own last-edited date over when we read it', () => {
    // Read today, but the page itself has not been touched in two years. Judging on
    // `retrieved` would call this fresh, which is exactly the failure the field exists to
    // prevent — anyone can re-read a dead page.
    const old = cite({ updated: '2024-01-01', retrieved: '2026-09-02' })
    expect(isStale(old, at('2026-09-02'))).toBe(true)
  })

  it('falls back to the read date where the page publishes no timestamp', () => {
    const noStamp = cite({ retrieved: '2026-09-02' })
    expect(isStale(noStamp, at('2026-09-02'))).toBe(false)
    expect(isStale(noStamp, at('2028-09-02'))).toBe(true)
  })

  it('holds the threshold exactly', () => {
    const guide = cite({ updated: '2026-01-01' })
    const dayBefore = new Date(Date.UTC(2026, 0, 1) + STALE_AFTER_DAYS * 86_400_000)
    expect(isStale(guide, dayBefore)).toBe(false)
    expect(isStale(guide, new Date(dayBefore.getTime() + 86_400_000))).toBe(true)
  })

  it('calls a fresh wiki guide fresh', () => {
    expect(isStale(cite({ updated: '2026-08-09' }), at('2026-09-02'))).toBe(false)
  })

  it('flags the one guide in the set that is over a year old', () => {
    // The user farming guide the squad advice comes from. Kept deliberately, and it is the
    // reason the UI shows a date at all.
    expect(isStale(cite({ updated: '2025-07-28' }), at('2026-09-02'))).toBe(true)
  })
})
