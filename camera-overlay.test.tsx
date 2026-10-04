/**
 * camera-overlay.test.tsx — The scouting camera reports only what is real.
 *
 * The viewfinder's status elements used to be decorative:
 *
 *   - the field label was a hardcoded "East Draw · Sunflower";
 *   - the shot counter claimed "3 / 5" before anything was captured;
 *   - the AI chip was a static green "AI ready";
 *   - a submit without a verdict sent a seeded diagnosis on-chain.
 *
 * This test drives the real flow (simulated preview — the shared expo-camera
 * mock grants no permission) and asserts each element now reports actual
 * state: the farm name comes from the chain-fed prop, the counter counts the
 * presses the user made, the chip mirrors the probe result, and the local
 * event carries an honest "unclassified" verdict with no invented crop.
 *
 * `useSubmitReport` is mocked: the real hook needs a `MobileWalletProvider`
 * ancestor (mounted by `app-providers` in the app), and no test here reaches
 * the on-chain branch anyway — every submit in this file has no farm.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import type { ComponentProps, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CameraOverlay } from '@/components/camera-overlay'
import type { ScoutEvent } from '@/constants/data'

const LOAD = { timeout: 4000 }

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 0, Medium: 1, Heavy: 2 },
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
}))

vi.mock('@/features/scout/location', () => ({
  getCurrentCoords: vi.fn(async () => ({ lat: 46.8821, lng: -98.7023, accuracy: 8 })),
}))

vi.mock('@/features/reports/useSubmitReport', () => ({
  useSubmitReport: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
}))

type OverlayProps = ComponentProps<typeof CameraOverlay>
type Screen = Awaited<ReturnType<typeof render>>

async function renderOverlay(props: Partial<OverlayProps> = {}): Promise<Screen> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const tree = (children: ReactNode) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return render(tree(<CameraOverlay onClose={vi.fn()} {...props} />))
}

/** Press the shutter once and wait for the counter to catch up. */
async function captureShot(screen: Screen, expected: string) {
  await fireEvent.press(screen.getByLabelText('Capture a shot'))
  await screen.findByText(expected, {}, LOAD)
}

beforeEach(() => {
  // The environment has no proxy configured unless a test says otherwise.
  delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
  delete process.env.EXPO_PUBLIC_FORCE_SEEKER
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
  delete process.env.EXPO_PUBLIC_FORCE_SEEKER
})

describe('camera overlay — field label', () => {
  it('shows the real on-chain farm name', async () => {
    const screen = await renderOverlay({ farmName: 'Riverbend Farm' })
    expect(screen.getByText('Riverbend Farm')).toBeTruthy()
  })

  it('says "Unregistered area" instead of inventing a name', async () => {
    const screen = await renderOverlay()
    expect(screen.getByText('Unregistered area')).toBeTruthy()
    expect(screen.queryByText(/East Draw/)).toBeNull()
    expect(screen.queryByText(/Sunflower/)).toBeNull()
  })
})

describe('camera overlay — shot counter', () => {
  it('starts at zero and counts the presses the user actually made', async () => {
    const screen = await renderOverlay({ farmName: 'Riverbend Farm' })
    expect(screen.getByText('0 / 5 shots')).toBeTruthy()
    // No shots yet → nothing to analyze.
    expect(screen.queryByText('Analyze crop')).toBeNull()

    await captureShot(screen, '1 / 5 shots')
    expect(screen.getByText('Analyze crop')).toBeTruthy()

    await captureShot(screen, '2 / 5 shots')
    await captureShot(screen, '3 / 5 shots')
    await captureShot(screen, '4 / 5 shots')
    await captureShot(screen, '5 / 5 shots')

    // The ceiling holds: a press on the disabled shutter changes nothing.
    await fireEvent.press(screen.getByLabelText('Capture a shot'))
    expect(screen.getByText('5 / 5 shots')).toBeTruthy()
  })
})

describe('camera overlay — AI status', () => {
  it('never claims "AI ready" when no endpoint is configured', async () => {
    const screen = await renderOverlay({ farmName: 'Riverbend Farm' })
    expect(screen.getByText('AI unavailable')).toBeTruthy()
    expect(screen.queryByText('AI ready')).toBeNull()
  })

  it('shows "AI ready" only when the proxy answers the probe', async () => {
    process.env.EXPO_PUBLIC_AI_CLASSIFY_URL = 'http://proxy.test/api/classify'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({})),
    )
    const screen = await renderOverlay({ farmName: 'Riverbend Farm' })
    await screen.findByText('AI ready', {}, LOAD)
  })

  it('reports the proxy as unavailable when the probe cannot reach it', async () => {
    process.env.EXPO_PUBLIC_AI_CLASSIFY_URL = 'http://proxy.test/api/classify'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const screen = await renderOverlay({ farmName: 'Riverbend Farm' })
    await screen.findByText('AI unavailable', {}, LOAD)
  })
})

describe('camera overlay — analyze → done card', () => {
  it('reports the shot count it really has and the real verdict state', async () => {
    const screen = await renderOverlay({ farmName: 'Riverbend Farm' })
    await captureShot(screen, '1 / 5 shots')
    await captureShot(screen, '2 / 5 shots')

    await fireEvent.press(screen.getByLabelText('Analyze crop'))
    // Waits out the scanline (SCAN_MS) and the (unconfigured) classification.
    await screen.findByText('2 photos captured', {}, LOAD)
    expect(screen.getByText('AI unavailable')).toBeTruthy()
    expect(screen.queryByText('3 photos captured')).toBeNull()
  })

  it('uses the singular title for a single shot', async () => {
    const screen = await renderOverlay({ farmName: 'Riverbend Farm' })
    await captureShot(screen, '1 / 5 shots')

    await fireEvent.press(screen.getByLabelText('Analyze crop'))
    await screen.findByText('1 photo captured', {}, LOAD)
  })
})

describe('camera overlay — submit honesty', () => {
  it('builds an honest local event when no verdict landed', async () => {
    const onSubmit = vi.fn()
    const screen = await renderOverlay({ farmName: 'Riverbend Farm', onSubmit })

    await captureShot(screen, '1 / 5 shots')
    await fireEvent.press(screen.getByLabelText('Analyze crop'))
    await screen.findByText('1 photo captured', {}, LOAD)
    await fireEvent.press(screen.getByText('Submit to Chain'))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const event = onSubmit.mock.calls[0][0] as ScoutEvent

    // Real data in…
    expect(event.field).toBe('Riverbend Farm')
    expect(event.images).toBe(0) // simulated bytes — nothing real to anchor
    expect(event.lat).toBeCloseTo(46.8821, 3)
    expect(event.lng).toBeCloseTo(-98.7023, 3)
    expect(event.txSig).toMatch(/^[0-9a-f]{64}$/) // the digest, not a seeded signature
    expect(event.notes).toMatch(/^indorse:\/\/scout\/\d+\.jpg$/)
    expect(event.date).not.toBe('Sep 29')

    // …placeholders out: no verdict → honest fields, no invented crop.
    expect(event.diagnosis).toBe('unclassified')
    expect(event.severity).toBe('none')
    expect(event.confidence).toBe(0)
    expect(event.crop).toBe('—')
  })
})
