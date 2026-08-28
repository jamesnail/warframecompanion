import { z } from 'zod'

/**
 * Viewer preferences.
 *
 * Like the collection, these live in one browser and nowhere else (CLAUDE.md constraint 1),
 * and they ride along in the same export file so a backup restores the whole of what the user
 * set up rather than half of it.
 *
 * The schema is here, in core, for the same reason the domain types are: it is parsed at a
 * boundary — an imported file, a localStorage string written by an older build — and a
 * preference read from a stale format must degrade to the default rather than throw inside a
 * pre-paint script.
 */

/**
 * Themes are alternate VALUES for the same semantic tokens, never new token names, so no
 * component changes and nothing outside globals.css knows a theme exists.
 *
 * The rarity ramp deliberately does NOT vary: rarity colour is data encoding, and its
 * constant-chroma guarantee is what makes common/uncommon/rare read as one scale. A theme
 * that re-hued it would be restyling a measurement.
 */
export const Theme = z.enum(['orokin', 'corpus', 'grineer', 'contrast'])
export type Theme = z.infer<typeof Theme>

export const Density = z.enum(['comfortable', 'compact'])
export type Density = z.infer<typeof Density>

/** `system` defers to prefers-reduced-motion; `reduced` overrides it on, never off. */
export const Motion = z.enum(['system', 'reduced'])
export type Motion = z.infer<typeof Motion>

export const MAX_MASTERY_RANK = 40

export const Settings = z.object({
  theme: Theme,
  density: Density,
  motion: Motion,
  /**
   * Hide the surfaces that are about trading rather than dropping — riven prices, market
   * links, the market column.
   *
   * Deliberately NOT a filter. Filter state lives in the URL and only in the URL (constraint
   * 5); a preference that silently narrowed /browse would be a filter nobody could see, share
   * or clear. This hides chrome, and the row count never changes because of it.
   */
  dropsOnly: z.boolean(),
  /** Null means "not saying". Items above it are marked, never hidden. */
  masteryRank: z.number().int().min(0).max(MAX_MASTERY_RANK).nullable(),
  /** Expand the jargon the tool otherwise assumes: refinement, vaulting, rotations. */
  newPlayer: z.boolean(),
})
export type Settings = z.infer<typeof Settings>

export const DEFAULT_SETTINGS: Settings = {
  theme: 'orokin',
  density: 'comfortable',
  motion: 'system',
  dropsOnly: false,
  masteryRank: null,
  newPlayer: false,
}

/**
 * Read settings from anything, falling back per FIELD rather than wholesale.
 *
 * A file written by a newer build with a theme this one has never heard of must still restore
 * the density and the mastery rank. Rejecting the whole object over one unknown value would
 * throw away preferences the user can no longer recover.
 */
export function normalizeSettings(input: unknown): Settings {
  if (typeof input !== 'object' || input === null) return DEFAULT_SETTINGS
  const raw = input as Record<string, unknown>
  const one = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value)
    return parsed.success ? parsed.data : fallback
  }
  return {
    theme: one(Theme, raw.theme, DEFAULT_SETTINGS.theme),
    density: one(Density, raw.density, DEFAULT_SETTINGS.density),
    motion: one(Motion, raw.motion, DEFAULT_SETTINGS.motion),
    dropsOnly: one(z.boolean(), raw.dropsOnly, DEFAULT_SETTINGS.dropsOnly),
    masteryRank: one(
      z.number().int().min(0).max(MAX_MASTERY_RANK).nullable(),
      raw.masteryRank,
      DEFAULT_SETTINGS.masteryRank,
    ),
    newPlayer: one(z.boolean(), raw.newPlayer, DEFAULT_SETTINGS.newPlayer),
  }
}

/** True when nothing has been changed from the defaults, so the UI can say so. */
export function isDefaultSettings(settings: Settings): boolean {
  return (
    settings.theme === DEFAULT_SETTINGS.theme &&
    settings.density === DEFAULT_SETTINGS.density &&
    settings.motion === DEFAULT_SETTINGS.motion &&
    settings.dropsOnly === DEFAULT_SETTINGS.dropsOnly &&
    settings.masteryRank === DEFAULT_SETTINGS.masteryRank &&
    settings.newPlayer === DEFAULT_SETTINGS.newPlayer
  )
}

export interface ThemeInfo {
  id: Theme
  name: string
  note: string
}

/** Names players use, not palette descriptions. */
export const THEMES: readonly ThemeInfo[] = [
  { id: 'orokin', name: 'Orokin', note: 'Gold on void. The default.' },
  { id: 'corpus', name: 'Corpus', note: 'Cold blue, cyan accent.' },
  { id: 'grineer', name: 'Grineer', note: 'Iron and rust.' },
  { id: 'contrast', name: 'High contrast', note: 'Maximum legibility. No background texture.' },
]
