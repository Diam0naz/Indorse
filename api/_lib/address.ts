/**
 * api/_lib/address.ts — base58 address validity (server-side)
 *
 * Shared by the email routes, which bind an email to a wallet address and must
 * reject a malformed address before touching any state. A Solana public key is
 * exactly 32 bytes once base58-decoded; anything else is garbage.
 */

import { getBase58Encoder } from '@solana/kit'

/** True when `address` decodes to exactly one 32-byte public key. */
export function isValidAddress(address: string): boolean {
  try {
    return getBase58Encoder().encode(address).length === 32
  } catch {
    return false
  }
}
