/**
 * lib/api-origin.ts — where the app's serverless routes live (POC)
 *
 * One origin serves every route (classify, siws/…). Rather than a second
 * `EXPO_PUBLIC_*` var to keep in sync, derive the origin from
 * `EXPO_PUBLIC_AI_CLASSIFY_URL` — the API URL the app already has to be
 * configured with — so POC deployments still configure exactly one URL.
 * Returns null when no API URL is configured (features then disable
 * themselves instead of guessing).
 */
export function getApiOrigin(): string | null {
  const endpoint = process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
  if (!endpoint) return null
  try {
    return new URL(endpoint).origin
  } catch {
    return null
  }
}
