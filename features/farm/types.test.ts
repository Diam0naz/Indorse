import { describe, it, expect } from 'vitest'
import { validateRegisterFarm, toE6, fromE6 } from '@/features/farm/types'
import type { RegisterFarmInput } from '@/features/farm/types'

describe('farm/types', () => {
  // ── toE6 / fromE6 ──────────────────────────────────────────────────

  describe('toE6', () => {
    it('converts a positive decimal to integer × 1_000_000', () => {
      expect(toE6(34.052)).toBe(34_052_000)
    })

    it('converts a negative decimal to integer × 1_000_000', () => {
      expect(toE6(-118.243)).toBe(-118_243_000)
    })

    it('handles zero', () => {
      expect(toE6(0)).toBe(0)
    })

    it('rounds correctly', () => {
      // 1.0000005 × 1_000_000 = 1_000_000.5 → rounds to 1_000_001
      expect(toE6(1.0000005)).toBe(1_000_001)
    })
  })

  describe('fromE6', () => {
    it('converts an E6 integer back to decimal', () => {
      expect(fromE6(34_052_000)).toBeCloseTo(34.052, 5)
    })

    it('converts a negative E6 integer', () => {
      expect(fromE6(-118_243_000)).toBeCloseTo(-118.243, 5)
    })

    it('round-trips with toE6 to within floating-point precision', () => {
      const original = 51.5074
      expect(fromE6(toE6(original))).toBeCloseTo(original, 4)
    })
  })

  // ── validateRegisterFarm ───────────────────────────────────────────

  describe('validateRegisterFarm', () => {
    const valid: RegisterFarmInput = {
      name: 'Green Valley Farm',
      lat: 34.052,
      lng: -118.243,
    }

    it('returns null for valid input', () => {
      expect(validateRegisterFarm(valid)).toBeNull()
    })

    it('returns an error when name is empty', () => {
      const result = validateRegisterFarm({ ...valid, name: '' })
      expect(result).not.toBeNull()
      expect(result?.name).toBeTruthy()
    })

    it('returns an error when name is whitespace only', () => {
      const result = validateRegisterFarm({ ...valid, name: '   ' })
      expect(result?.name).toBeTruthy()
    })

    it('returns an error when name exceeds 64 characters', () => {
      const result = validateRegisterFarm({ ...valid, name: 'A'.repeat(65) })
      expect(result?.name).toBeTruthy()
    })

    it('accepts a name of exactly 64 characters', () => {
      const result = validateRegisterFarm({ ...valid, name: 'A'.repeat(64) })
      expect(result).toBeNull()
    })

    it('returns an error when lat is out of range (> 90)', () => {
      const result = validateRegisterFarm({ ...valid, lat: 91 })
      expect(result?.lat).toBeTruthy()
    })

    it('returns an error when lat is out of range (< -90)', () => {
      const result = validateRegisterFarm({ ...valid, lat: -91 })
      expect(result?.lat).toBeTruthy()
    })

    it('accepts lat at boundaries (-90, 90)', () => {
      expect(validateRegisterFarm({ ...valid, lat: 90 })).toBeNull()
      expect(validateRegisterFarm({ ...valid, lat: -90 })).toBeNull()
    })

    it('returns an error when lng is out of range (> 180)', () => {
      const result = validateRegisterFarm({ ...valid, lng: 181 })
      expect(result?.lng).toBeTruthy()
    })

    it('returns an error when lng is out of range (< -180)', () => {
      const result = validateRegisterFarm({ ...valid, lng: -181 })
      expect(result?.lng).toBeTruthy()
    })

    it('accepts lng at boundaries (-180, 180)', () => {
      expect(validateRegisterFarm({ ...valid, lng: 180 })).toBeNull()
      expect(validateRegisterFarm({ ...valid, lng: -180 })).toBeNull()
    })

    it('can report multiple field errors at once', () => {
      const result = validateRegisterFarm({ name: '', lat: 200, lng: 200 })
      expect(result?.name).toBeTruthy()
      expect(result?.lat).toBeTruthy()
      expect(result?.lng).toBeTruthy()
    })

    it('accepts absent, fractional and boundary acreage', () => {
      // Optional local detail — absent must never block registration.
      expect(validateRegisterFarm({ ...valid, acres: undefined })).toBeNull()
      expect(validateRegisterFarm({ ...valid, acres: 45.5 })).toBeNull()
      expect(validateRegisterFarm({ ...valid, acres: 100_000 })).toBeNull()
    })

    it('refuses non-positive, non-finite and absurd acreage', () => {
      expect(validateRegisterFarm({ ...valid, acres: 0 })?.acres).toBe('Acres must be greater than 0')
      expect(validateRegisterFarm({ ...valid, acres: -12 })?.acres).toBe('Acres must be greater than 0')
      expect(validateRegisterFarm({ ...valid, acres: Number.NaN })?.acres).toBe('Acres must be greater than 0')
      expect(validateRegisterFarm({ ...valid, acres: 100_001 })?.acres).toBe('Acres must be 100000 or less')
    })
  })
})
