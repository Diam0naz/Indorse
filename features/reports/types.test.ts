import { describe, it, expect } from 'vitest'
import { validateSubmitReport, parseReportStatus } from '@/features/reports/types'
import { formatTimestamp } from '@/lib/format'
import type { SubmitScoutReportInput } from '@/features/reports/types'

describe('reports/types', () => {
  // ── validateSubmitReport ───────────────────────────────────────────

  describe('validateSubmitReport', () => {
    const valid: SubmitScoutReportInput = {
      farmAddress: 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht',
      photoHash: new Array(32).fill(7),
      uri: 'https://example.com/photo.jpg',
      lat: 34.052,
      lng: -118.243,
      aiLabel: 'healthy_corn',
    }

    it('returns null for valid input', () => {
      expect(validateSubmitReport(valid)).toBeNull()
    })

    it('returns an error when uri is empty', () => {
      const result = validateSubmitReport({ ...valid, uri: '' })
      expect(result?.uri).toBeTruthy()
    })

    it('returns an error when uri exceeds 128 characters', () => {
      const result = validateSubmitReport({
        ...valid,
        uri: 'https://example.com/' + 'A'.repeat(120),
      })
      expect(result?.uri).toBeTruthy()
    })

    it('accepts a uri of exactly 128 characters', () => {
      const uri = 'https://x.com/' + 'A'.repeat(114) // total = 128
      const result = validateSubmitReport({ ...valid, uri })
      expect(result).toBeNull()
    })

    it('returns an error when aiLabel is empty', () => {
      const result = validateSubmitReport({ ...valid, aiLabel: '' })
      expect(result?.aiLabel).toBeTruthy()
    })

    it('returns an error when aiLabel exceeds 32 characters', () => {
      const result = validateSubmitReport({ ...valid, aiLabel: 'A'.repeat(33) })
      expect(result?.aiLabel).toBeTruthy()
    })

    it('accepts an aiLabel of exactly 32 characters', () => {
      const result = validateSubmitReport({ ...valid, aiLabel: 'A'.repeat(32) })
      expect(result).toBeNull()
    })

    it('returns an error when photoHash is not 32 bytes', () => {
      const result = validateSubmitReport({ ...valid, photoHash: new Array(31).fill(0) })
      expect(result?.photoHash).toBeTruthy()
    })

    it('accepts a photoHash of exactly 32 bytes', () => {
      const result = validateSubmitReport({ ...valid, photoHash: new Array(32).fill(0) })
      expect(result).toBeNull()
    })

    it('returns an error for invalid latitude', () => {
      expect(validateSubmitReport({ ...valid, lat: 91 })?.lat).toBeTruthy()
      expect(validateSubmitReport({ ...valid, lat: -91 })?.lat).toBeTruthy()
    })

    it('returns an error for invalid longitude', () => {
      expect(validateSubmitReport({ ...valid, lng: 181 })?.lng).toBeTruthy()
      expect(validateSubmitReport({ ...valid, lng: -181 })?.lng).toBeTruthy()
    })

    it('can return multiple errors simultaneously', () => {
      const result = validateSubmitReport({
        ...valid,
        uri: '',
        aiLabel: '',
        photoHash: [],
      })
      expect(result?.uri).toBeTruthy()
      expect(result?.aiLabel).toBeTruthy()
      expect(result?.photoHash).toBeTruthy()
    })
  })

  // ── parseReportStatus ──────────────────────────────────────────────

  describe('parseReportStatus', () => {
    it('passes through an already-parsed status string (idempotent)', () => {
      expect(parseReportStatus('pending')).toBe('pending')
      expect(parseReportStatus('verified')).toBe('verified')
      expect(parseReportStatus('rejected')).toBe('rejected')
    })

    it('parses a pending variant object', () => {
      expect(parseReportStatus({ pending: {} })).toBe('pending')
    })

    it('parses a verified variant object', () => {
      expect(parseReportStatus({ verified: {} })).toBe('verified')
    })

    it('parses a rejected variant object', () => {
      expect(parseReportStatus({ rejected: {} })).toBe('rejected')
    })

    it('defaults to pending for unknown input', () => {
      expect(parseReportStatus(null)).toBe('pending')
      expect(parseReportStatus(undefined)).toBe('pending')
      expect(parseReportStatus('unknown')).toBe('pending')
    })
  })

  // ── formatTimestamp ────────────────────────────────────────────────

  describe('formatTimestamp', () => {
    it('returns a non-empty string', () => {
      const result = formatTimestamp(1_700_000_000)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('reflects the correct year for a known timestamp', () => {
      // 1_700_000_000 seconds is in November 2023
      const result = formatTimestamp(1_700_000_000)
      expect(result).toMatch(/2023/)
    })
  })
})
