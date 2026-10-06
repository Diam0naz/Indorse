/**
 * Farm feature types.
 * Mirror the on-chain account shapes from the farm_service Anchor program
 * (programs/indorse_program/programs/indorse_program/src/lib.rs).
 *
 * We keep these as plain TypeScript interfaces — the Anchor client returns
 * objects that match these shapes.
 */

import { firstError, requiredString, maxStringLength, latLngErrors, errorOrNull } from '@/lib/validation'

// Re-exported for backwards compatibility — farm was the original home of the
// coordinate helpers, and other modules still import them from here.
export { toE6, fromE6 } from '@/lib/format'

export interface Farm {
  owner: string
  name: string
  /** Latitude × 1_000_000 (avoids floats on-chain) */
  latE6: number
  /** Longitude × 1_000_000 */
  lngE6: number
  reportCount: number
  batchCount: number
  /** Reports with status verified/rewarded at the last chain write */
  verifiedReportCount: number
  /** Policies created against this farm (insurance) */
  policyCount: number
  /** This farm's slot in its owner's roster — the third PDA seed. */
  index: number
  bump: number
  /** The on-chain address (added by the client when fetching) */
  address?: string
}

/** Per-owner farm allocator — `count` names the next farm's PDA slot. */
export interface FarmCounter {
  owner: string
  count: number
  bump: number
}

export interface RegisterFarmInput {
  name: string
  /** Latitude as a decimal, e.g. 34.052 */
  lat: number
  /** Longitude as a decimal, e.g. -118.243 */
  lng: number
  /**
   * Acreage — optional: the chain account stores none, so this is local
   * detail recorded at registration (absent when the operator skips it).
   */
  acres?: number
}

/** Validation error for the RegisterFarm form */
export interface RegisterFarmValidationError {
  name?: string
  lat?: string
  lng?: string
  acres?: string
}

/** Sanity bound on the form's acreage — a plausibility check, not a survey. */
const MAX_ACRES = 100_000

/**
 * Absent acreage passes (the field is optional enrichment); a present
 * value must be a finite number in (0, MAX_ACRES].
 */
function acresError(acres: number | undefined): string | undefined {
  if (acres === undefined) return undefined
  if (!Number.isFinite(acres) || acres <= 0) return 'Acres must be greater than 0'
  if (acres > MAX_ACRES) return `Acres must be ${MAX_ACRES} or less`
  return undefined
}

/** Validates RegisterFarmInput before sending a transaction. */
export function validateRegisterFarm(input: RegisterFarmInput): RegisterFarmValidationError | null {
  const errors: RegisterFarmValidationError = {
    ...latLngErrors(input.lat, input.lng),
    name: firstError(requiredString(input.name, 'Farm name'), maxStringLength(input.name, 64, 'Farm name')),
    acres: acresError(input.acres),
  }
  return errorOrNull(errors)
}
