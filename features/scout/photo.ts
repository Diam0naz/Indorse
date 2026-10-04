/**
 * features/scout/photo.ts — photo hashing for scout reports
 *
 * `submit_scout_report` stores a `[u8; 32]` digest of the captured image.
 * The bytes are the SHA-256 of the image's base64 payload, matching what the
 * camera hands us and what a verifier can recompute from the stored evidence.
 */

import * as Crypto from 'expo-crypto'

/**
 * Expand a SHA-256 hex digest into 32 bytes.
 *
 * Defensive by construction: always returns 32 entries, and an unparseable
 * pair becomes `0` rather than `NaN`, so a malformed digest can never produce
 * an on-chain argument the program rejects.
 */
export function sha256HexToBytes(hex: string): number[] {
  const clean = hex.trim().toLowerCase()
  const bytes: number[] = []
  for (let i = 0; i < 64; i += 2) {
    const value = Number.parseInt(clean.slice(i, i + 2), 16)
    bytes.push(Number.isNaN(value) ? 0 : value & 0xff)
  }
  return bytes
}

/** SHA-256 of the captured image bytes as the on-chain `[u8; 32]` photo hash. */
export async function photoHash(base64: string): Promise<number[]> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64)
  return sha256HexToBytes(hex)
}
