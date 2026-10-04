/**
 * features/profile/types.test.ts — Wizard model unit tests
 *
 * The validators, initials helper and banner-progress derivation are pure,
 * so they carry the logic guarantees the UI depends on: a name is required,
 * a deferred step counts as handled, and completion is derived (never a
 * stored flag) so the Profile banner cannot lie.
 */

import { describe, expect, it } from 'vitest'
import { initialsOf, setupProgress, validateProfile, type DeferredFlags, type SetupSignals } from './types'

const NO_DEFERRALS: DeferredFlags = { wallet: false, farm: false, access: false, lock: false }

function signals(overrides: Partial<SetupSignals> = {}): SetupSignals {
  return {
    profileSaved: false,
    walletConnected: false,
    farmRegistered: false,
    accessGranted: false,
    deferred: NO_DEFERRALS,
    ...overrides,
  }
}

describe('validateProfile', () => {
  it('requires a display name', () => {
    const errors = validateProfile({ name: '   ', bio: '', photoUri: null })
    expect(errors?.name).toBe('Name is required')
  })

  it('enforces the name and bio length caps', () => {
    expect(validateProfile({ name: 'x'.repeat(41), bio: '', photoUri: null })?.name).toBe(
      'Name must be 40 characters or fewer',
    )
    expect(validateProfile({ name: 'Amina', bio: 'x'.repeat(161), photoUri: null })?.bio).toBe(
      'Bio must be 160 characters or fewer',
    )
  })

  it('accepts a trimmed name with an optional bio', () => {
    expect(validateProfile({ name: '  Amina Otieno  ', bio: 'Cassava grower', photoUri: null })).toBeNull()
  })
})

describe('initialsOf', () => {
  it('takes the first letter of up to two words', () => {
    expect(initialsOf('Mae Hollenbeck')).toBe('MH')
    expect(initialsOf('  amina  otieno  ')).toBe('AO')
    expect(initialsOf('Amina')).toBe('A')
  })

  it('returns empty for empty input', () => {
    expect(initialsOf('')).toBe('')
    expect(initialsOf('   ')).toBe('')
  })
})

describe('setupProgress', () => {
  it('starts at 0 of 4 and is not complete', () => {
    const progress = setupProgress(signals())
    expect(progress.done).toBe(0)
    expect(progress.total).toBe(4)
    expect(progress.complete).toBe(false)
    expect(progress.items.map((item) => item.key)).toEqual(['profile', 'wallet', 'farm', 'access'])
  })

  it('counts live signals', () => {
    const progress = setupProgress(
      signals({ profileSaved: true, walletConnected: true, farmRegistered: true, accessGranted: true }),
    )
    expect(progress.done).toBe(4)
    expect(progress.complete).toBe(true)
  })

  it('treats a deferred step as handled', () => {
    const progress = setupProgress(
      signals({ profileSaved: true, deferred: { ...NO_DEFERRALS, wallet: true, farm: true, access: true } }),
    )
    expect(progress.done).toBe(4)
    expect(progress.complete).toBe(true)
  })

  it('ignores the lock deferral — app-lock is not a banner signal', () => {
    const progress = setupProgress(signals({ deferred: { ...NO_DEFERRALS, lock: true } }))
    expect(progress.done).toBe(0)
    expect(progress.complete).toBe(false)
  })
})
