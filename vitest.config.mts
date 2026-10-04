import { fileURLToPath } from 'node:url'
import { presets, reactNative } from 'vitest-native'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    reactNative({
      // Mobile Wallet Adapter is Android-only, so tests resolve the Android variant of native modules.
      platform: 'android',
      // Mocks for the native modules these libraries expect to find at runtime.
      presets: [
        presets.asyncStorage(),
        presets.gestureHandler(),
        presets.reanimated(),
        presets.safeAreaContext(),
        presets.vectorIcons(),
        // expo's `Expo.fx` side-effect file does `import 'expo-asset'`, whose ESM
        // entry imports './Asset.fx' — an extension Node's resolver can't map to
        // Asset.fx.js (vitest-native's loader skips it since `.fx` reads as an
        // extension). Any expo package (expo-haptics, expo-camera, expo-location…)
        // reaches that chain, so stub expo-asset & friends with the shipped preset.
        presets.expo(),
      ],
      // expo-router (used by the settings stack) requires expo-modules-core, whose
      // package entry is TypeScript source under node_modules — Node's type
      // stripper refuses those, so hand the file to vitest-native's transform.
      // @expo/vector-icons ships untranspiled JSX source that needs transformation.
      transform: ['expo-modules-core', '@expo/vector-icons'],
    }),
  ],
  resolve: {
    // Mirrors the `@/*` path alias from tsconfig.json.
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // Shared mocks: see test/setup-mocks.ts (icon set → expo-font → expo-asset).
    setupFiles: ['./test/setup-mocks.ts'],
    // Clear dev-only env flags that leak from .env into the test runner.
    // EXPO_PUBLIC_FORCE_SEEKER=true in .env is for on-device Seeker preview only;
    // tests that assert the badge/row is hidden off-Seeker must not see it.
    env: {
      EXPO_PUBLIC_FORCE_SEEKER: '',
    },
    // Verbose reporter logs a ✓ / ✗ line for every test so pass/fail is
    // immediately visible in the terminal without having to scroll.
    reporter: ['verbose'],
    coverage: {
      exclude: ['**/*.config.*', '**/*.test.*', 'android/**', 'app.json', 'dist/**', 'index.js', 'test/**'],
      include: ['app/**', 'components/**', 'constants/**', 'features/**', 'lib/**', 'utils/**'],
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    include: ['**/*.test.{ts,tsx}'],
  },
})
