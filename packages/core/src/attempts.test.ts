import { describe, expect, it } from 'vitest'

import {
  attemptColumn,
  attemptLabel,
  attemptNoun,
  attemptNounFor,
  attemptPlural,
} from './attempts'

describe('attemptNoun', () => {
  it('an enemy is killed, everything else is run', () => {
    expect(attemptNoun('enemy')).toEqual({ one: 'kill', many: 'kills', imperative: 'Kill', column: 'Kills' })
    expect(attemptNoun('mission')).toEqual({ one: 'run', many: 'runs', imperative: 'Run', column: 'Runs' })
    expect(attemptNoun('bounty')).toEqual({ one: 'run', many: 'runs', imperative: 'Run', column: 'Runs' })
  })

  it('falls back to the run for the kinds that are still a mission underneath', () => {
    // A cache and a transient objective are both reached by queueing a mission.
    for (const kind of ['relic', 'syndicate', 'sortie', 'transient', 'cache', 'other']) {
      expect(attemptNoun(kind).many).toBe('runs')
    }
  })

  it('an unknown or missing kind is a run', () => {
    expect(attemptNoun(undefined).many).toBe('runs')
    expect(attemptNoun('archon-shard-vendor').many).toBe('runs')
  })
})

describe('attemptNounFor', () => {
  it('agrees on one noun where every kind maps to it', () => {
    expect(attemptNounFor(['mission', 'bounty', 'relic'])?.many).toBe('runs')
    expect(attemptNounFor(['enemy', 'enemy'])?.many).toBe('kills')
  })

  it('is undefined where they disagree', () => {
    expect(attemptNounFor(['enemy', 'mission'])).toBeUndefined()
  })

  it('is undefined for nothing at all — there is no noun to pick', () => {
    expect(attemptNounFor([])).toBeUndefined()
  })
})

describe('attemptColumn', () => {
  it('names the one noun where the rows agree', () => {
    expect(attemptColumn(['mission'])).toBe('Runs')
    expect(attemptColumn(['enemy'])).toBe('Kills')
  })

  it('names both where they do not', () => {
    expect(attemptColumn(['enemy', 'mission'])).toBe('Runs / kills')
  })

  it('an empty table takes the neutral heading rather than throwing', () => {
    expect(attemptColumn([])).toBe('Runs / kills')
  })
})

describe('attemptLabel', () => {
  it('composes the summary card label', () => {
    expect(attemptLabel('Expected', attemptNoun('enemy'))).toBe('Expected kills')
    expect(attemptLabel('Expected', attemptNoun('mission'))).toBe('Expected runs')
  })
})

describe('attemptPlural', () => {
  it('a guaranteed drop is one kill, not "1 kills"', () => {
    expect(attemptPlural(1, attemptNoun('enemy'))).toBe('kill')
    expect(attemptPlural(1, attemptNoun('mission'))).toBe('run')
  })

  it('anything else takes the plural', () => {
    expect(attemptPlural(0, attemptNoun('mission'))).toBe('runs')
    expect(attemptPlural(22, attemptNoun('mission'))).toBe('runs')
    expect(attemptPlural(3, attemptNoun('enemy'))).toBe('kills')
  })
})
