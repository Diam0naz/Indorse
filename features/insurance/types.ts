/**
 * Insurance feature types.
 * Mirrors the Policy and WeatherOracle on-chain accounts.
 *
 * A parametric policy pays out automatically in USDC when a weather trigger
 * fires (rainfall below threshold). The farm's scouting history serves as
 * claim evidence and can lower the premium.
 */

import { firstError, requiredString, maxStringLength, positiveNumber, errorOrNull } from '@/lib/validation'

export type PolicyState = 'active' | 'paidOut' | 'expired'

export interface Policy {
  farm: string
  farmer: string
  index: number
  crop: string
  coverageUsdc: number
  premiumUsdc: number
  /** Rainfall shortfall trigger in mm × 10 (e.g. 500 = 50mm) */
  triggerThresholdMm: number
  seasonStart: number
  seasonEnd: number
  /** Snapshot of verified scout reports at policy creation time */
  verifiedReportsAtCreation: number
  state: PolicyState
  bump: number
  address?: string
}

export interface WeatherReading {
  farm: string
  seasonStart: number
  /** Official median (mm × 10) — 0 until the quorum froze the reading */
  totalRainfallMm: number
  /** When the quorum froze the median */
  readingTimestamp: number
  /** True once the set's quorum landed — only then does this number settle */
  finalized: boolean
  /** One reading per oracle-set member, in sorted order once finalized */
  readings: { oracle: string; totalRainfallMm: number }[]
  bump: number
  address?: string
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface CreatePolicyInput {
  farmAddress: string
  /**
   * The farm's current policy count — the new policy takes this index and
   * both PDAs (`policy`, `insurance_vault`) are derived from it.
   */
  policyCount: number
  crop: string
  /** Coverage in whole USDC */
  coverageUsdc: number
  /** Premium in whole USDC */
  premiumUsdc: number
  /** Rainfall trigger in mm × 10 */
  triggerThresholdMm: number
  seasonStart: number
  seasonEnd: number
}

export interface PolicyValidationError {
  crop?: string
  coverageUsdc?: string
  premiumUsdc?: string
  triggerThresholdMm?: string
  season?: string
}

export interface RevokePolicyInput {
  farmAddress: string
  /** The farm's policy count — the current policy lives at `policyCount - 1`. */
  policyCount: number
}

export interface RevokePolicyValidationError {
  farmAddress?: string
  policyCount?: string
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateCreatePolicy(input: CreatePolicyInput): PolicyValidationError | null {
  const errors: PolicyValidationError = {
    crop: firstError(requiredString(input.crop, 'Crop type'), maxStringLength(input.crop, 32, 'Crop')),
    coverageUsdc: positiveNumber(input.coverageUsdc, 'Coverage amount'),
    premiumUsdc: positiveNumber(input.premiumUsdc, 'Premium'),
    triggerThresholdMm: positiveNumber(input.triggerThresholdMm, 'Trigger threshold'),
    season:
      !input.seasonStart || !input.seasonEnd || input.seasonEnd <= input.seasonStart
        ? 'Season end must be after season start'
        : undefined,
  }
  return errorOrNull(errors)
}

export function validateRevokePolicy(input: RevokePolicyInput): RevokePolicyValidationError | null {
  const errors: RevokePolicyValidationError = {
    farmAddress: requiredString(input.farmAddress, 'Farm address'),
    policyCount:
      !Number.isInteger(input.policyCount) || input.policyCount < 1 ? 'The farm has no policy to revoke' : undefined,
  }
  return errorOrNull(errors)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map the raw on-chain policy state variant to our enum. Idempotent: also accepts an already-parsed state string. */
export function parsePolicyState(raw: unknown): PolicyState {
  if (typeof raw === 'string') {
    if (raw === 'active' || raw === 'paidOut' || raw === 'expired') return raw
  }
  if (raw && typeof raw === 'object') {
    if ('active' in raw) return 'active'
    if ('paidOut' in raw) return 'paidOut'
    if ('expired' in raw) return 'expired'
  }
  return 'active'
}

/**
 * Calculate whether a policy would trigger given a rainfall reading.
 * Used client-side for preview — actual settlement happens on-chain.
 */
export function wouldTrigger(policy: Policy, totalRainfallMm: number): boolean {
  return totalRainfallMm < policy.triggerThresholdMm
}

/**
 * Estimate a discount percentage based on verified scout reports.
 * More scouting history = lower premium = higher trust.
 * Cap at 20% discount for 10+ verified reports.
 */
export function scoutingDiscountPercent(verifiedReports: number): number {
  return Math.min(verifiedReports * 2, 20)
}
