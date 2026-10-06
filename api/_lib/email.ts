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

/**
 * The one message this POC sends: a 6-digit code, no links and no tracking.
 *
 * The HTML body is the app's default theme rendered as email — "Warm
 * Charcoal" (the `darkTokens` table in constants/theme.ts): the #0E0D0B ink
 * canvas around a #1A1815 surface card with the #2E2A24 hairline, amber
 * #F2A340 carrying the wordmark and the code (amber for actions), #F5F3EE /
 * #9B968C for text and fine print, and the code well on #231F1A — the same
 * surface-alt the app's inputs sit on. Type follows the display/body split:
 * Space Grotesk headings, Inter body, mono code, over Google Fonts with
 * system fallbacks so a stripped <style> still reads clean.
 *
 * The hexes are mirrored here rather than imported because this module runs
 * server-side and cannot pull the React Native theme into the API process —
 * `api/email.test.ts` locks every value against darkTokens so a palette
 * change cannot drift the email. The text body stays plain: it is the
 * fallback for text-only clients and the accessibility source of the code.
 *
 * Still no links and no tracking — the footer says so because it is true.
 */
export function buildOtpEmail(code: string, minutes: number): Omit<SendEmailInput, 'to'> {
  const text = `Your Indorse verification code is ${code}. It expires in ${minutes} minutes. If you didn't request this, ignore this email.`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Your Indorse verification code</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Space+Grotesk:wght@500;700&amp;display=swap');
@media (max-width: 480px) {
  .wrap { padding: 16px 8px !important; }
  .body { padding: 22px 20px !important; }
  .code { font-size: 27px !important; letter-spacing: 6px !important; text-indent: 6px !important; }
}
</style>
</head>
<body style="margin:0; padding:0; background-color:#0E0D0B; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0E0D0B;">
    <tr>
      <td align="center" class="wrap" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:440px; background-color:#1A1815; border:1px solid #2E2A24; border-radius:14px;">
          <tr>
            <td style="padding:20px 28px; border-bottom:1px solid #2E2A24;">
              <span style="font-family:'Space Grotesk','Segoe UI',Helvetica,Arial,sans-serif; font-size:18px; font-weight:700; letter-spacing:0.06em; color:#F2A340;">indorse</span>
            </td>
          </tr>
          <tr>
            <td class="body" style="padding:28px;">
              <h1 style="margin:0 0 6px; font-family:'Space Grotesk','Segoe UI',Helvetica,Arial,sans-serif; font-size:20px; font-weight:700; color:#F5F3EE;">Your verification code</h1>
              <p style="margin:0 0 22px; font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#9B968C;">Enter it in indorse to confirm this address is yours.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#231F1A; border:1px solid #2E2A24; border-radius:10px;">
                <tr>
                  <td align="center" style="padding:18px 8px;">
                    <span class="code" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:34px; line-height:40px; font-weight:700; letter-spacing:8px; text-indent:8px; color:#F2A340;">${code}</span>
                  </td>
                </tr>
              </table>
              <p style="margin:18px 0 0; font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#F5F3EE;">It expires in ${minutes} minutes.</p>
              <p style="margin:6px 0 0; font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#9B968C;">If you didn't request this, ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px; border-top:1px solid #2E2A24;">
              <p style="margin:0; font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif; font-size:12px; line-height:18px; color:#9B968C;">Just the code &mdash; no links, no tracking.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  return { subject: 'Your Indorse verification code', text, html }
}
