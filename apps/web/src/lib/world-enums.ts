/**
 * Digital Extremes' internal vocabulary, translated.
 *
 * The live world state is DE's own payload rather than a parsed mirror, so everything in it
 * is an internal token: `VoidT3`, `MT_VOID_CASCADE`, `FC_GRINEER`, `SORTIE_BOSS_PHORID`.
 * These maps are the whole cost of reading the raw feed instead of somebody else's summary,
 * and they are worth it — the parsed mirror this replaced went dark for six hours.
 *
 * Every lookup falls back to a readable form of the token rather than to "Unknown", so a
 * value DE adds tomorrow shows up as itself instead of vanishing.
 */

/** Relic tier. VoidT6 is Omnia, which fits any relic. */
const TIERS: Record<string, string> = {
  VoidT1: 'Lith',
  VoidT2: 'Meso',
  VoidT3: 'Neo',
  VoidT4: 'Axi',
  VoidT5: 'Requiem',
  VoidT6: 'Omnia',
}

const FACTIONS: Record<string, string> = {
  FC_GRINEER: 'Grineer',
  FC_CORPUS: 'Corpus',
  FC_INFESTATION: 'Infested',
  FC_OROKIN: 'Corrupted',
  FC_SENTIENT: 'Sentient',
  FC_NARMER: 'Narmer',
  FC_CRIMSON: 'Scaldra',
  FC_MITW: 'The Murmur',
}

const MISSION_TYPES: Record<string, string> = {
  MT_ASSASSINATION: 'Assassination',
  MT_CAPTURE: 'Capture',
  MT_DEFENSE: 'Defense',
  MT_EXCAVATE: 'Excavation',
  MT_EXTERMINATION: 'Exterminate',
  MT_INTEL: 'Spy',
  MT_MOBILE_DEFENSE: 'Mobile Defense',
  MT_RESCUE: 'Rescue',
  MT_SABOTAGE: 'Sabotage',
  MT_SURVIVAL: 'Survival',
  MT_TERRITORY: 'Interception',
  MT_HIVE: 'Hive',
  MT_ARTIFACT: 'Disruption',
  MT_ALCHEMY: 'Alchemy',
  MT_VOID_CASCADE: 'Void Cascade',
  MT_VOID_FLOOD: 'Void Flood',
  MT_CORRUPTION: 'Void Armageddon',
  MT_ARENA: 'Arena',
  MT_PURSUIT: 'Pursuit',
  MT_RUSH: 'Rush',
  MT_JUNCTION: 'Junction',
  MT_LANDSCAPE: 'Free Roam',
  MT_RAILJACK: 'Railjack',
  MT_ASSAULT: 'Assault',
  MT_DEFAULT: 'Mission',
}

/**
 * Turn SCREAMING_SNAKE into words when a token is not in a map.
 *
 * Better than "Unknown": the reader still learns something, and a value DE introduces next
 * week appears as "Void Something" rather than disappearing from the page.
 */
function humanize(token: string): string {
  return token
    .replace(/^(MT|FC|SORTIE_BOSS|SORTIE_MODIFIER)_/, '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function relicTierOf(modifier: string | undefined): string | undefined {
  if (modifier === undefined) return undefined
  return TIERS[modifier] ?? modifier
}

export function factionOf(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  return FACTIONS[token] ?? humanize(token)
}

export function missionTypeOf(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  return MISSION_TYPES[token] ?? humanize(token)
}

/** "SORTIE_BOSS_PHORID" -> "Phorid". Bosses are many and change; the pattern is stable. */
export function bossOf(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  return humanize(token)
}

/** "SORTIE_MODIFIER_HAZARD_ICE" -> "Hazard Ice". */
export function modifierOf(token: string | undefined): string | undefined {
  if (token === undefined) return undefined
  return humanize(token)
}
