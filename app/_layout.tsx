import 'react-native-quick-base64'
import { useCallback, useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { useFonts } from 'expo-font'
import * as SplashScreen from 'expo-splash-screen'
// Per-weight subpaths: the package index `require`s every style, which would
// drag all 24 faces (~8 MB) into the bundle instead of the 8 we use.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular'
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium'
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold'
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold'
import { SpaceGrotesk_400Regular } from '@expo-google-fonts/space-grotesk/400Regular'
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium'
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold'
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold'
// Calligraphic face for the header greeting ("Good morning").
import { Allura_400Regular } from '@expo-google-fonts/allura/400Regular'
import 'react-native-reanimated'
import { AppProviders } from '@/components/app-providers'
import { AppSplash } from '@/components/app-splash'
import { AuthGate } from '@/components/auth-gate'
import { AuthProvider } from '@/components/auth-provider'
import { FarmRegistryProvider } from '@/components/farm-registry-provider'
import { ProfileProvider } from '@/components/profile-provider'
import { SettingsProvider } from '@/components/settings-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { LanguageProvider } from '@/lib/i18n'
import '../global.css'

/**
 * Design system fonts — Space Grotesk (the single text face) + Inter (dense
 * passages) + Allura (calligraphic header greeting), loaded from Google Fonts
 * before the first frame. Splash stays up until they resolve; `createStyles` in
 * constants/theme.ts then assigns the face per text style.
 */
const FONT_ASSETS = {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Allura_400Regular,
}

void SplashScreen.preventAutoHideAsync().catch(() => undefined)

/**
 * Root layout
 *
 * Screen hierarchy:
 *   /             → app/index.tsx          (new user → /onboarding,
 *                                            returning user → /(tabs))
 *   /onboarding   → app/onboarding.tsx     (3-slide intro + wallet connect)
 *   /setup        → app/setup.tsx          (profile-driven setup wizard,
 *                                           re-entered from the Profile banner)
 *   /(tabs)       → app/(tabs)/_layout.tsx  (bottom tab navigator)
 *   /settings/*   → app/settings/*.tsx      (settings stack screens)
 *
 * Preference providers sit above the navigator so theme (and its status bar
 * style), language and settings are available to every screen. `ProfileProvider`
 * holds the setup wizard's saved profile + deferred-step flags (AsyncStorage)
 * for the same reason — it wraps AuthProvider so the wizard, the header avatar
 * and the Profile banner all read one source. `AuthProvider`
 * sits innermost of those and renders `AuthGate` — a full-screen modal that
 * covers the app until the registered user passes the app lock (passcode or
 * biometrics); it does not disturb route state.
 *
 * Launch order: `AppSplash` (the logo card) owns the first two seconds, and
 * `AuthGate` mounts only once it finishes — so the passcode prompt never
 * appears (nor its biometric sheet fire) underneath the splash, and exactly
 * one of the two cover modals is mounted at any moment.
 */
export default function RootLayout() {
  const [fontsLoaded] = useFonts(FONT_ASSETS)
  const [splashDone, setSplashDone] = useState(false)
  const finishSplash = useCallback(() => setSplashDone(true), [])

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => undefined)
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  return (
    <ThemeProvider>
      <LanguageProvider>
        <SettingsProvider>
          <FarmRegistryProvider>
            <ProfileProvider>
              <AuthProvider>
                <AppProviders>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="index" options={{ headerShown: false }} />
                    <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                    <Stack.Screen name="setup" options={{ headerShown: false }} />
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  </Stack>
                </AppProviders>
                {splashDone ? <AuthGate /> : <AppSplash onDone={finishSplash} />}
              </AuthProvider>
            </ProfileProvider>
          </FarmRegistryProvider>
        </SettingsProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}
