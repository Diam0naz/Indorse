/**
 * api/_lib/admin-auth.ts — the server-side `config.admin` gate
 *
 * Admin routes never trust the client's claim of role: after the SIWS proof
 * pins the caller's address, this module reads the `config` PDA on-chain and
 * compares `config.admin` to it. A `set_roles` rotation therefore takes
 * effect immediately (subject to a short cache below) with no env change,
 * no redeploy and no session to revoke.
 *
 * The account read is memoized for `CACHE_TTL_MS` so a burst of admin calls
 * costs one RPC round trip; the cache is per process, same as the nonce
 * store — a multi-instance deploy shares nothing here either (a rotated
 * admin is stale for at most the TTL on another instance).
 *
 * RPC endpoint: `EXPO_PUBLIC_SOLANA_RPC_URL` (the cluster the app talks to),
 * falling back to `SAS_RPC_URL`, then the public devnet endpoint — the same
 * fallback chain `scripts/bootstrap-sas.ts` uses.
 */

import { configPda } from '@/lib/program/pdas'
import { createProgramRpc, fetchAccount } from '@/lib/program/rpc'

/** Decoded shape of the on-chain `Config` account (camelCase, base58 keys). */
export interface ConfigRoles {
  admin: string
  verifier: string
  oracle: string
  bump: number
}

const CACHE_TTL_MS = 15_000
let cached: { config: ConfigRoles; at: number } | null = null

/** Drop the memoized config (tests: isolation between cases). */
export function clearAdminCache(): void {
  cached = null
}

function rpcUrl(): string {
  return process.env.EXPO_PUBLIC_SOLANA_RPC_URL || process.env.SAS_RPC_URL || 'https://api.devnet.solana.com'
}

/** Reads (or serves from cache) the config PDA. `null` = account missing. */
async function readConfig(): Promise<ConfigRoles | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.config
  const rpc = createProgramRpc(rpcUrl())
  const addr = await configPda()
  const config = await fetchAccount<ConfigRoles>(rpc, addr, 'Config')
  if (config) cached = { config, at: Date.now() }
  return config
}

export type AdminGateResult =
  { ok: true; config: ConfigRoles } | { ok: false; status: number; error: { error: string; code: string } }

/**
 * The gate itself. Failure statuses:
 *   502 rpc        — the cluster could not be read (not the caller's fault)
 *   403 no-config  — no config PDA exists, so nobody is admin yet
 *   403 not-admin  — valid sign-in, wrong key
 */
export async function requireAdmin(address: string): Promise<AdminGateResult> {
  let config: ConfigRoles | null
  try {
    config = await readConfig()
  } catch {
    return { ok: false, status: 502, error: { error: 'On-chain config read failed.', code: 'rpc' } }
  }
  if (!config) {
    return { ok: false, status: 403, error: { error: 'On-chain config not found.', code: 'no-config' } }
  }
  if (config.admin !== address) {
    return { ok: false, status: 403, error: { error: 'Not the config admin.', code: 'not-admin' } }
  }
  return { ok: true, config }
}
