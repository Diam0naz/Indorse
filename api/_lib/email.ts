/**
 * api/_lib/email.ts — transactional email sender (Resend)
 *
 * The one place the email provider key lives. Routes call `sendEmail` and get
 * back a provider id or an `EmailError`; the network call is injected so tests
 * can exercise the whole flow without touching the provider.
 *
 *   POST https://api.resend.com/emails
 *   { from, to, subject, text, html } → { id }
 *
 * Env (read by the routes, not here):
 *   RESEND_API_KEY — required
 *   EMAIL_FROM     — optional; defaults to Resend's onboarding sender, which
 *                    only delivers to the account owner's own address until a
 *                    domain is verified.
 */

export type EmailErrorCode = 'bad-request' | 'unauthorized' | 'upstream'

export class EmailError extends Error {
  constructor(
    message: string,
    public readonly code: EmailErrorCode,
  ) {
    super(message)
    this.name = 'EmailError'
  }
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Resend's shared sandbox sender — dev/demo only, and only to your own inbox. */
export const DEFAULT_EMAIL_FROM = 'Indorse <onboarding@resend.dev>'

export interface SendEmailInput {
  to: string
  subject: string
  text: string
  html?: string
}

export interface SendEmailOptions {
  apiKey: string
  from?: string
  endpoint?: string
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

export async function sendEmail(input: SendEmailInput, options: SendEmailOptions): Promise<{ id?: string }> {
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(options.endpoint ?? RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: options.from ?? DEFAULT_EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    })
  } catch {
    throw new EmailError('Could not reach the email provider', 'upstream')
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new EmailError('Email provider rejected the API key', 'unauthorized')
    }
    if (response.status === 400 || response.status === 422) {
      throw new EmailError('Email provider rejected the message', 'bad-request')
    }
    throw new EmailError('Email provider error', 'upstream')
  }

  const payload = (await response.json().catch(() => null)) as { id?: string } | null
  return { id: payload?.id }
}

/** The one message this POC sends: a 6-digit code, no links and no tracking. */
export function buildOtpEmail(code: string, minutes: number): Omit<SendEmailInput, 'to'> {
  return {
    subject: 'Your Indorse verification code',
    text: `Your Indorse verification code is ${code}. It expires in ${minutes} minutes. If you didn't request this, ignore this email.`,
    html:
      `<p>Your Indorse verification code is <strong>${code}</strong>.</p>` +
      `<p>It expires in ${minutes} minutes. If you didn't request this, ignore this email.</p>`,
  }
}
