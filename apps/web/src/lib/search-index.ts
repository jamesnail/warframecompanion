import uFuzzy from '@leeoniya/ufuzzy'
import type { Item } from '@provenance/core'

/**
 * The search index itself — pure, no Comlink, no DOM.
 *
 * Kept separate from the worker that hosts it so the ranking can be unit-tested. A search
 * box is easy to ship broken and hard to notice: it returns *something* for most queries.
 */

export interface SearchHit {
  id: string
  name: string
  category: string
}

export interface SearchIndex {
  search(needle: string, limit?: number): SearchHit[]
  size: number
}

export function createSearchIndex(items: Item[]): SearchIndex {
  const entries: SearchHit[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
  }))
  const haystack = entries.map((entry) => entry.name)

  // Single-error mode: one insertion, substitution or transposition per term. Warframe
  // item names share long prefixes ("Braton", "Braton Prime", "Braton Vandal"), so
  // anything looser returns the whole family for any member of it.
  const fuzzy = new uFuzzy({ intraMode: 1, intraIns: 1, intraSub: 1, intraTrn: 1, intraDel: 1 })

  return {
    size: entries.length,
    search(needle: string, limit = 20): SearchHit[] {
      if (entries.length === 0 || needle.trim() === '') return []

      const [indices, info, order] = fuzzy.search(haystack, needle)
      const out: SearchHit[] = []

      // uFuzzy only returns ranked `order` when it computed match info. Without it the
      // raw index list is still correct, just unranked.
      if (info !== null && order !== null) {
        for (let i = 0; i < order.length && out.length < limit; i++) {
          const infoIndex = order[i]
          if (infoIndex === undefined) continue
          const entryIndex = info.idx[infoIndex]
          if (entryIndex === undefined) continue
          const entry = entries[entryIndex]
          if (entry !== undefined) out.push(entry)
        }
        return out
      }

      if (indices === null) return []
      for (const entryIndex of indices) {
        const entry = entries[entryIndex]
        if (entry !== undefined) out.push(entry)
        if (out.length >= limit) break
      }
      return out
    },
  }
}
