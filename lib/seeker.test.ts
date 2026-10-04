import { describe, it, expect, afterEach } from 'vitest'
import { isSeekerDevice, isSeekerModel, seekerForced, SEEKER_MODEL } from '@/lib/seeker'

describe('lib/seeker', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_FORCE_SEEKER
  })

  describe('isSeekerModel', () => {
    it('matches the Seeker model name exactly', () => {
      expect(isSeekerModel('Seeker', false)).toBe(true)
      expect(isSeekerModel('Pixel 7', false)).toBe(false)
      expect(isSeekerModel('seeker', false)).toBe(false)
      expect(isSeekerModel(undefined, false)).toBe(false)
      expect(isSeekerModel('', false)).toBe(false)
    })

    it('lets the override claim any device', () => {
      expect(isSeekerModel('Pixel 7', true)).toBe(true)
      expect(isSeekerModel(undefined, true)).toBe(true)
    })
  })

  describe('seekerForced', () => {
    it('is off unless EXPO_PUBLIC_FORCE_SEEKER=true', () => {
      expect(seekerForced()).toBe(false)
      process.env.EXPO_PUBLIC_FORCE_SEEKER = 'yes'
      expect(seekerForced()).toBe(false)
      process.env.EXPO_PUBLIC_FORCE_SEEKER = 'true'
      expect(seekerForced()).toBe(true)
    })
  })

  describe('isSeekerDevice', () => {
    it('reports the running device, honouring the override', () => {
      // The test host is an Android-shaped platform whose model is not a Seeker.
      expect(isSeekerDevice()).toBe(false)
      process.env.EXPO_PUBLIC_FORCE_SEEKER = 'true'
      expect(isSeekerDevice()).toBe(true)
    })
  })

  it('pins the model string the docs specify', () => {
    expect(SEEKER_MODEL).toBe('Seeker')
  })
})
