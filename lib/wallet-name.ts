/**
 * lib/wallet-name.ts — Friendly wallet names
 *
 * A raw base58 pubkey is intimidating on a first-run screen, so every wallet
 * gets a stable two-word name derived from its address. Same address always
 * maps to the same name, so it behaves like an identity rather than a random
 * label that changes between renders.
 */

const ADJECTIVES = [
  'Amber',
  'Cedar',
  'Golden',
  'Prairie',
  'Quiet',
  'Rustic',
  'Silver',
  'Willow',
  'Copper',
  'Meadow',
  'Harvest',
  'North',
] as const

const NOUNS = [
  'Falcon',
  'Heron',
  'Bison',
  'Maple',
  'Ridge',
  'Crane',
  'Oak',
  'Lark',
  'Field',
  'Harbor',
  'Beacon',
  'Marrow',
] as const

/** djb2 — tiny deterministic hash, good enough to pick two words. */
function hash(value: string): number {
  let h = 5381
  for (let i = 0; i < value.length; i++) {
    h = ((h << 5) + h + value.charCodeAt(i)) >>> 0
  }
  return h
}

/** "Amber Falcon" for a given address; "Guest Wallet" when disconnected. */
export function walletName(address: string | null | undefined): string {
  if (!address) return 'Guest Wallet'
  const h = hash(address)
  const adjective = ADJECTIVES[h % ADJECTIVES.length]
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length]
  return `${adjective} ${noun}`
}
