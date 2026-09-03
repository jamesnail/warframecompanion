import type { Citation, Insight, ResourceGuide } from '@provenance/core'

/**
 * How people actually farm things.
 *
 * ── The rule this file lives under ─────────────────────────────────────────────────
 *
 * Everything here is COMMUNITY CONSENSUS and is labelled as such wherever it renders. It is
 * not measured, it cannot be recomputed from any feed, and — this being a live-service game —
 * it goes stale. Every claim therefore carries a citation with a date, and the UI shows that
 * date rather than hiding it. A claim past `STALE_AFTER_DAYS` renders with a warning.
 *
 * Two things are deliberately NOT done here. Nothing is quoted: each `text` is written from
 * scratch to state the finding, not to reproduce the source's prose. And nothing is asserted
 * that the cited page did not actually say — where a search result and a wiki page
 * disagreed, the wiki won, and where only SEO content-farms carried a claim it was dropped.
 * Several such pages were read while assembling this and none are cited: they contradicted
 * each other on the best Plastids node and one placed the Orokin Derelict on Earth.
 *
 * ── Why the sources are what they are ──────────────────────────────────────────────
 *
 * The WARFRAME Wiki's own farming guides are preferred over everything else, for one
 * practical reason beyond editorial quality: they publish a last-edited timestamp, so the
 * staleness of a claim is checkable rather than guessed. Pages without one record the date
 * they were read, which is a weaker claim and is displayed as such.
 */

const wiki = (title: string, path: string, updated?: string): Citation => ({
  title: `${title} — WARFRAME Wiki`,
  url: `https://wiki.warframe.com/w/${path}`,
  ...(updated === undefined ? {} : { updated }),
  retrieved: '2026-09-02',
})

/**
 * Loot-boosting frames, which apply to every resource farm rather than to one.
 *
 * The oldest thing cited here by a wide margin — over a year — and kept anyway because it is
 * the one claim on the page that is structural rather than topical: these abilities have
 * worked this way for years, where a "best node" recommendation turns over every few updates.
 * The date renders regardless, and the reader can weigh it.
 */
export const SQUAD_INSIGHT: Insight = {
  text:
    'The standard resource squad pairs Khora (Pilfering Strangledome) with Nekros (Desecrate, ' +
    'usually the Despoil build) and a Nova to keep enemies arriving. For breaking containers ' +
    'rather than killing, frames that cover ground fast are preferred — Titania, Gauss, Volt, ' +
    'Xaku or Limbo. A Resource Booster and a Resource Drop Chance Booster multiply into each ' +
    'other rather than adding.',
  citation: wiki('Resource Farming Guide (user guide)', 'User:Megazawr/Resource_Farming_Guide', '2025-07-28'),
}

/**
 * Per-resource routes. Keyed by item id; validated against the item table at build time.
 *
 * Only the four resources the wiki maintains a dedicated farming guide for, plus Endo, whose
 * whole reason for being here is that its drop table is actively misleading. Resources with
 * no guide get no insight rather than an invented one.
 */
