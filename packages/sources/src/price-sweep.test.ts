import { describe, expect, it } from 'vitest'

import { SWEEP_FLOOR, sweptEnough } from './price-sweep'

describe('sweptEnough', () => {
  /**
   * The gate that stops an outage looking like news.
   *
   * Publishing a sweep where half the requests failed would silently delete prices from half
   * the site, and a reader cannot tell "nobody is selling this" from "our fetch fell over".
   */
  it('accepts a sweep that mostly worked', () => {
    expect(sweptEnough({ prices: [], attempted: 1000, failed: 100 })).toBe(true)
  })

  it('rejects one that mostly did not', () => {
    expect(sweptEnough({ prices: [], attempted: 1000, failed: 500 })).toBe(false)
  })

  it('is exact at the floor', () => {
    const failed = Math.round(1000 * (1 - SWEEP_FLOOR))
    expect(sweptEnough({ prices: [], attempted: 1000, failed })).toBe(true)
    expect(sweptEnough({ prices: [], attempted: 1000, failed: failed + 1 })).toBe(false)
  })

  it('rejects a sweep that never started, rather than dividing by zero', () => {
    expect(sweptEnough({ prices: [], attempted: 0, failed: 0 })).toBe(false)
  })

  it('accepts a clean sweep that found no prices at all', () => {
    // Distinct from a failed sweep: every request succeeded and the market is simply quiet.
    // Rare in practice, but the two must not be conflated.
    expect(sweptEnough({ prices: [], attempted: 500, failed: 0 })).toBe(true)
  })
})
