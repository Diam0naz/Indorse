/**
 * camera-diagnosis-notification.test.tsx — The AI's verdict reaches the farmer
 *
 * A scan used to end silently: the classification appeared on the done card
 * and vanished once the overlay closed. The diagnosis is now posted to the
 * in-app notification feed (the bell in the header), so the farmer reads the
 * model's call without re-opening the scan.
 *
 * Two honesty rules are asserted here:
 *
 *   - a verdict that landed posts `AI diagnosis: {label}` with the model's
 *     notes as the body, typed `alert` for high/medium severity and `scout`
 *     otherwise (both gated by the diagnosis preference switch — the default
 *     settings context has it on);
 *   - no verdict (classify returned null) posts nothing — the feed never
 *     invents a diagnosis.
 *
 * The shared expo-camera mock grants no permission, which forces the
 * simulated preview whose shots carry no bytes — and only real bytes reach
 * the classifier. This file therefore overrides expo-camera with a granted
 * permission and a shutter that returns base64, and mocks the classifier
 * hook itself so the verdict is deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CameraOverlay } from '@/components/camera-overlay'
import { NotificationsProvider, useNotifications } from '@/components/notifications'
import type { ClassificationResult } from '@/features/ai/types'

const LOAD = { timeout: 4000 }

const classifier = vi.hoisted(() => ({
  classify: vi.fn<(images: string[]) => Promise<ClassificationResult | null>>(),
}))

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

// Deterministic verdicts — the real hook needs an HTTP endpoint, and the
// classifier only ever runs on real capture bytes.
vi.mock('@/features/ai/usePhotoClassification', () => ({
  usePhotoClassification: () => ({
    classification: null,
    classifying: false,
    error: null,
    classify: classifier.classify,
    reset: vi.fn(),
  }),
}))

// A granted permission + a shutter that returns bytes: the real-camera path,
// which is the only path where `handleAnalyze` calls the classifier.
vi.mock('expo-camera', async () => {
  const React = await import('react')
  const { View } = await import('react-native')

  const CameraView = React.forwardRef<unknown, { style?: unknown; children?: ReactNode }>((_props, ref) => {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: async () => ({ uri: 'file://shot.jpg', base64: 'aGVsbG8=' }),
    }))
    return React.createElement(View, null)
  })
  CameraView.displayName = 'CameraView'

  return {
    CameraView,
    useCameraPermissions: () => [{ granted: true } as never, vi.fn(async () => null)],
  }
})

/** Mirror of the feed as the provider exposes it: `type:title:body`. */
function FeedProbe() {
  const { items } = useNotifications()
  return (
    <View>
      <Text testID="feed">{items.map((n) => `${n.type}:${n.title}:${n.body}`).join('\n')}</Text>
    </View>
  )
}

type Screen = Awaited<ReturnType<typeof render>>

async function scanOneShot(): Promise<Screen> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const screen = await render(
    <QueryClientProvider client={client}>
      <NotificationsProvider>
        <FeedProbe />
        <CameraOverlay onClose={vi.fn()} />
      </NotificationsProvider>
    </QueryClientProvider>,
  )
  await fireEvent.press(screen.getByLabelText('Capture a shot'))
  await fireEvent.press(screen.getByLabelText('Analyze crop'))
  return screen
}

function feedText(screen: Screen): string {
  return screen.getByTestId('feed').props.children as string
}

beforeEach(() => {
  classifier.classify.mockReset()
  delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
})

describe('camera scan → diagnosis notification', () => {
  it('posts a high-severity verdict to the feed as an alert', async () => {
    classifier.classify.mockResolvedValue({
      label: 'Gray Leaf Spot',
      confidence: 0.91,
      severity: 'high',
      notes: 'Favorable conditions detected — scout the lower canopy today.',
    })

    const screen = await scanOneShot()

    await waitFor(() => expect(feedText(screen)).toContain('AI diagnosis: Gray Leaf Spot'), LOAD)
    const feed = feedText(screen)
    expect(feed).toContain('alert:AI diagnosis: Gray Leaf Spot:Favorable conditions detected')
    // No other scan item snuck in.
    expect(feed).not.toContain('AI diagnosis:undefined')
  })

  it('posts a low-severity verdict as a scout item, not an alert', async () => {
    classifier.classify.mockResolvedValue({
      label: 'Healthy canopy',
      confidence: 0.84,
      severity: 'low',
      notes: 'No action needed this round.',
    })

    const screen = await scanOneShot()

    await waitFor(() => expect(feedText(screen)).toContain('scout:AI diagnosis: Healthy canopy'), LOAD)
  })

  it('posts nothing when the model returns no verdict', async () => {
    classifier.classify.mockResolvedValue(null)

    const screen = await scanOneShot()

    // The done card still lands…
    await screen.findByText('1 photo captured', {}, LOAD)
    // …but the feed never gains a diagnosis.
    expect(feedText(screen)).not.toContain('AI diagnosis:')
  })
})