export const RESOURCE_INSIGHTS: Record<string, readonly Insight[]> = {
  'orokin-cell': [
    {
      text:
        'Two shapes of farm. Assassination is fastest per attempt: Sargas Ruk on Tethys, Saturn ' +
        'dies quickly and has a high chance to drop one, and Lephantis on Magnacidium, Deimos ' +
        'takes longer but rolls four moderate chances across the fight. For volume rather than ' +
        'speed, run a Survival and let a Nekros work — Gabii, Ceres carries a Dark Sector ' +
        'resource-drop bonus, and Titan, Saturn trades a little of that for much better affinity.',
      nodes: [
        { name: 'Tethys, Saturn' },
        { name: 'Magnacidium, Deimos' },
        { name: 'Gabii, Ceres' },
        { name: 'Titan, Saturn' },
      ],
      citation: wiki('Orokin Cell Farming Guide', 'Orokin_Cell_Farming_Guide', '2026-08-09'),
    },
  ],
  plastids: [
    {
      text:
        'Ophelia, Uranus is the usual answer, and the reason is the region pool rather than the ' +
        'node: Uranus carries no common resource besides Polymer Bundle and Plastids, so a thin ' +
        'pool concentrates every non-rare roll onto the thing you came for. Tellurium and ' +
        'Condition Overload drop in the same run. Titan, Saturn is the alternative when you want ' +
        'affinity alongside. Passively, Entrati bounties in the Cambion Drift pay a few hundred ' +
        'per run, and extractors on Saturn or Uranus cost nothing but time.',
      nodes: [{ name: 'Ophelia, Uranus' }, { name: 'Titan, Saturn' }],
      citation: wiki('Plastids Farming Guide', 'Plastids_Farming_Guide', '2026-05-29'),
    },
  ],
  'argon-crystal': [
    {
      // The decay rule is stated on the resource's own page, not on the farming guide, so it
      // is cited separately rather than being folded into the route advice below.
      text:
        'The only resource in the game that expires. A crystal is stable until the first GMT ' +
        'midnight after you pick it up; from then on, every midnight halves what you are ' +
        'holding, rounded down. Farm it against a build you have already decided on — ' +
        'stockpiling it does not work.',
      citation: wiki('Argon Crystal', 'Argon_Crystal'),
    },
    {
      text:
        'Void only. Short Captures run repeatedly are the standard route, breaking containers ' +
        'on the way through: Hepit also pays Lith relics, Ukko pays Meso and Neo. Ani or Mot ' +
        'if you would rather hold one Survival than reload a Capture.',
      nodes: [{ name: 'Hepit, Void' }, { name: 'Ukko, Void' }, { name: 'Ani, Void' }, { name: 'Mot, Void' }],
      citation: wiki('Argon Crystal Farming Guide', 'Argon_Crystal_Farming_Guide', '2026-02-16'),
    },
  ],
  tellurium: [
    {
      text:
        'Not a region resource — it replaces the usual rare drop in Archwing and submersible ' +
        'missions on any planet, which is why it feels like it comes from nowhere. In practice ' +
        'people run Ophelia, Uranus for the submersible sections, or Lu-yan in the Veil Proxima ' +
        'for Railjack. Extractors on Uranus collect it slowly with no attention at all.',
      nodes: [{ name: 'Ophelia, Uranus' }, { name: 'Lu-yan, Veil Proxima' }],
      citation: wiki('Tellurium Farming Guide', 'Tellurium_Farming_Guide', '2026-04-12'),
    },
  ],
  endo: [
    {
      text:
        'Almost nobody farms Endo from the drop table. Arbitrations are the sustained route — ' +
        'the wiki\'s own reward tables put roughly 900 on rotation A, 1,200 on B and 1,500 on C, ' +
        'paid as a lump rather than rolled for, with Vitus Essence alongside. The other half is ' +
        'Ayatan sculptures: fill them with stars and dissolve them at Maroo\'s Bazaar, where a ' +
        'fully socketed Anasa is worth thousands. Maroo also hands out one sculpture a week for ' +
        'a short mission. Dissolving duplicate mods covers the rest without any farming at all.',
      citation: wiki('Endo', 'Endo'),
    },
  ],
}

/**
 * Per-planet notes. Keyed by the planet name the SOURCE table uses.
 *
 * Short by design: a planet page's job is the resource list, and a paragraph of advice per
 * planet would be a paragraph of invention for most of them. Only places where the region
 * pool itself creates a farming consequence get one.
 */
