/**
 * Admin feature types — inputs and validation for the protocol's
 * `config.admin` instruction surface.
 *
 * Every action mirrors a role-gated instruction in the program; the chain
 * re-checks `authority == config.admin` regardless of what this file says,
 * so validation here is UX (catch garbage before the wallet prompt), never
 * security.
 */

import { addressValidationError, errorOrNull, firstError, positiveNumber } from '@/lib/validation'

/* ── set_roles ─────────────────────────────────────────────────────────────── */

export interface SetRolesValues {
  admin: string
  verifier: string
  oracle: string
}

export interface SetRolesErrors {
  admin?: string
  verifier?: string
  oracle?: string
}

export function validateSetRoles(input: SetRolesValues): SetRolesErrors | null {
  const errors: SetRolesErrors = {
    admin: addressValidationError(input.admin),
    verifier: addressValidationError(input.verifier),
    oracle: addressValidationError(input.oracle),
  }
  return errorOrNull(errors)
}

/* ── add_oracle / remove_oracle ────────────────────────────────────────────── */

export interface OracleMemberValues {
  member: string
}

export interface OracleMemberErrors {
  member?: string
}

export function validateOracleMember(input: OracleMemberValues): OracleMemberErrors | null {
  const errors: OracleMemberErrors = { member: addressValidationError(input.member) }
  return errorOrNull(errors)
}

/* ── release_verifier / slash_verifier ─────────────────────────────────────── */

export interface VerifierTargetValues {
  target: string
}

export interface VerifierTargetErrors {
  target?: string
}

export function validateVerifierTarget(input: VerifierTargetValues): VerifierTargetErrors | null {
  const errors: VerifierTargetErrors = { target: addressValidationError(input.target) }
  return errorOrNull(errors)
}

/* ── init / reconfigure verifier set ───────────────────────────────────────── */

export interface VerifierSetValues {
  /** Quorum k — 1..=7 (MAX_VERIFIERS). */
  k: number
  /** Seat price in whole USDC (converted to e6 for the instruction). */
  bondAmount: number
}

export interface VerifierSetErrors {
  k?: string
  bondAmount?: string
}

function quorumError(k: number): string | undefined {
  if (!Number.isInteger(k) || k < 1) return 'Quorum must be a whole number of at least 1'
  if (k > 7) return 'Quorum cannot exceed 7 members (MAX_VERIFIERS)'
  return undefined
}

export function validateVerifierSet(input: VerifierSetValues): VerifierSetErrors | null {
  const errors: VerifierSetErrors = {
    k: quorumError(input.k),
    bondAmount: positiveNumber(input.bondAmount, 'Bond amount'),
  }
  return errorOrNull(errors)
}

/* ── init_oracle_set ───────────────────────────────────────────────────────── */

export interface InitOracleSetValues {
  /** Reader quorum — odd, 3..=7 (the program's init gate). */
  k: number
}

export interface InitOracleSetErrors {
  k?: string
}

export function validateInitOracleSet(input: InitOracleSetValues): InitOracleSetErrors | null {
  const errors: InitOracleSetErrors = {
    k:
      !Number.isInteger(input.k) || input.k < 3 || input.k > 7 || input.k % 2 === 0
        ? 'Reader quorum must be odd, 3..=7'
        : undefined,
  }
  return errorOrNull(errors)
}

/* ── withdraw_treasury ─────────────────────────────────────────────────────── */

export interface WithdrawTreasuryValues {
  /** Whole USDC (converted to e6 for the instruction). */
  amountUsdc: number
}

export interface WithdrawTreasuryErrors {
  amountUsdc?: string
}

export function validateWithdrawTreasury(input: WithdrawTreasuryValues): WithdrawTreasuryErrors | null {
  const errors: WithdrawTreasuryErrors = {
    amountUsdc: positiveNumber(input.amountUsdc, 'Withdrawal amount'),
  }
  return errorOrNull(errors)
}

/* ── settle_policy ─────────────────────────────────────────────────────────── */

export interface SettlePolicyValues {
  farmAddress: string
  /** The policy's farmer — the payout destination's owner. */
  farmerAddress: string
  /** The farm's policy count — the current policy lives at `policyCount - 1`. */
  policyCount: number
  /** The policy's season start — seeds the weather-oracle PDA. */
  seasonStart: number
}

