import { describe, it, expect } from 'vitest'
import { toE6, fromE6, formatTimestamp, shortenAddress, usdcToLamports, lamportsToUsdc, formatUsdc } from '@/lib/format'

describe('lib/format', () => {
  describe('toE6 / fromE6', () => {
    it('converts a positive decimal to integer × 1_000_000', () => {
      expect(toE6(34.052)).toBe(34_052_000)
    })

    it('converts a negative decimal', () => {
      expect(toE6(-118.243)).toBe(-118_243_000)
    })

    it('rounds correctly', () => {
      expect(toE6(1.0000005)).toBe(1_000_001)
    })

    it('round-trips within floating-point precision', () => {
      const original = 51.5074
      expect(fromE6(toE6(original))).toBeCloseTo(original, 4)
    })
  })

  describe('shortenAddress', () => {
    const address = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'

    it('keeps 4 leading and 4 trailing characters by default', () => {
      expect(shortenAddress(address)).toBe('GVen…U5Ht')
    })

    it('honors a custom head length', () => {
      expect(shortenAddress(address, 8)).toBe('GVenujqg…U5Ht')
    })

    it('returns short addresses unchanged', () => {
      expect(shortenAddress('abc')).toBe('abc')
    })
  })

  describe('USDC conversions', () => {
    it('converts whole USDC to lamports', () => {
      expect(usdcToLamports(500)).toBe(500_000_000)
    })

    it('rounds fractional USDC', () => {
      expect(usdcToLamports(0.1234567)).toBe(123_457)
    })

    it('converts lamports back to USDC', () => {
      expect(lamportsToUsdc(1_000_000)).toBe(1)
    })

    it('formats a lamport amount as dollars', () => {
      expect(formatUsdc(1_234_500)).toBe('$1.23')
    })
  })

  describe('formatTimestamp', () => {
    it('returns a non-empty string containing the year', () => {
      const result = formatTimestamp(1_700_000_000)
      expect(typeof result).toBe('string')
      expect(result).toMatch(/2023/)
    })
  })
})