export const PLANET_INSIGHTS: Record<string, readonly Insight[]> = {
  Uranus: [
    {
      text:
        'The thin pool is the point. Uranus carries no common resource besides Polymer Bundle ' +
        'and Plastids, so every non-rare roll concentrates onto those two — which is why Ophelia ' +
        'is the standard Plastids farm despite four other planets also carrying them.',
      nodes: [{ name: 'Ophelia, Uranus' }],
      citation: wiki('Plastids Farming Guide', 'Plastids_Farming_Guide', '2026-05-29'),
    },
  ],
  Void: [
    {
      text:
        'Argon Crystal is the only resource in the game that expires — every GMT midnight ' +
        'halves what you are holding, rounded down, from the first midnight after you pick it ' +
        'up. Farm it against a build you have already decided on. Short Captures at Hepit or ' +
        'Ukko double as relic runs.',
      nodes: [{ name: 'Hepit, Void' }, { name: 'Ukko, Void' }],
      citation: wiki('Argon Crystal', 'Argon_Crystal'),
    },
  ],
  Saturn: [
    {
      text:
        'Sargas Ruk on Tethys is the fastest single Orokin Cell in the game, and Saturn is one of ' +
        'only three regions carrying the rare at all. Titan is the Survival if you want volume ' +
        'and affinity together.',
      nodes: [{ name: 'Tethys, Saturn' }, { name: 'Titan, Saturn' }],
      citation: wiki('Orokin Cell Farming Guide', 'Orokin_Cell_Farming_Guide', '2026-08-09'),
    },
  ],
}

/** Resources where enemy-loot abilities actually change the yield. */
const SQUAD_APPLIES = new Set(['orokin-cell', 'plastids'])

/** Every citation used anywhere here, for the pipeline's date and shape checks. */
export function allCitations(): Citation[] {
  return [
    SQUAD_INSIGHT.citation,
    ...Object.values(RESOURCE_INSIGHTS).flatMap((list) => list.map((i) => i.citation)),
    ...Object.values(PLANET_INSIGHTS).flatMap((list) => list.map((i) => i.citation)),
  ]
}

export interface GuideBuild {
  guides: ResourceGuide[]
  /** Insight ids matching no item. Non-empty means the build must fail. */
  unresolved: string[]
  /** Node names an insight mentions that resolve to no source we have a page for. Not fatal —
   *  the name still renders as plain text — but reported, because a typo here is invisible. */
  unlinkedNodes: string[]
}

/**
 * Resolve every insight's named nodes against the real source table.
 *
 * A route is only useful if the reader can check it, so "Tethys, Saturn" is matched back to
 * the mission source it names and rendered as a link to that drop table. Matching is on the
 * node name and planet together, because node names repeat across planets — there is a Tethys
 * on Saturn and the name alone would be ambiguous.
 */
export function buildGuides(
  sources: readonly { id: string; name: string; kind: string; planet?: string | undefined }[],
  items: readonly { id: string }[],
): GuideBuild {
  const known = new Set(items.map((item) => item.id))
  const byNamePlanet = new Map<string, string>()
  for (const source of sources) {
    if (source.kind !== 'mission' && source.kind !== 'bounty') continue
    const key = `${source.name.toLowerCase()}|${(source.planet ?? '').toLowerCase()}`
    if (!byNamePlanet.has(key)) byNamePlanet.set(key, source.id)
  }

  const unresolved: string[] = []
  const unlinkedNodes: string[] = []
  const guides: ResourceGuide[] = []

  for (const [itemId, own] of Object.entries(RESOURCE_INSIGHTS)) {
    if (!known.has(itemId)) {
      unresolved.push(itemId)
      continue
    }
    // The squad note is appended rather than repeated in each entry above, and only where it
    // applies: Desecrate and Pilfering Strangledome multiply what enemies drop, so they help
    // a resource farm and do nothing for Endo out of an Arbitration reward screen.
    const insights = SQUAD_APPLIES.has(itemId) ? [...own, SQUAD_INSIGHT] : own
    guides.push({
      itemId,
      insights: insights.map((insight) => ({
        ...insight,
        ...(insight.nodes === undefined
          ? {}
          : {
              nodes: insight.nodes.map((node) => {
                // "Tethys, Saturn" -> name "Tethys", planet "Saturn".
                const [name, planet] = node.name.split(',').map((part) => part.trim())
                const id = byNamePlanet.get(`${(name ?? '').toLowerCase()}|${(planet ?? '').toLowerCase()}`)
                if (id === undefined) unlinkedNodes.push(node.name)
                return id === undefined ? { name: node.name } : { name: node.name, sourceId: id }
              }),
            }),
      })),
    })
  }

  guides.sort((a, b) => a.itemId.localeCompare(b.itemId))
  return { guides, unresolved, unlinkedNodes }
}
