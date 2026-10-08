/**
 * api/_lib/farm-types.ts — Farm type for serverless functions
 *
 * Copied from features/farm/types.ts to avoid tsconfig path aliases.
 * Keep in sync when the source changes.
 */

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
