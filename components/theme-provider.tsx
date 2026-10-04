/**
 * components/theme-provider.tsx — Runtime theming
 *
 * The palette used to be a static import, so every style block baked its
 * colours in at module load. Styles are now built per-render from this
 * context (`makeStyles(colors)`), which lets the app switch between the dark
 * field palette, the light paper palette, the Seeker-exclusive Seeker
 * Midnight palette, and the device setting.
 *
 * The default context value is the dark palette, so components keep working
 * in isolation (tests, previews) without a provider.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { StatusBar, useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { colors as darkColors, lightColors, seekerColors, type Colors } from '@/constants/theme'

export type ThemeMode = 'dark' | 'light' | 'system' | 'seeker'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'indorse.theme'

/** Stored values that may be restored. Older builds stored no `seeker`. */
const SAVED_MODES: readonly string[] = ['dark', 'light', 'system', 'seeker']

interface ThemeValue {
  /** What the user picked (may be "system"). */
  mode: ThemeMode
  /** What "system" currently resolves to. */
  resolved: ResolvedTheme
  /** The palette every style block should be built from. */
  colors: Colors
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeValue>({
  mode: 'dark',
  resolved: 'dark',
  colors: darkColors,
  setMode: () => undefined,
})

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme()
  const [mode, setModeState] = useState<ThemeMode>('dark')

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && stored && SAVED_MODES.includes(stored)) {
          setModeState(stored as ThemeMode)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined)
  }, [])

  const value = useMemo<ThemeValue>(() => {
    // Only `system` and `light` resolve away from dark: Seeker Midnight is a
    // dark palette, so it keeps the light status-bar content.
    const resolved: ResolvedTheme =
      mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode === 'light' ? 'light' : 'dark'
    const colors = mode === 'seeker' ? seekerColors : resolved === 'light' ? lightColors : darkColors
    return { mode, resolved, colors, setMode }
  }, [mode, systemScheme, setMode])

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar
        barStyle={value.resolved === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={value.colors.surface}
        animated
      />
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext)
}
