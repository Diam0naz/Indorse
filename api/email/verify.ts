/**
 * api/email/verify.ts — check the verification code (step 2 of 2)
 *
 * Consumes the code issued by `api/email/start.ts` for the same key. A match is
 * single-use. Wrong guesses burn the attempt budget and lock the code, so the
 * caller must request a new one rather than brute-force it.
 *
 *   POST /api/email/verify
 *   { email, wallet?, code }
 *   → 200 { verified: true, address, attestation? }
 *   → 400 malformed, missing, expired or wrong code · 429 too many attempts
 *
 * With a wallet, the verified address is returned and — when the SAS gate is
 * configured and an issuer is available — an "email verified" attestation is
 * issued and reported as `attestation`. Issuance is best-effort — a chain
 * failure never costs the user an email they already proved (see
 * `_lib/sas.ts`).
 *
 * Without a wallet (passcode recovery at the lock screen, where no wallet
 * session exists) the answer is just `{ verified: true }`: it proves control
 * of the inbox for that code, nothing more, and no attestation can exist
 * without a subject address.
 */

import { isValidAddress } from '../_lib/address'
import { OTP_LENGTH, emailOtpStore, normalizeEmail, otpKey } from '../_lib/otp-store'
import { issueEmailAttestation, sasConfigFromEnv } from '../_lib/sas'
import { kitAttestationIssuer } from '../_lib/sas-issuer'
import { parseBody, type ProxyRequest, type ProxyResponse } from '../_lib/proxy'

const CODE_RE = new RegExp(`^\\d{${OTP_LENGTH}}$`)

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseBody(req.body)
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''

  if (!email || (wallet && !isValidAddress(wallet)) || !CODE_RE.test(code)) {
    res.status(400).json({ error: `A valid email and a ${OTP_LENGTH}-digit code are required.` })
    return
  }

  const outcome = emailOtpStore.verify(otpKey(email, wallet), code)

  if (outcome === 'ok') {
    // Wallet-less recovery: prove control of the inbox, nothing else — there
    // is no address to attest to and no wallet session to bind.
    if (!wallet) {
      res.status(200).json({ verified: true })
      return
    }
    const issued = await issueEmailAttestation(
      { subject: wallet, email, verifiedAt: Math.floor(Date.now() / 1000) },
      { config: sasConfigFromEnv(), issuer: kitAttestationIssuer, pepper: process.env.SAS_EMAIL_PEPPER },
    )
    res.status(200).json({
      verified: true,
      address: wallet,
      ...(issued.status === 'issued'
        ? { attestation: { address: issued.attestation, signature: issued.signature } }
        : {}),
    })
    return
  }
  if (outcome === 'locked') {
    res.status(429).json({ error: 'Too many attempts. Request a new code.', code: 'locked' })
    return
  }

  // missing / expired / mismatch all answer the same way.
  res.status(400).json({ error: 'That code is not valid.', code: outcome })
}
