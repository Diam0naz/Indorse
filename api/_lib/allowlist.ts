/**
 * api/_lib/allowlist.ts — dev allowlist with a runtime override layer
 *
 * The base list is `SGT_DEV_ALLOWLIST` (comma-separated base58 addresses),
 * read per call so operators can rotate it without a redeploy; empty/missing
 * denies everything — failing closed is the only safe default for an
 * entitlement check. `'*'` as an entry allows any SIWS-verified wallet —
 * development/demo ONLY; the server-side SGT check replaces this later.
 *
 * On top of that sits an optional *runtime* override, set only through
 * `POST /api/admin/allowlist` (SIWS proof + on-chain `config.admin` match).
 * This is what makes the phone-side allowlist management real: entries added
 * from the admin console take effect immediately for every subsequent
 * sign-in check in this process. The override lives in memory — it resets to
 * the env base when the process restarts, and a multi-instance deploy needs
 * the same shared store the nonce store already calls out. `source` reports
 * which layer is answering so the console can say so out loud.
 */

import { isValidAddress } from './address'

/** Runtime override — `null` = env governs (the default). */
let runtimeEntries: string[] | null = null

/** Effective entries: the override when set, else the env list. */
export function allowlistEntries(): string[] {
  const raw = runtimeEntries !== null ? runtimeEntries.join(',') : (process.env.SGT_DEV_ALLOWLIST ?? '').trim()
  if (raw.length === 0) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Which layer answers `allowlistEntries()` right now. */
export function allowlistSource(): 'env' | 'runtime' {
  return runtimeEntries !== null ? 'runtime' : 'env'
}

/**
 * True when the wallet may sign in: a listed address, or any address while
 * `'*'` is among the entries. Empty list denies — fail closed.
 */
export function isEligible(address: string): boolean {
  const entries = allowlistEntries()
  if (entries.length === 0) return false
  if (entries.includes('*')) return true // development/demo only
  return entries.includes(address)
}

export type AllowlistOps = {
  add?: unknown
  remove?: unknown
}

export type AllowlistUpdateResult = { ok: true; entries: string[]; source: 'runtime' } | { ok: false; error: string }

/**
 * Applies set operations to the effective list and stores the result as the
 * runtime override. Addresses are validated here (the caller is already the
 * admin, but garbage must not poison the list); `'*'` may be *removed* (so
 * a wildcard env can be replaced with real entries) but not *added* — turning
 * a deployment into allow-everything belongs in env, not on a phone.
 */
export function updateAllowlist(ops: AllowlistOps): AllowlistUpdateResult {
  const { add, remove } = ops
  if ((add !== undefined && !Array.isArray(add)) || (remove !== undefined && !Array.isArray(remove))) {
    return { ok: false, error: 'add and remove must be arrays of addresses.' }
  }
  const addList = (add as string[] | undefined) ?? []
  const removeList = (remove as string[] | undefined) ?? []
  if (addList.length + removeList.length === 0) {
    return { ok: false, error: 'Nothing to change — provide add and/or remove.' }
  }
  if (addList.length + removeList.length > 64) {
    return { ok: false, error: 'Too many entries in one request (max 64).' }
  }
  for (const entry of addList) {
    if (typeof entry !== 'string' || !isValidAddress(entry)) {
      return { ok: false, error: 'Malformed address in add.' }
    }
  }
  for (const entry of removeList) {
    if (entry !== '*' && (typeof entry !== 'string' || !isValidAddress(entry))) {
      return { ok: false, error: 'Malformed address in remove.' }
    }
  }

  let next = allowlistEntries()
  for (const entry of removeList) next = next.filter((existing) => existing !== entry)
  for (const entry of addList) if (!next.includes(entry)) next.push(entry)
  runtimeEntries = next
  return { ok: true, entries: next, source: 'runtime' }
}

/** Test hook — drop the override so the env base governs again. */
export function resetAllowlist(): void {
  runtimeEntries = null
}
