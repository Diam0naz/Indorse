/**
 * useDeviceVerification — client half of the server-side device gate (#3/#5)
 *
 * The server decides; this hook only collects the two proofs it asks for:
 * the server-issued SIWS payload (`signIn` on the connected wallet) and the
 * POST of `{ address, nonce, signature, signedMessage }`. The verdict comes
 * back from `api/siws/verify` — dev allowlist first, then the SGT
 * on-mainnet check when the server has it configured — and is display-only:
 * entitlement is never decided in the app (a patched client can claim
 * anything; see lib/seeker.ts).
 *
 * The API origin is derived from `EXPO_PUBLIC_AI_CLASSIFY_URL` (see
 * lib/api-origin) so the POC keeps one URL to configure.
 */

import { useCallback, useState } from 'react'
import { getApiOrigin } from '@/lib/api-origin'
import { useMobileWalletSetup } from './useMobileWalletSetup'

export type DeviceVerificationStatus = 'idle' | 'verifying' | 'verified' | 'unverified' | 'error'

export interface DeviceVerification {
  status: DeviceVerificationStatus
  /** Server reason ('not-allowlisted') or an error message — display/tests only. */
  reason: string | null
  /** Run the full issue → sign → verify flow. Safe to call again after a failure. */
  verify: () => Promise<void>
  /** Forget the current verdict (also happens automatically when the address changes). */
  reset: () => void
}

export function useDeviceVerification(): DeviceVerification {
  const { wallet, address } = useMobileWalletSetup()
  const [status, setStatus] = useState<DeviceVerificationStatus>('idle')
  const [reason, setReason] = useState<string | null>(null)

  // A different wallet is a different identity — the old verdict never carries
  // over. Reset during render (the documented prop-change adjustment) so the
  // stale verdict disappears with the very render that sees the new address,
  // instead of flashing for a frame behind an effect.
  const [seenAddress, setSeenAddress] = useState<string | null>(address)
  if (address !== seenAddress) {
    setSeenAddress(address)
    setStatus('idle')
    setReason(null)
  }

  const verify = useCallback(async () => {
    const origin = getApiOrigin()
    if (!origin || !address) {
      setStatus('error')
      setReason(origin ? 'wallet-not-connected' : 'endpoint-not-configured')
      return
    }

    setStatus('verifying')
    setReason(null)
    try {
      // 1. The server issues the whole payload and stores it under the nonce.
      const issuedRes = await fetch(`${origin}/api/siws/nonce`, { method: 'POST' })
      if (!issuedRes.ok) throw new Error(`nonce request failed (${issuedRes.status})`)
      const issued = (await issuedRes.json()) as Record<string, unknown> & { nonce: string }

      // 2. The wallet signs it — one prompt, bound to this address.
      const output = await wallet.signIn({ ...issued, address })

      // 3. The server verifies signature + allowlist and returns the verdict.
      const verifyRes = await fetch(`${origin}/api/siws/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          address,
          nonce: issued.nonce,
          signature: Array.from(output.signature),
          signedMessage: Array.from(output.signedMessage),
        }),
      })
      const verdict = (await verifyRes.json()) as { verified?: boolean; reason?: string; error?: string }
      if (!verifyRes.ok) throw new Error(verdict.error ?? `verify failed (${verifyRes.status})`)

      if (verdict.verified) {
        setStatus('verified')
        setReason(null)
      } else {
        setStatus('unverified')
        setReason(verdict.reason ?? 'not-allowlisted')
      }
    } catch (error) {
      setStatus('error')
      setReason(error instanceof Error ? error.message : String(error))
    }
  }, [address, wallet])

  const reset = useCallback(() => {
    setStatus('idle')
    setReason(null)
  }, [])

  return { status, reason, verify, reset }
}
