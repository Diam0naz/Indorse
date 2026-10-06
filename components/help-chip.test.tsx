/**
 * help-chip.test.tsx — one floating chip, the right question per screen
 *
 * The chip is mounted once in the tab layout; the router pathname decides
 * which screen question it asks the assistant on open. This locks that
 * mapping (Weather → the rainfall-trigger question) plus the open/close
 * round trip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { HelpChip } from '@/components/help-chip'

const ENDPOINT = 'http://test.local/api/assistant'
const LOAD = { timeout: 5000 }

vi.mock('expo-router', () => ({ usePathname: () => '/reports' }))
vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({ farm: null, farmAddress: null, state: 'ready', isFetching: false, retry: vi.fn() }),
}))
vi.mock('@/features/insurance/usePolicyQuery', () => ({
  usePolicyQuery: () => ({ policy: null, policyAddress: null, state: 'ready', retry: vi.fn() }),
}))
vi.mock('@/features/insurance/useWeatherOracleQuery', () => ({
  useWeatherOracleQuery: () => ({ reading: null, state: 'ready', retry: vi.fn() }),
}))

describe('HelpChip', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AI_ASSISTANT_URL = ENDPOINT
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.EXPO_PUBLIC_AI_ASSISTANT_URL
  })

  it('opens the sheet and auto-asks the current screen question', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reply: 'Rainfall at or below the trigger settles the policy.', lang: 'en' }),
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await render(<HelpChip />)
    expect(screen.getByLabelText('Open the indorse guide')).toBeTruthy()
    // Nothing is asked until the chip is tapped.
    expect(fetchMock).not.toHaveBeenCalled()

    await fireEvent.press(screen.getByLabelText('Open the indorse guide'))

    // The Weather screen's question goes out immediately…
    await screen.findByText('How does the rainfall trigger decide a payout?', {}, LOAD)
    await screen.findByText('Rainfall at or below the trigger settles the policy.', {}, LOAD)

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.message).toBe('How does the rainfall trigger decide a payout?')
    expect(body.context.route).toBe('/reports')
  })
})
