/**
 * features/email/emailApi.ts — client for the /api/email routes
 *
 * Mirrors `features/ai/classify.ts`: a thin, typed wrapper over fetch that
 * turns the server's `{ error, code }` bodies into one `EmailApiError`. The
 * origin is derived from `EXPO_PUBLIC_AI_CLASSIFY_URL` (see lib/api-origin), so
 * the POC keeps a single URL to configure.
 *
 * `wallet` is optional throughout: pass it to bind the code to an address
 * (Settings → verify email), omit it for passcode recovery at the lock screen,
 * which runs before any wallet session exists. The server keys the two apart,
 * and no attestation comes back without a wallet.
 */

import { getApiOrigin } from '@/lib/api-origin'

export class EmailApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'EmailApiError'
  }
}

export interface EmailCallOptions {
  /** Override the origin (tests); defaults to `getApiOrigin()`. */
  origin?: string
  /** Injectable fetch (tests); defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/** True when an API origin is configured — the UI uses this to disable the flow. */
export function isEmailEndpointConfigured(): boolean {
  return getApiOrigin() !== null
}

async function post(path: string, body: unknown, options: EmailCallOptions): Promise<Record<string, unknown>> {
  const origin = options.origin ?? getApiOrigin()
  if (!origin) throw new EmailApiError('Email endpoint not configured', 'not-configured')

  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new EmailApiError('Could not reach the server', 'network')
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`
    const code = typeof payload.code === 'string' ? payload.code : undefined
    throw new EmailApiError(message, code)
  }
  return payload
}

/** Ask the server to email a code to `email`, bound to `wallet` when given. */
export async function requestEmailCode(email: string, wallet?: string, options: EmailCallOptions = {}): Promise<void> {
  await post('/api/email/start', { email, ...(wallet ? { wallet } : {}) }, options)
}

export interface VerifiedEmail {
  verified: boolean
  /** Present when the server also wrote an SAS attestation. */
  attestation?: { address: string; signature: string }
}

/** Confirm the code; resolves when the server accepts it. */
export async function verifyEmailCode(
  email: string,
  wallet: string | undefined,
  code: string,
  options: EmailCallOptions = {},
): Promise<VerifiedEmail> {
  const payload = await post('/api/email/verify', { email, ...(wallet ? { wallet } : {}), code }, options)
  return { verified: payload.verified === true, attestation: payload.attestation as VerifiedEmail['attestation'] }
}
