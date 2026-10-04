/**
 * Shared formatting and unit-conversion helpers.
 *
 * Single home for the utilities that every feature needs — coordinate
 * E6 encoding, timestamps, USDC amounts and address shortening — so
 * features stop importing each other's internals.
 */

/** Convert a decimal coordinate to the integer format used on-chain (× 1_000_000). */
export function toE6(decimal: number): number {
  return Math.round(decimal * 1_000_000)
}

/** Convert an on-chain E6 integer back to a human-readable decimal. */
export function fromE6(e6: number): number {
  return e6 / 1_000_000
}

/** Format a unix timestamp (seconds) to a readable date string. */
export function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString()
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Compact date for log rows — "Sep 22". Built without `Intl` so the output is
 * identical across Hermes/iOS/Node (seed data uses the same format).
 */
export function formatShortDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/**
 * Shorten a base-58 address for display, e.g. "GVen…U5Ht".
 * `head` is the number of leading characters to keep (4 trailing chars always).
 */
export function shortenAddress(address: string, head = 4): string {
  if (address.length <= head + 4) return address
  return `${address.slice(0, head)}…${address.slice(-4)}`
}

/** Convert whole USDC to lamports (6 decimal places). */
export function usdcToLamports(usdc: number): number {
  return Math.round(usdc * 1_000_000)
}

/** Convert USDC lamports back to a human-readable dollar amount. */
export function lamportsToUsdc(lamports: number): number {
  return lamports / 1_000_000
}

/** Format a USDC lamport amount as "$X.XX". */
export function formatUsdc(lamports: number): string {
  return `$${lamportsToUsdc(lamports).toFixed(2)}`
}
