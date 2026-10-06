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

// ── Crop cycles & season spacing ─────────────────────────────────────────────

/**
 * Days from planting to harvest, by crop — content, not UI (the form still
 * types crops free-form; a future crop picker reads this table). Rounded
 * agronomic norms for the regions this app serves.
 */
export const CROP_CYCLE_DAYS: Record<string, number> = {
  vegetables: 60,
  cowpea: 70,
  millet: 90,
  sunflower: 95,
  maize: 100,
  corn: 100,
  sorghum: 100,
  groundnut: 105,
  soybean: 105,
  wheat: 110,
  rice: 120,
  yam: 150,
  cassava: 300,
}

/**
 * The season-spacing benchmark, derived from the FASTEST crop in the table:
 * consecutive planting seasons on one farm must be at least this far apart
 * (previous season's end → next season's start), so seasons can't be stacked
 * back-to-back to keep the settle window permanently open.
 */
export const MIN_SEASON_GAP_DAYS = Math.min(...Object.values(CROP_CYCLE_DAYS))

/** Rainfall trigger in mm × 10 — the highest threshold an honest season could
 *  carry (1500 mm); anything above it pays out on any real reading. */
const MAX_TRIGGER_MM10 = 15_000

const SECONDS_PER_DAY = 86_400

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
  /** Season end (unix s) of the farm's most recent policy, when one exists —
   *  the anchor for the minimum season-spacing rule. Null on a first policy. */
  previousSeasonEnd?: number | null
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
    premiumUsdc: firstError(
      positiveNumber(input.premiumUsdc, 'Premium'),
      // Mirrors the chain: the fee sits inside [1%, 100%] of the cover it
      // buys — below is mispriced cover, above a money-losing trap.
      input.premiumUsdc * 100 < input.coverageUsdc ? 'Premium must be at least 1% of the coverage amount' : undefined,
      // The fee can never exceed the cover it buys — otherwise the tier
      // gate caps coverage while the premium sails past it ungated.
      input.premiumUsdc > input.coverageUsdc ? 'Premium must not exceed the coverage amount' : undefined,
    ),
    triggerThresholdMm: firstError(
      positiveNumber(input.triggerThresholdMm, 'Trigger threshold'),
      // mm × 10: a threshold above any plausible season total would pay out
      // whatever the oracle reads — cap at the generous 1500 mm ceiling.
      input.triggerThresholdMm > MAX_TRIGGER_MM10 ? 'Trigger threshold must be 1500mm or less' : undefined,
    ),
    season: seasonError(input),
  }
  return errorOrNull(errors)
}

/** Season window rules: end after start, a start that hasn't already passed,
 *  and — when a previous season exists — the gap to it at least one
 *  fastest-crop-cycle benchmark (MIN_SEASON_GAP_DAYS). */
function seasonError(input: CreatePolicyInput): string | undefined {
  const { seasonStart, seasonEnd, previousSeasonEnd } = input
  if (!seasonStart || !seasonEnd || seasonEnd <= seasonStart) return 'Season end must be after season start'
  // A backdated season is instantly settleable; date-only inputs parse as
  // UTC midnight, so a day of grace keeps "start today" valid in every
  // timezone.
  if (seasonStart < Math.floor(Date.now() / 1000) - SECONDS_PER_DAY) return 'Season start must be today or later'
  if (previousSeasonEnd != null && seasonStart < previousSeasonEnd + MIN_SEASON_GAP_DAYS * SECONDS_PER_DAY) {
    return `The next season must start at least ${MIN_SEASON_GAP_DAYS} days after the previous season ends`
  }
  return undefined
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