export interface SettlePolicyErrors {
  farmAddress?: string
  farmerAddress?: string
  policyCount?: string
  seasonStart?: string
}

export function validateSettlePolicy(input: SettlePolicyValues): SettlePolicyErrors | null {
  const errors: SettlePolicyErrors = {
    farmAddress: addressValidationError(input.farmAddress),
    farmerAddress: addressValidationError(input.farmerAddress),
    policyCount:
      !Number.isInteger(input.policyCount) || input.policyCount < 1 ? 'The farm has no policy to settle' : undefined,
    seasonStart: !input.seasonStart ? 'Season start is missing' : undefined,
  }
  return errorOrNull(errors)
}

/* ── close_settled_policy ───────────────────────────────────────────────────── */

export interface CloseSettledPolicyValues {
  farmAddress: string
  /** The policy's farmer — both rents refund here, pinned by the program. */
  farmerAddress: string
  /** The farm's policy count — the current policy lives at `policyCount - 1`. */
  policyCount: number
}

export interface CloseSettledPolicyErrors {
  farmAddress?: string
  farmerAddress?: string
  policyCount?: string
}

export function validateCloseSettledPolicy(input: CloseSettledPolicyValues): CloseSettledPolicyErrors | null {
  const errors: CloseSettledPolicyErrors = {
    farmAddress: addressValidationError(input.farmAddress),
    farmerAddress: addressValidationError(input.farmerAddress),
    policyCount:
      !Number.isInteger(input.policyCount) || input.policyCount < 1 ? 'The farm has no policy to close' : undefined,
  }
  return errorOrNull(errors)
}

/* ── submit_oracle_reading ─────────────────────────────────────────────────── */

export interface SubmitOracleReadingValues {
  farmAddress: string
  /** The season's start — seeds the weather-oracle PDA. */
  seasonStart: number
  /** Season total as a human reads it: millimetres, e.g. `212.4`. */
  rainfallMm: number
}

export interface SubmitOracleReadingErrors {
  farmAddress?: string
  seasonStart?: string
  rainfallMm?: string
}

/** The program stores millimetres × 10 in a `u32` — its hard ceiling. */
export const MAX_RAINFALL_X10 = 4_294_967_295

/** Millimetres → the program's `mm × 10` representation. */
export function rainfallToScaledX10(mm: number): number {
  return Math.round(mm * 10)
}

export function validateSubmitOracleReading(input: SubmitOracleReadingValues): SubmitOracleReadingErrors | null {
  const scaled = rainfallToScaledX10(input.rainfallMm)
  const errors: SubmitOracleReadingErrors = {
    farmAddress: addressValidationError(input.farmAddress),
    seasonStart: !Number.isInteger(input.seasonStart) || input.seasonStart < 1 ? 'Season start is missing' : undefined,
    // NaN rather than 0: an empty field must never read as "0 mm of rain",
    // which is a plausible season total and would post silently.
    rainfallMm: !Number.isFinite(input.rainfallMm)
      ? 'Rainfall must be a number'
      : input.rainfallMm < 0
        ? 'Rainfall must be zero or more'
        : scaled > MAX_RAINFALL_X10
          ? 'Rainfall is out of range'
          : undefined,
  }
  return errorOrNull(errors)
}

/* ── Shared field helpers used by the console's forms ──────────────────────── */

/** Parses a form field into a whole number, reporting `label` on failure. */
export function parseIntegerField(value: string, label: string): { value?: number; error?: string } {
  const n = Number(value.trim())
  if (!Number.isFinite(n)) return { error: `${label} must be a number` }
  return { value: n }
}

/** Parses a form field into a decimal amount, reporting `label` on failure. */
export function parseAmountField(value: string, label: string): { value?: number; error?: string } {
  const n = Number(value.trim())
  if (!Number.isFinite(n) || n <= 0) return { error: `${label} must be a positive amount` }
  return { value: n }
}

/** First error message among candidates — mirrors `firstError` usage elsewhere. */
export function firstAdminError(...messages: (string | undefined)[]): string | undefined {
  return firstError(...messages)
}
