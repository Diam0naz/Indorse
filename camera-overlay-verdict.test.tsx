/**
 * camera-overlay-verdict.test.tsx — No diagnosis, no submission
 *
 * The old flow let `SUBMIT` ride even when the classifier never produced a
 * verdict: the report went through as `unclassified`, and the scouting log
 * later read "unclassified" with no explanation. This file drives the real
 * camera path (granted permission, real bytes) against a stubbed proxy and
 * locks the reworked stage machine:
 *
 *   - the analyzing modal reports progress over the captured thumbnails
 *     while every shot rides to the model in ONE `images[]` call;
 *   - the result card presents the diagnosis (label, confidence, notes);
 *   - when a configured proxy owes a diagnosis, submit stays disabled and
 *     "Retry analysis" is the way forward — never a silent `unclassified`;
 *   - once the verdict lands, the local event carries the real label.
 *
 * The shared expo-camera mock grants no permission, so this file overrides
 * it with a granted permission and a shutter that returns base64 — the only
 * path where capture bytes actually reach the classifier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import type { ComponentProps, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CameraOverlay } from '@/components/camera-overlay'
import { NotificationsProvider } from '@/components/notifications'
import type { ScoutEvent } from '@/constants/data'

const LOAD = { timeout: 4000 }

const ENDPOINT = 'http://proxy.test/api/classify'

const VERDICT = {
  label: 'Gray Leaf Spot',
  confidence: 0.87,
  severity: 'medium',
  notes: 'Rectangular lesions on the lower canopy.',
}

/** Tests flip `online` to simulate the proxy dropping out and coming back. */
let online = true

/** Probe requests (anything but POST) answer empty-ok; POST returns the verdict. */
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (!online) throw new Error('network down')
  if (init?.method === 'POST') return { ok: true, status: 200, json: async () => VERDICT }
  return {}
})

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

// A granted permission + a shutter that returns bytes: the real-camera path,
// and distinct bytes per shot so the images[] order is observable.
vi.mock('expo-camera', async () => {
  const React = await import('react')
  const { View } = await import('react-native')

  let shotSeq = 0
  const CameraView = React.forwardRef<unknown, { style?: unknown; children?: ReactNode }>((_props, ref) => {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: async () => {
        const seq = shotSeq++
        return { uri: `file://shot${seq}.jpg`, base64: seq % 2 === 0 ? 'Zm9uZQ==' : 'dHdv' }
      },
    }))
    return React.createElement(View, null)
  })
  CameraView.displayName = 'CameraView'

  return {
    CameraView,
    useCameraPermissions: () => [{ granted: true } as never, vi.fn(async () => null)],
  }
})

type OverlayProps = ComponentProps<typeof CameraOverlay>
type Screen = Awaited<ReturnType<typeof render>>

async function renderOverlay(props: Partial<OverlayProps> = {}): Promise<Screen> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NotificationsProvider>
        <CameraOverlay onClose={vi.fn()} {...props} />
      </NotificationsProvider>
    </QueryClientProvider>,
  )
}

/** Press the shutter once and wait for the counter to catch up. */
async function captureShot(screen: Screen, expected: string) {
  await fireEvent.press(screen.getByLabelText('Capture a shot'))
  await screen.findByText(expected, {}, LOAD)
}

/** Every classify POST the client sent, parsed. */
function postBodies(): Array<{ images: Array<{ imageBase64: string; mimeType: string }> }> {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

beforeEach(() => {
  online = true
  fetchMock.mockReset()
  process.env.EXPO_PUBLIC_AI_CLASSIFY_URL = ENDPOINT
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
})

describe('camera overlay — analyzing modal → diagnosis → submit', () => {
  it('runs every shot through one images[] call and presents the verdict', async () => {
    const onSubmit = vi.fn()
    const screen = await renderOverlay({ farmName: 'Riverbend Farm', onSubmit })

    await captureShot(screen, '1 / 5 shots')
    await captureShot(screen, '2 / 5 shots')
    expect(screen.getByText('All 2 shots go to the AI — tap Analyze crop when ready.')).toBeTruthy()

    await fireEvent.press(screen.getByLabelText('Analyze crop'))

    // The analyzing modal reports progress over the captured shots…
    await screen.findByText('Analyzing your shots', {}, LOAD)
    await screen.findByText('Reviewing 2 photos with the AI model…', {}, LOAD)

    // …and resolves into a diagnosis card, not a generic badge.
    await screen.findByText('Gray Leaf Spot', {}, LOAD)
    expect(screen.getByText('87% confidence')).toBeTruthy()
    expect(screen.getByText('Rectangular lesions on the lower canopy.')).toBeTruthy()
    expect(screen.queryByText('AI unavailable')).toBeNull()

    // One model call carried both photos, in capture order.
    const bodies = postBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].images.map((image) => image.imageBase64)).toEqual(['Zm9uZQ==', 'dHdv'])

    // Submit is live and the local row carries the real diagnosis.
    await fireEvent.press(screen.getByText('Submit to Chain'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), LOAD)
    const event = onSubmit.mock.calls[0][0] as ScoutEvent
    expect(event.images).toBe(2)
    expect(event.diagnosis).toBe('Gray Leaf Spot')
    expect(event.severity).toBe('medium')
    expect(event.confidence).toBeCloseTo(0.87, 5)
    expect(event.anchor?.aiLabel).toBe('Gray Leaf Spot')
    expect(event.anchor?.photoUris).toEqual(['file://shot0.jpg', 'file://shot1.jpg'])
  })

  it('keeps submit locked while a configured proxy owes a diagnosis', async () => {
    const onSubmit = vi.fn()
    online = false // probe fails and classify fails: configured, but unreachable
    const screen = await renderOverlay({ farmName: 'Riverbend Farm', onSubmit })

    await captureShot(screen, '1 / 5 shots')
    await fireEvent.press(screen.getByLabelText('Analyze crop'))

    // The result card reports the missing diagnosis instead of inventing one…
    await screen.findByText('1 photo captured', {}, LOAD)
    expect(screen.getByText('AI unavailable')).toBeTruthy()
    expect(screen.getByText('No diagnosis yet — retry the analysis before submitting.')).toBeTruthy()

    // …and submit does nothing — no silent `unclassified` row.
    await fireEvent.press(screen.getByText('Submit to Chain'))
    expect(onSubmit).not.toHaveBeenCalled()

    // The proxy comes back: retry lands the diagnosis and unlocks submit.
    online = true
    await fireEvent.press(screen.getByText('Retry analysis'))
    await screen.findByText('Gray Leaf Spot', {}, LOAD)

    await fireEvent.press(screen.getByText('Submit to Chain'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), LOAD)
    const event = onSubmit.mock.calls[0][0] as ScoutEvent
    expect(event.diagnosis).toBe('Gray Leaf Spot')
    expect(event.anchor?.aiLabel).toBe('Gray Leaf Spot')
  })
})
