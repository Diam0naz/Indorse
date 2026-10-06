/**
 * Harvest feature types.
 * Mirrors the HarvestBatch on-chain account from the farm_service program.
 */

import { utf8ByteLength } from '@/features/ai/types'
import {
  firstError,
  requiredString,
  maxStringLength,
  positiveNumber,
  exactArrayLength,
  latLngErrors,
  errorOrNull,
} from '@/lib/validation'
export interface HarvestBatch {
  farm: string
  farmer: string
  index: number
  photoHash: number[]
  uri: string
  latE6: number
  lngE6: number
  crop: string
  quantityKg: number
  notes: string
  /** Total scout reports on the farm when this batch was submitted */
  scoutReportsAtHarvest: number
  /** Verified scout reports on the farm when this batch was submitted */
  verifiedReportsAtHarvest: number
  /** AI grade at harvest — 0 = ungraded, 1–4 = A–D (farmer-attested) */
  grade: number
  /** The vision model's combined confidence, 0–100 */
  gradeConfidence: number
  /** Why this grade, in the model's words (≤64 bytes on chain) */
  gradeNotes: string
  /** bit 0: the two models disagreed — flagged for a human verifier */
  gradeFlags: number
  timestamp: number
  bump: number
  address?: string
}

/** Letter for a grade value — index 0 is the ungraded 0 state. */
export const GRADE_LABELS = ['—', 'A', 'B', 'C', 'D'] as const

/** True when `grade_flags` carries bit 0 (models disagreed → verifier). */
export function gradeNeedsReview(flags: number): boolean {
  return (flags & 1) === 1
}

export interface SubmitHarvestBatchInput {
  farmAddress: string
  /**
   * The farm's current batch count — the new batch takes this index, so
   * the batch PDA (`["batch", farm, u32(batchCount)]`) derives from it.
   */
  batchCount: number
  photoHash: number[]
  uri: string
  lat: number
  lng: number
  crop: string
  quantityKg: number
  notes: string
  /** AI grade written with the batch — 0 = ungraded (grading unreachable), 1–4 = A–D. */
  grade: number
  /** Combined model confidence, 0–100. */
  gradeConfidence: number
  /** Model's quality notes, ≤64 UTF-8 bytes (the on-chain cap). */
  gradeNotes: string
  /** bit 0 set when the models disagreed — a human verifier should re-check. */
  gradeFlags: number
}

export interface HarvestBatchValidationError {
  uri?: string
  crop?: string
  notes?: string
  quantityKg?: string
  photoHash?: string
  lat?: string
  lng?: string
  grade?: string
  gradeConfidence?: string
  gradeNotes?: string
  gradeFlags?: string
}

export function validateHarvestBatch(input: SubmitHarvestBatchInput): HarvestBatchValidationError | null {
  const errors: HarvestBatchValidationError = {
    ...latLngErrors(input.lat, input.lng),
    uri: firstError(requiredString(input.uri, 'Batch URI'), maxStringLength(input.uri, 128, 'URI')),
    crop: firstError(requiredString(input.crop, 'Crop type'), maxStringLength(input.crop, 32, 'Crop')),
    notes: maxStringLength(input.notes, 256, 'Notes'),
    quantityKg: positiveNumber(input.quantityKg, 'Quantity'),
    photoHash: exactArrayLength(input.photoHash, 32, 'Photo hash'),
    // Mirror the program's require!() bounds so a bad grade can never reach
    // the wallet — same values the Rust edge enforces (grade ≤ 4, confidence
    // ≤ 100, notes ≤ 64 bytes, flags any u8).
    grade: intInRange(input.grade, 0, 4, 'Grade'),
    gradeConfidence: intInRange(input.gradeConfidence, 0, 100, 'Grade confidence'),
    gradeNotes: firstError(
      maxStringLength(input.gradeNotes, 64, 'Grade notes'),
      utf8ByteLength(input.gradeNotes) > 64 ? 'Grade notes must be at most 64 UTF-8 bytes' : undefined,
    ),
    gradeFlags: intInRange(input.gradeFlags, 0, 255, 'Grade flags'),
  }
  return errorOrNull(errors)
}

/** Integer in [min, max] — non-integers and out-of-range values both fail. */
function intInRange(value: number, min: number, max: number, label: string): string | undefined {
  if (!Number.isInteger(value) || value < min || value > max) {
    return `${label} must be a whole number between ${min} and ${max}`
  }
  return undefined
}

/**
 * Build a human-readable provenance summary from a batch.
 * This is what buyers see alongside the harvest record.
 */
export function batchProvenanceSummary(batch: HarvestBatch): string {
  const { scoutReportsAtHarvest, verifiedReportsAtHarvest } = batch
  if (scoutReportsAtHarvest === 0) return 'No scouting history for this farm.'
  return (
    `Scouted ${scoutReportsAtHarvest} time${scoutReportsAtHarvest === 1 ? '' : 's'} this season` +
    ` — ${verifiedReportsAtHarvest} verified by an agronomist.`
  )
}
