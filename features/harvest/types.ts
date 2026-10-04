/**
 * Harvest feature types.
 * Mirrors the HarvestBatch on-chain account from the farm_service program.
 */

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
  timestamp: number
  bump: number
  address?: string
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
}

export interface HarvestBatchValidationError {
  uri?: string
  crop?: string
  notes?: string
  quantityKg?: string
  photoHash?: string
  lat?: string
  lng?: string
}

export function validateHarvestBatch(input: SubmitHarvestBatchInput): HarvestBatchValidationError | null {
  const errors: HarvestBatchValidationError = {
    ...latLngErrors(input.lat, input.lng),
    uri: firstError(requiredString(input.uri, 'Batch URI'), maxStringLength(input.uri, 128, 'URI')),
    crop: firstError(requiredString(input.crop, 'Crop type'), maxStringLength(input.crop, 32, 'Crop')),
    notes: maxStringLength(input.notes, 256, 'Notes'),
    quantityKg: positiveNumber(input.quantityKg, 'Quantity'),
    photoHash: exactArrayLength(input.photoHash, 32, 'Photo hash'),
  }
  return errorOrNull(errors)
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
