/**
 * api/email/start.ts — send a verification code (step 1 of 2)
 *
 * Binds an email to a wallet: the code is stored against the (email, wallet)
 * pair and emailed to the address. `api/email/verify.ts` checks it back. The
 * address is required so a code cannot be replayed against a different wallet,
 * and only ever a salted digest of the code is kept server-side.
 *
 *   POST /api/email/start
 *   { email, wallet }
 *   → 200 { sent: true, expiresAt }
 *   → 400 malformed email/address · 500 misconfigured · 502 provider failure
 *
 * Env:
 *   RESEND_API_KEY — required
 *   EMAIL_FROM     — optional; defaults to Resend's sandbox sender
 */

import { isValidAddress } from '../_lib/address'
import { EmailError, buildOtpEmail, sendEmail } from '../_lib/email'
import { OTP_TTL_MS, emailOtpStore, generateOtp, normalizeEmail, otpKey } from '../_lib/otp-store'
import { parseBody, type ProxyRequest, type ProxyResponse } from '../_lib/proxy'

/** Deliberately loose — deliverability is the provider's job, not a regex battle. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req: ProxyRequest, res: ProxyResponse): Promise<void> {
  if (req.method && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseBody(req.body)
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : ''
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : ''

  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'A valid email address is required.' })
    return
  }
  if (!isValidAddress(wallet)) {
    res.status(400).json({ error: 'Malformed wallet address.' })
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: RESEND_API_KEY missing' })
    return
  }

  const code = generateOtp()
  const { expiresAt } = emailOtpStore.issue(otpKey(email, wallet), code)

  try {
    await sendEmail(
      { to: email, ...buildOtpEmail(code, Math.round(OTP_TTL_MS / 60_000)) },
      { apiKey, from: process.env.EMAIL_FROM },
    )
  } catch (error) {
    // Never leak provider internals to the client.
    const errorCode = error instanceof EmailError ? error.code : 'upstream'
    res.status(502).json({ error: 'Could not send the verification email.', code: errorCode })
    return
  }

  res.status(200).json({ sent: true, expiresAt })
}
