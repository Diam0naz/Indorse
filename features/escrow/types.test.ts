import { describe, it, expect } from 'vitest'
import { parseEscrowState, validateCreateEscrow } from '@/features/escrow/types'

describe('escrow/types', () => {
  describe('parseEscrowState', () => {
    it('passes through an already-parsed state string (idempotent)', () => {
      expect(parseEscrowState('funded')).toBe('funded')
      expect(parseEscrowState('released')).toBe('released')
      expect(parseEscrowState('cancelled')).toBe('cancelled')
    })

    it('parses raw on-chain variant objects', () => {
      expect(parseEscrowState({ funded: {} })).toBe('funded')
      expect(parseEscrowState({ released: {} })).toBe('released')
      expect(parseEscrowState({ cancelled: {} })).toBe('cancelled')
    })

    it('defaults to funded for unknown input', () => {
      expect(parseEscrowState(null)).toBe('funded')
      expect(parseEscrowState('weird')).toBe('funded')
      expect(parseEscrowState(undefined)).toBe('funded')
    })
  })

  describe('validateCreateEscrow', () => {
    const valid = { batchAddress: 'Batch1s1s1s', amountUsdc: 500, lockDurationSeconds: 3600 }

    it('returns null for valid input', () => {
      expect(validateCreateEscrow(valid)).toBeNull()
    })

    it('rejects non-positive amounts', () => {
      expect(validateCreateEscrow({ ...valid, amountUsdc: 0 })?.amountUsdc).toBeTruthy()
    })

    it('rejects lock durations under 60 seconds', () => {
      expect(validateCreateEscrow({ ...valid, lockDurationSeconds: 30 })?.lockDurationSeconds).toBeTruthy()
    })

    it('accepts a lock duration of exactly 60 seconds', () => {
      expect(validateCreateEscrow({ ...valid, lockDurationSeconds: 60 })).toBeNull()
    })
  })
})
