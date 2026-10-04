/**
 * Escrow feature types.
 * Mirrors the Escrow on-chain account from the farm_service program.
 *
 * Flow: buyer creates escrow → farmer releases → funds move to farmer
 *       OR buyer cancels before lock_until → funds return to buyer
 */

import { positiveNumber, errorOrNull } from '@/lib/validation'

export type EscrowState = 'funded' | 'released' | 'cancelled'

export interface Escrow {
  batch: string
  buyer: string
  farmer: string
  /** Amount in USDC lamports (6 decimals, so 1_000_000 = 1 USDC) */
  amountUsdc: number
  /** Unix timestamp after which buyer can no longer cancel */
  lockUntil: number
  state: EscrowState
  bump: number
  address?: string
}

export interface CreateEscrowInput {
  batchAddress: string
  /** Amount in whole USDC (e.g. 500 = $500) */
  amountUsdc: number
  /** How many seconds from now the escrow locks */
  lockDurationSeconds: number
}

export interface EscrowValidationError {
  amountUsdc?: string
  lockDurationSeconds?: string
}

export function validateCreateEscrow(input: CreateEscrowInput): EscrowValidationError | null {
  const errors: EscrowValidationError = {
    amountUsdc: positiveNumber(input.amountUsdc, 'Amount'),
    lockDurationSeconds: input.lockDurationSeconds >= 60 ? undefined : 'Lock duration must be at least 60 seconds',
  }
  return errorOrNull(errors)
}

/** Map the raw on-chain escrow state variant to our enum. Idempotent: also accepts an already-parsed state string. */
export function parseEscrowState(raw: unknown): EscrowState {
  if (typeof raw === 'string') {
    if (raw === 'funded' || raw === 'released' || raw === 'cancelled') return raw
  }
  if (raw && typeof raw === 'object') {
    if ('funded' in raw) return 'funded'
    if ('released' in raw) return 'released'
    if ('cancelled' in raw) return 'cancelled'
  }
  return 'funded'
}
