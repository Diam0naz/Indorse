/**
 * Shared test mocks.
 *
 * - `@expo/vector-icons` drags in `expo-font` → `expo-asset`, whose ESM source
 *   uses extensionless imports Node's resolver rejects outside Metro — so the
 *   icon set is replaced with a decorative Text stand-in for every test.
 * - `expo-crypto` imports the `expo` package root (Expo.fx), which needs
 *   `global.ErrorUtils` from a real React Native runtime; the digest is
 *   deterministic so app-lock tests can predict stored verifiers.
 */
import { vi } from 'vitest'
import type { ComponentProps, ComponentType, ReactNode } from 'react'
import type { StyleProp, TextStyle, ViewStyle } from 'react-native'

type IconProps = {
  size?: number
  color?: string
  style?: StyleProp<TextStyle>
} & Record<string, unknown>

vi.mock('@expo/vector-icons', async () => {
  const React = await import('react')
  const { Text } = await import('react-native')

  const makeIcon = (name: string): ComponentType<IconProps> => {
    const Icon = ({ size = 16, color = '#000000', style, ...rest }: IconProps) =>
      React.createElement(Text, {
        ...rest,
        style: [{ fontSize: size, color }, style],
      } as ComponentProps<typeof Text>)
    Icon.displayName = name
    return Icon
  }

  return {
    FontAwesome5: makeIcon('FontAwesome5'),
    MaterialIcons: makeIcon('MaterialIcons'),
    Ionicons: makeIcon('Ionicons'),
    Feather: makeIcon('Feather'),
  }
})

// RN installs `ErrorUtils` (global exception handler) as part of its runtime
// bootstrap; vitest-native's globals shim doesn't. `expo`'s Expo.fx.tsx reads it
// at import time when `isRunningInExpoGo()` — true here because the shim's
// `expo.modules` registry auto-answers every lookup, so the ExpoGo probe hits.
// Supply the two entry points Expo.fx touches so every expo-* import chain
// (expo-haptics, expo-camera, expo-location…) gets past the expo package root.
type ErrorUtilsShim = {
  getGlobalHandler: () => (error: unknown) => void
  setGlobalHandler: (handler: (error: unknown) => void) => void
}
const expoGlobal = globalThis as typeof globalThis & { ErrorUtils?: ErrorUtilsShim }
expoGlobal.ErrorUtils ??= {
  getGlobalHandler: () => () => {},
  setGlobalHandler: () => {},
}

// expo-camera's build output statically re-imports named exports
// (`requireNativeModule`) from expo-modules-core, which the transform in
// vitest.config.mts serves as CJS — Node's cjs-module-lexer can't see through
// babel's `export *` helpers, so the native link dies with "does not provide
// an export named 'requireNativeModule'". Tests never capture anyway
// (CameraView renders only after a granted permission), so stand in: no
// permission by default → the simulated viewfinder path stays in force.
vi.mock('expo-camera', async () => {
  const React = await import('react')
  const { View } = await import('react-native')

  const CameraView = React.forwardRef<unknown, { style?: StyleProp<ViewStyle>; children?: ReactNode }>(
    ({ style, children }, _ref) => React.createElement(View, { style }, children),
  )
  CameraView.displayName = 'CameraView'

  return {
    CameraView,
    useCameraPermissions: () => [null, vi.fn(async () => null)],
  }
})

// expo-image-manipulator has no native module here, and importing it drags in
// Expo's winter fetch runtime, which installs its own global `fetch` over the
// one the tests stub. A load failure is a supported outcome — `downscaleShot`
// treats it as "re-encode unavailable" and the capture keeps its original
// bytes, which is the path the capture tests assert on.
vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: () => {
      throw new Error('expo-image-manipulator is not available in this test runtime')
    },
  },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}))

// Deterministic: hashPasscode(passcode, salt) === `sha256:${salt}:${passcode}`.
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: vi.fn(async (_alg: string, data: string) => `sha256:${data}`),
  randomUUID: vi.fn(() => 'salt-fixed'),
}))
