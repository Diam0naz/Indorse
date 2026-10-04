/**
 * app/index.tsx — Entry point redirect
 *
 * Expo Router's file-based routing always resolves `/` to this file, and what
 * sits *underneath* the auth gate depends on who is launching the app:
 *
 *   new user (no passcode yet) → /onboarding  (logo splash → 3 slides → Enter App)
 *   returning user (passcode)  → /(tabs)      (unlock lands straight in the app;
 *                                              onboarding already happened once)
 *
 * `unlocked` renders nothing on purpose: both ways of getting there (just
 * registered, or just unlocked) mean the redirect for this launch has already
 * fired, so re-deciding would either yank a first-time user past onboarding or
 * bounce a returning user off the app they just opened. Nothing is drawn while
 * `loading` either — the auth gate covers the screen for that whole window.
 */

import { Redirect } from 'expo-router'
import { useAuth } from '@/components/auth-provider'

export default function Index() {
  const { status } = useAuth()

  if (status === 'loading' || status === 'unlocked') return null
  return <Redirect href={status === 'unregistered' ? '/onboarding' : '/(tabs)'} />
}
