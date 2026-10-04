/**
 * Reports feature types.
 * Mirrors the ScoutReport on-chain account from the farm_service program.
 */

import {
  firstError,
  requiredString,
  maxStringLength,
  exactArrayLength,
  latLngErrors,
  errorOrNull,
} from '@/lib/validation'
export type ReportStatus = 'pending' | 'verified' | 'rejected' | 'rewarded'

export interface ScoutReport {
  farm: string
  reporter: string
  index: number
  photoHash: number[]
  uri: string
  latE6: number
  lngE6: number
  aiLabel: string
  status: ReportStatus
  verifier: string
  timestamp: number
  bump: number
  /** The on-chain address of this report account (added by the client) */
  address?: string
}

export interface SubmitScoutReportInput {
  farmAddress: string
  photoHash: number[]
  uri: string
  /** Decimal latitude */
  lat: number
  /** Decimal longitude */
  lng: number
  aiLabel: string
}

export interface SubmitReportValidationError {
  uri?: string
  aiLabel?: string
  photoHash?: string
  lat?: string
  lng?: string
}

/** Validates SubmitScoutReportInput before sending a transaction. */
export function validateSubmitReport(input: SubmitScoutReportInput): SubmitReportValidationError | null {
  const errors: SubmitReportValidationError = {
    ...latLngErrors(input.lat, input.lng),
    uri: firstError(requiredString(input.uri, 'Photo URI'), maxStringLength(input.uri, 128, 'Photo URI')),
    aiLabel: firstError(requiredString(input.aiLabel, 'AI label'), maxStringLength(input.aiLabel, 32, 'AI label')),
    photoHash: exactArrayLength(input.photoHash, 32, 'Photo hash'),
  }
  return errorOrNull(errors)
}

/**
 * Deterministic 32-byte stand-in for a photo digest (FNV-1a + LCG).
 * The simulated capture has no real file to hash, but the instruction
 * requires a fixed [u8; 32] — this keeps captures reproducible per seed.
 */
export function demoPhotoHash(seed: string): number[] {
  const bytes: number[] = []
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
  for (let i = 0; i < 32; i += 1) {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0
    bytes.push(h & 0xff)
  }
  return bytes
}

/** Map raw on-chain status variant to our enum. Idempotent: also accepts an already-parsed status string. */
export function parseReportStatus(raw: unknown): ReportStatus {
  if (typeof raw === 'string') {
    if (raw === 'pending' || raw === 'verified' || raw === 'rejected' || raw === 'rewarded') return raw
  }
  if (raw && typeof raw === 'object') {
    if ('pending' in raw) return 'pending'
    if ('verified' in raw) return 'verified'
    if ('rejected' in raw) return 'rejected'
    if ('rewarded' in raw) return 'rewarded'
  }
  return 'pending'
}
