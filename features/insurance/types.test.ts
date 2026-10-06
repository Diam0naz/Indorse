/**
 * features/insurance/types.test.ts — policy creation guardrails
 *
 * Locks the fraud-facing rules: the premium can never exceed the coverage,
 * the trigger is bounded to a plausible season, the season starts in the
 * present, and consecutive seasons are spaced at least one fastest-crop
 * cycle apart (the benchmark derived from CROP_CYCLE_DAYS).
 */

import { describe, expect, it } from 'vitest'
import { CROP_CYCLE_DAYS, MIN_SEASON_GAP_DAYS, validateCreatePolicy, type CreatePolicyInput } from './types'

const NOW = Math.floor(Date.now() / 1000)
const DAY = 86_400

/** A clean submission: future season, spaced from history, sane money. */
function validInput(overrides: Partial<CreatePolicyInput> = {}): CreatePolicyInput {
  return {
    farmAddress: 'Farm111111111111111111111111111111111111111',
    policyCount: 1,
    crop: 'Maize',
    coverageUsdc: 500,
    premiumUsdc: 25,
    triggerThresholdMm: 500,
    seasonStart: NOW + 7 * DAY,
    seasonEnd: NOW + 7 * DAY + 120 * DAY,
    previousSeasonEnd: NOW - 100 * DAY,
    ...overrides,
  }
}

describe('insurance/types', () => {
  describe('season spacing benchmark', () => {
    it('is the fastest crop cycle in the table', () => {
      expect(MIN_SEASON_GAP_DAYS).toBe(Math.min(...Object.values(CROP_CYCLE_DAYS)))
    })
  })

  describe('validateCreatePolicy', () => {
    it('returns null for a valid request', () => {
      expect(validateCreatePolicy(validInput())).toBeNull()
    })

    it('requires a crop and rejects an over-long one', () => {
      expect(validateCreatePolicy(validInput({ crop: '' }))?.crop).toBe('Crop type is required')
      expect(validateCreatePolicy(validInput({ crop: 'x'.repeat(33) }))?.crop).toBe(
        'Crop must be 32 characters or fewer',
      )
    })

    it('requires positive coverage', () => {
      expect(validateCreatePolicy(validInput({ coverageUsdc: 0 }))?.coverageUsdc).toBe(
        'Coverage amount must be greater than zero',
      )
    })

    it('requires a positive premium', () => {
      expect(validateCreatePolicy(validInput({ premiumUsdc: 0 }))?.premiumUsdc).toBe(
        'Premium must be greater than zero',
      )
    })

    it('refuses a premium above the coverage — the fee rides under the tier gate', () => {
      expect(validateCreatePolicy(validInput({ coverageUsdc: 500, premiumUsdc: 600 }))?.premiumUsdc).toBe(
        'Premium must not exceed the coverage amount',
      )
      expect(validateCreatePolicy(validInput({ coverageUsdc: 500, premiumUsdc: 500 }))).toBeNull()
    })

    it('refuses a premium below 1% of the coverage — the chain does too', () => {
      expect(validateCreatePolicy(validInput({ coverageUsdc: 500, premiumUsdc: 4 }))?.premiumUsdc).toBe(
        'Premium must be at least 1% of the coverage amount',
      )
      // Exactly 1% is allowed (the same boundary the program enforces).
      expect(validateCreatePolicy(validInput({ coverageUsdc: 500, premiumUsdc: 5 }))).toBeNull()
    })

    it('requires a positive trigger and caps it at 1500mm', () => {
      expect(validateCreatePolicy(validInput({ triggerThresholdMm: 0 }))?.triggerThresholdMm).toBe(
        'Trigger threshold must be greater than zero',
      )
      // The ceiling itself is allowed; one unit over (mm × 10) is not.
      expect(validateCreatePolicy(validInput({ triggerThresholdMm: 15_000 }))).toBeNull()
      expect(validateCreatePolicy(validInput({ triggerThresholdMm: 15_001 }))?.triggerThresholdMm).toBe(
        'Trigger threshold must be 1500mm or less',
      )
    })

    it('requires season end after season start', () => {
      const start = NOW + 7 * DAY
      expect(validateCreatePolicy(validInput({ seasonStart: start, seasonEnd: start }))?.season).toBe(
        'Season end must be after season start',
      )
    })

    it('refuses a season that already started', () => {
      expect(validateCreatePolicy(validInput({ seasonStart: NOW - 2 * DAY, seasonEnd: NOW + 60 * DAY }))?.season).toBe(
        'Season start must be today or later',
      )
      // Within the one-day timezone grace, "today" still passes.
      expect(validateCreatePolicy(validInput({ seasonStart: NOW - 3600, seasonEnd: NOW + 60 * DAY }))).toBeNull()
    })

    it('spaces the next season at least one benchmark after the previous end', () => {
      const previousSeasonEnd = NOW - 10 * DAY
      const exact = previousSeasonEnd + MIN_SEASON_GAP_DAYS * DAY
      // One day short of the benchmark → refused; exactly the benchmark → clean.
      expect(validateCreatePolicy(validInput({ previousSeasonEnd, seasonStart: exact - DAY }))?.season).toBe(
        `The next season must start at least ${MIN_SEASON_GAP_DAYS} days after the previous season ends`,
      )
      expect(
        validateCreatePolicy(validInput({ previousSeasonEnd, seasonStart: exact, seasonEnd: exact + 120 * DAY })),
      ).toBeNull()
    })

    it('skips the spacing rule when the farm has no policy history', () => {
      expect(validateCreatePolicy(validInput({ previousSeasonEnd: null, seasonStart: NOW + 7 * DAY }))).toBeNull()
      expect(validateCreatePolicy(validInput({ previousSeasonEnd: undefined }))).toBeNull()
    })

    it('reports every broken money rule at once', () => {
      const found = validateCreatePolicy(
        validInput({ coverageUsdc: 100, premiumUsdc: 900, triggerThresholdMm: 99_999 }),
      )
      expect(found?.premiumUsdc).toBe('Premium must not exceed the coverage amount')
      expect(found?.triggerThresholdMm).toBe('Trigger threshold must be 1500mm or less')
    })
  })
})
