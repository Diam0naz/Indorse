/**
 * adminApi — SIWS-authenticated client half of the admin API routes.
 *
 * Every call runs the same deliberate three-step dance the device-verification
 * flow uses, one wallet prompt per request:
 *
 *   1. POST /api/siws/nonce      — the server issues + stores the payload
 *   2. wallet.signIn(...)        — the connected wallet signs it (MWA prompt)
 *   3. POST /api/admin/<route>   — proof + payload; the server verifies the
 *      signature, then reads the config PDA and compares `config.admin`
 *
 * There is no session token to steal or refresh: each admin API request
 * carries its own single-use proof, and the admin check is re-read from
 * chain server-side every time (short cache), so a `set_roles` rotation
 * takes effect immediately.
 */

import { useMutation } from '@tanstack/react-query'
import { getApiOrigin } from '@/lib/api-origin'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'

/**
 * Which allowlist an operation targets. Mirrors `_lib/allowlist.ts`'s
 * `AllowlistName` — app code never imports from `api/`.
 */
export type AllowlistName = 'dev' | 'operator'

/** `POST /api/admin/status` response. */
export interface AdminStatus {
  config: { admin: string; verifier: string; oracle: string }
  /** The dev sign-in list — kept under its historic key. */
  allowlist: { entries: string[]; source: 'env' | 'runtime' }
  /** Funds-tier tier2 ("verified operators"). */
  operatorAllowlist: { entries: string[]; source: 'env' | 'runtime' }
  /** Feature flags — which provider backends are configured server-side. */
  api: { email: boolean; sas: boolean; ai: boolean }
}

/** `POST /api/admin/allowlist` request — set operations on one list. */
export interface AllowlistUpdate {
  add?: string[]
  remove?: string[]
  /** Omitted = `'dev'`, so a caller written before the operator list still works. */
  list?: AllowlistName
}

export interface AllowlistResult {
  entries: string[]
  source: 'env' | 'runtime'
  list?: AllowlistName
}

type WalletLike = {
  signIn: (input: Record<string, unknown>) => Promise<{ signature: Uint8Array; signedMessage: Uint8Array }>
}

/**
 * Issue → sign → POST. `payload` rides along with the proof (the allowlist
 * ops); the status route takes none.
 */
async function postAdmin<T>(
  path: string,
  wallet: WalletLike | null | undefined,
  address: string | null | undefined,
  payload?: object,
): Promise<T> {
  const origin = getApiOrigin()
  if (!origin) throw new Error('endpoint-not-configured')
  if (!address) throw new Error('wallet-not-connected')
  if (!wallet) throw new Error('wallet-not-connected')

  // 1. The server issues the whole payload and stores it under the nonce.
  const issuedRes = await fetch(`${origin}/api/siws/nonce`, { method: 'POST' })
  if (!issuedRes.ok) throw new Error(`nonce request failed (${issuedRes.status})`)
  const issued = (await issuedRes.json()) as Record<string, unknown> & { nonce: string }

  // 2. The wallet signs it — one prompt, bound to this address.
  const output = await wallet.signIn({ ...issued, address })

  // 3. Proof + payload to the admin route; the server re-reads config.admin.
  const res = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address,
      nonce: issued.nonce,
      signature: Array.from(output.signature),
      signedMessage: Array.from(output.signedMessage),
      ...payload,
    }),
  })
  const body = (await res.json()) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? `${path} failed (${res.status})`)
  return body as T
}

/** Reads the full admin status (roles, allowlist, provider flags). */
export function useAdminStatus() {
  const { wallet, address } = useMobileWalletSetup()
  return useMutation<AdminStatus, Error, void>({
    mutationFn: () => postAdmin<AdminStatus>('/api/admin/status', wallet as unknown as WalletLike, address),
  })
}

/** Applies set operations to one runtime allowlist (`list` selects which). */
export function useAllowlistUpdate() {
  const { wallet, address } = useMobileWalletSetup()
  return useMutation<AllowlistResult, Error, AllowlistUpdate>({
    mutationFn: (input) =>
      postAdmin<AllowlistResult>('/api/admin/allowlist', wallet as unknown as WalletLike, address, input),
  })
}
