/**
 * api/_lib/format.ts — minimal format helpers for serverless functions
 *
 * Copied from lib/format.ts to avoid tsconfig path aliases.
 * Keep in sync when the source changes.
 */

/** Convert an on-chain E6 integer back to a human-readable decimal. */
export function fromE6(e6: number): number {
  return e6 / 1_000_000
}
