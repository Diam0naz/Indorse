/**
 * useEmailVerification — client half of the email verification flow
 *
 * Two steps, driven by the wallet the code is bound to:
 *   1. sendCode(email)  → server emails a 6-digit code
 *   2. confirmCode(code) → server checks it (and may issue an SAS attestation)
 *
 * The server decides; the hook only exposes the state machine and the errors,
 * so the UI can show a busy button and an honest message. The wallet address is
 * read from `useMobileWalletSetup` — here codes are always bound to a
 * connected wallet. The lock screen's passcode recovery has no wallet session,
 * so it calls `emailApi` directly with a wallet-less code instead.
 */

import { useCallback, useState } from 'react'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { EmailApiError, requestEmailCode, verifyEmailCode } from './emailApi'

export type EmailVerificationStatus = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'error'

export interface EmailVerification {
  status: EmailVerificationStatus
  /** The email a code was last sent to (normalized), or null. */
  email: string | null
  /** Server error message when `status === 'error'`. */
  error: string | null
  /** True once the code is proven. */
  verified: boolean
  sendCode: (email: string) => Promise<void>
  confirmCode: (code: string) => Promise<void>
  reset: () => void
}

export function useEmailVerification(): EmailVerification {
  const { address } = useMobileWalletSetup()
  const [status, setStatus] = useState<EmailVerificationStatus>('idle')
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = useCallback((message: string) => {
    setStatus('error')
    setError(message)
  }, [])

  const sendCode = useCallback(
    async (next: string) => {
      const normalized = next.trim().toLowerCase()
      if (!address) {
        fail('Connect a wallet before verifying an email.')
        return
      }
      if (!normalized) {
        fail('Enter an email address.')
        return
      }
      setStatus('sending')
      setError(null)
      try {
        await requestEmailCode(normalized, address)
        setEmail(normalized)
        setStatus('sent')
      } catch (e) {
        fail(e instanceof EmailApiError ? e.message : 'Could not send the code.')
      }
    },
    [address, fail],
  )

  const confirmCode = useCallback(
    async (code: string) => {
      if (!address || !email) {
        fail('Request a code first.')
        return
      }
      setStatus('verifying')
      setError(null)
      try {
        await verifyEmailCode(email, address, code.trim())
        setStatus('verified')
      } catch (e) {
        fail(e instanceof EmailApiError ? e.message : 'That code is not valid.')
      }
    },
    [address, email, fail],
  )

  const reset = useCallback(() => {
    setStatus('idle')
    setEmail(null)
    setError(null)
  }, [])

  return { status, email, error, verified: status === 'verified', sendCode, confirmCode, reset }
}
