/**
 * Shared validation helpers.
 *
 * The feature validators (farm, reports, harvest, escrow, insurance) all
 * build a `{ field?: message }` error object and return it — or null when
 * clean. These helpers keep the per-field rules consistent and remove the
 * copy-pasted lat/lng and finalize boilerplate.
 */

import { address as toAddress } from '@solana/kit'

/** Field-level check for any 32-byte base58 address. */
export function addressValidationError(value: string): string | undefined {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return 'Address is required'
  try {
    toAddress(trimmed)
    return undefined
  } catch {
    return 'Not a valid Solana address'
  }
}

/** Return the errors object when any field has a message, otherwise null. */
export function errorOrNull<E extends object>(errors: E): E | null {
  return Object.values(errors).some((v) => typeof v === 'string' && v.length > 0) ? errors : null
}

/** Join all error messages into a single "a; b; c" string (for thrown errors). */
export function describeErrors<E extends object>(errors: E): string {
  return Object.values(errors)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join('; ')
}

/** First non-empty message, or undefined — for required + max-length chains. */
export function firstError(...messages: (string | undefined)[]): string | undefined {
  return messages.find((m) => typeof m === 'string' && m.length > 0)
}

/** "`field` is required" when the string is empty/whitespace. */
export function requiredString(value: string, field: string): string | undefined {
  return value.trim() ? undefined : `${field} is required`
}

/** "`field` must be `max` characters or fewer" when exceeded. */
export function maxStringLength(value: string, max: number, field: string): string | undefined {
  return value.length > max ? `${field} must be ${max} characters or fewer` : undefined
}

/** "`field` must be greater than zero" when not a positive number. */
export function positiveNumber(value: number, field: string): string | undefined {
  return value > 0 ? undefined : `${field} must be greater than zero`
}

/** "`field` must be exactly `length` bytes" when the byte array length differs. */
export function exactArrayLength(value: readonly unknown[], length: number, field: string): string | undefined {
  return value.length !== length ? `${field} must be exactly ${length} bytes` : undefined
}

/** Shared lat/lng range validation used by every geo-tagged submission. */
export function latLngErrors(lat: number, lng: number): { lat?: string; lng?: string } {
  const errors: { lat?: string; lng?: string } = {}
  if (Number.isNaN(lat) || lat < -90 || lat > 90) {
    errors.lat = 'Latitude must be between -90 and 90'
  }
  if (Number.isNaN(lng) || lng < -180 || lng > 180) {
    errors.lng = 'Longitude must be between -180 and 180'
  }
  return errors
}
