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
  bump: number
  /** The on-chain address (added by the client when fetching) */
  address?: string
}

export interface RegisterFarmInput {
  name: string
  /** Latitude as a decimal, e.g. 34.052 */
  lat: number
  /** Longitude as a decimal, e.g. -118.243 */
  lng: number
}

/** Validation error for the RegisterFarm form */
export interface RegisterFarmValidationError {
  name?: string
  lat?: string
  lng?: string
}

/** Validates RegisterFarmInput before sending a transaction. */
export function validateRegisterFarm(input: RegisterFarmInput): RegisterFarmValidationError | null {
  const errors: RegisterFarmValidationError = {
    ...latLngErrors(input.lat, input.lng),
    name: firstError(requiredString(input.name, 'Farm name'), maxStringLength(input.name, 64, 'Farm name')),
  }
  return errorOrNull(errors)
}
