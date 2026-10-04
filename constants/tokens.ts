/**
 * constants/tokens.ts — Canonical SPL token mints
 *
 * Shared by the balance query and the escrow/insurance mutations so every
 * USDC touch in the app resolves to the same mint for the active cluster.
 */

/** Circle's USDC on mainnet. */
export const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** Circle's devnet USDC (6 decimals — the program requires `decimals == 6`). */
export const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
