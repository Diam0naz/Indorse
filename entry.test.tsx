/**
 * Entry redirect tests (app/index.tsx)
 *
 * Which screen sits *underneath* the auth gate follows the boot status:
 *
 *   new user (no passcode stored)  → /onboarding  (logo splash + 3 slides + Enter App)
 *   returning user (passcode set)  → /(tabs)      (unlock lands straight in the app)
 *
 * `unlocked` renders nothing, so registering cannot fire a second redirect
 * that would yank a first-time user past onboarding (third test).
 *
 * `expo-router`'s `Redirect` is mocked below to record where it points; the
 * providers and native modules are mocked the same way `auth.test.tsx` does.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { Text } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import Index from '@/app/index'
import { AuthProvider, useAuth } from '@/components/auth-provider'
import { SettingsProvider } from '@/components/settings-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { LanguageProvider } from '@/lib/i18n'

const AUTH_KEY = 'indorse.auth.v1'

/** Where `<Redirect>` was asked to send the user, in order. */
const { hrefs } = vi.hoisted(() => ({ hrefs: [] as string[] }))

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    hrefs.push(href)
    return <Text testID="entry-redirect">{href}</Text>
  },
}))

vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: vi.fn(async (key: string) => void store.delete(key)),
  }
})

vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: vi.fn(async () => true),
  isEnrolledAsync: vi.fn(async () => true),
  authenticateAsync: vi.fn(async () => ({ success: true })),
}))

/** Drives a registration from inside the tree so the latch can be observed. */
function RegisterNow() {
  const { register, status } = useAuth()
  return (
    <Text testID="status" onPress={() => void register('secret123')}>
      {status}
    </Text>
  )
}

async function renderEntry() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <SettingsProvider>
          <AuthProvider>
            <Index />
            <RegisterNow />
          </AuthProvider>
        </SettingsProvider>
      </LanguageProvider>
    </ThemeProvider>,
  )
}

beforeEach(async () => {
  hrefs.length = 0
  await SecureStore.deleteItemAsync(AUTH_KEY)
  vi.clearAllMocks()
})

describe('entry redirect', () => {
  it('sends a brand-new user to onboarding', async () => {
    const utils = await renderEntry()

    await waitFor(() => expect(utils.getByTestId('entry-redirect').props.children).toBe('/onboarding'))
    expect(hrefs).toContain('/onboarding')
  })

  it('sends a returning user straight to the tabs, past onboarding', async () => {
    await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify({ salt: 'test-salt', hash: 'sha256:test-salt:x' }))
    const utils = await renderEntry()

    await waitFor(() => expect(utils.getByTestId('entry-redirect').props.children).toBe('/(tabs)'))
  })

  it('does not re-redirect once a new user has been sent to onboarding', async () => {
    const utils = await renderEntry()
    await waitFor(() => expect(utils.getByTestId('entry-redirect').props.children).toBe('/onboarding'))

    // Registering flips `status` to `unlocked`; that must not redirect again
    // (a second pass would send them to the tabs, past onboarding).
    fireEvent.press(utils.getByTestId('status'))
    await waitFor(() => expect(utils.getByTestId('status').props.children).toBe('unlocked'))

    expect(utils.queryByTestId('entry-redirect')).toBeNull()
    expect(hrefs).toEqual(['/onboarding'])
  })
})
