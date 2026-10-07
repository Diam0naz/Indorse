/**
 * api/_lib/allowlist.ts — server-side allowlists with a runtime override layer
 *
 * Two lists share this code because they are the same mechanism with
 * different entitlements:
 *
 *   'dev'      `SGT_DEV_ALLOWLIST` — gates SIWS sign-in. `'*'` allows any
 *              verified wallet (development/demo ONLY; the server-side SGT
 *              check is what replaces it in production).
 *   'operator' `OPERATOR_ALLOWLIST` — grants funds-tier tier2 ($250,
 *              "verified operators"). No wildcard below, on purpose: see
 *              `isOperator`.
 *
 * The base list is read from env per call so operators can rotate it without
 * a redeploy; empty/missing denies everything — failing closed is the only
 * safe default for an entitlement check.
 *
 * On top sits an optional *runtime* override, set only through
 * `POST /api/admin/allowlist` (SIWS proof + on-chain `config.admin` match).
 * This is what makes the phone-side allowlist management real: entries added
 * from the admin console take effect immediately for every subsequent check
 * in this process. The override lives in memory — it resets to the env base
 * when the process restarts, and a multi-instance deploy needs the same
 * shared store the nonce store already calls out. `source` reports which
 * layer is answering so the console can say so out loud.
 */

import { isValidAddress } from './address'

/** Which list an operation applies to. */
export type AllowlistName = 'dev' | 'operator'

/** Env var each list reads its base from. */
const ENV_KEY: Record<AllowlistName, string> = {
  dev: 'SGT_DEV_ALLOWLIST',
  operator: 'OPERATOR_ALLOWLIST',
}

/** Runtime overrides — `null` = that list's env governs (the default). */
let runtimeEntries: Record<AllowlistName, string[] | null> = { dev: null, operator: null }

/** Raw entries of a list: the override when set, else the env base. */
export function allowlistEntries(list: AllowlistName = 'dev'): string[] {
  const override = runtimeEntries[list]
  const raw = override !== null ? override.join(',') : (process.env[ENV_KEY[list]] ?? '').trim()
  if (raw.length === 0) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Which layer answers `allowlistEntries(list)` right now. */
export function allowlistSource(list: AllowlistName = 'dev'): 'env' | 'runtime' {
  return runtimeEntries[list] !== null ? 'runtime' : 'env'
}

/**
 * True when the wallet may sign in: a listed address, or any address while
 * `'*'` is among the entries. Empty list denies — fail closed.
 */
export function isEligible(address: string): boolean {
  const entries = allowlistEntries('dev')
  if (entries.length === 0) return false
  if (entries.includes('*')) return true // development/demo only
  return entries.includes(address)
}

/**
 * True when the wallet is a listed operator (funds-tier tier2).
 *
 * Exact membership only. Unlike the dev list there is no `'*'` branch: this
 * list is what "verified" means, so a wildcard would hand the $250 ceiling to
 * every wallet in the world — and because a real address can never equal
 * `'*'`, a `'*'` left in the env is inert rather than dangerous. `updateAllowlist`
 * refuses to *add* one anyway; only env can carry it, and here it does nothing.
 */
export function isOperator(address: string): boolean {
  const entries = allowlistEntries('operator')
  if (entries.length === 0) return false
  return entries.includes(address)
}

export type AllowlistOps = {
  add?: unknown
  remove?: unknown
}

export type AllowlistUpdateResult = { ok: true; entries: string[]; source: 'runtime' } | { ok: false; error: string }

/**
 * Applies set operations to the effective list and stores the result as the
 * runtime override for that list. Addresses are validated here (the caller is
 * already the admin, but garbage must not poison the list); `'*'` may be
 * *removed* (so a wildcard env can be replaced with real entries) but not
 * *added* — turning a deployment into allow-everything belongs in env, not on
 * a phone.
 */
export function updateAllowlist(list: AllowlistName, ops: AllowlistOps): AllowlistUpdateResult {
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

  let next = allowlistEntries(list)
  for (const entry of removeList) next = next.filter((existing) => existing !== entry)
  for (const entry of addList) if (!next.includes(entry)) next.push(entry)
  runtimeEntries[list] = next
  return { ok: true, entries: next, source: 'runtime' }
}

/** Test hook — drop every override so the env bases govern again. */
export function resetAllowlist(): void {
  runtimeEntries = { dev: null, operator: null }
}
