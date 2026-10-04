/**
 * features/email/verifiedEmailStore.ts — the locally remembered verified email
 *
 * Kept on device only. It exists so the app lock can offer email recovery while
 * the wallet is not connected (the lock screen runs before any wallet session),
 * by remembering which (email, wallet) pair the server last proved.
 *
 * It is a convenience, not a secret: recovery still requires a fresh code from
 * the email inbox, verified server-side against the same (email, wallet) pair.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const STORE_KEY = 'indorse.verifiedEmail'

export interface VerifiedEmailRecord {
  email: string
  wallet: string
}

export async function saveVerifiedEmail(email: string, wallet: string): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ email: email.trim().toLowerCase(), wallet }))
}

export async function getVerifiedEmail(): Promise<VerifiedEmailRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { email?: unknown; wallet?: unknown }
    if (typeof parsed.email !== 'string' || typeof parsed.wallet !== 'string') return null
    return { email: parsed.email, wallet: parsed.wallet }
  } catch {
    return null
  }
}

export async function clearVerifiedEmail(): Promise<void> {
  await AsyncStorage.removeItem(STORE_KEY)
}
