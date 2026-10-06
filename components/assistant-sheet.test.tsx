/**
 * assistant-sheet.test.tsx — the Ask indorse sheet, end to end against a
 * stubbed proxy
 *
 * Locks the behaviors a farmer will actually meet:
 *
 *   - the chip's screen question auto-sends and the grounded reply lands
 *     in the thread as an assistant bubble;
 *   - a typed question goes out on Send;
 *   - the context block carries this screen, this farm and the policy's
 *     real figures (cover, trigger, finalized rainfall) — and only what
 *     has settled;
 *   - every failure mode renders as its own honest note (not configured,
 *     rate limited, generic) instead of silence;
 *   - each bubble's small copy icon puts exactly that message on the
 *     clipboard and flips to the "Copied" check;
 *   - a failed ask keeps its question bubble and the error line carries
 *     a retry icon that re-asks it once — but not-configured offers none.
 *
 * The chain hooks are module-mocked: the sheet reads the same farm/policy/
 * oracle queries the Weather screen uses, and here they are fixtures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { AssistantSheet } from '@/components/assistant-sheet'
import type { Farm } from '@/features/farm/types'
import type { Policy, WeatherReading } from '@/features/insurance/types'

vi.mock('@react-native-clipboard/clipboard', () => ({ default: { setString: vi.fn() } }))

const ENDPOINT = 'http://test.local/api/assistant'
const LOAD = { timeout: 5000 }

/** Per-test control over the three mocked chain reads. */
const mockChain = vi.hoisted(() => ({
  farm: null as unknown,
  farmAddress: null as unknown,
  farmState: 'ready' as 'loading' | 'error' | 'ready',
  policy: null as unknown,
  reading: null as unknown,
}))

vi.mock('expo-router', () => ({ usePathname: () => '/farms' }))
vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({
    farm: mockChain.farm,
    farmAddress: mockChain.farmAddress,
    state: mockChain.farmState,
    isFetching: false,
    retry: vi.fn(),
  }),
}))
vi.mock('@/features/insurance/usePolicyQuery', () => ({
  usePolicyQuery: () => ({ policy: mockChain.policy, policyAddress: null, state: 'ready', retry: vi.fn() }),
}))
vi.mock('@/features/insurance/useWeatherOracleQuery', () => ({
  useWeatherOracleQuery: () => ({ reading: mockChain.reading, state: 'ready', retry: vi.fn() }),
}))

const GUEST_FARM = { farm: null, farmAddress: null, farmState: 'ready', policy: null, reading: null }

function guest() {
  Object.assign(mockChain, GUEST_FARM)
}

const REPLY = 'The provenance score is verified reports over total reports.'

function okFetch(reply = REPLY) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ reply, lang: 'en' }) } as Response)
}

/** The parsed JSON body of every POST the sheet sent. */
function postBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

describe('AssistantSheet', () => {
  beforeEach(() => {
    guest()
    process.env.EXPO_PUBLIC_AI_ASSISTANT_URL = ENDPOINT
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.EXPO_PUBLIC_AI_ASSISTANT_URL
  })

  it('auto-sends the chip question and shows the grounded reply', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    await render(<AssistantSheet initialQuestion="What does the provenance score mean?" onClose={vi.fn()} />)

    // The question lands as a user bubble, the answer as an assistant one.
    await screen.findByText('What does the provenance score mean?', {}, LOAD)
    await screen.findByText(REPLY, {}, LOAD)
    expect(screen.queryByText('Thinking…')).toBeNull()

    const bodies = postBodies(fetchMock)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      message: 'What does the provenance score mean?',
      lang: 'en',
      context: { route: '/farms', hasFarm: false },
    })
  })

  it('sends a typed question on Send', async () => {
    const fetchMock = okFetch('The buyer locks USDC against one batch until the lock expires.')
    vi.stubGlobal('fetch', fetchMock)
    await render(<AssistantSheet onClose={vi.fn()} />)

    // No initial question — nothing is asked until the farmer types.
    expect(fetchMock).not.toHaveBeenCalled()

    await fireEvent.changeText(screen.getByLabelText('Ask anything about the app…'), 'How does escrow work?')
    await fireEvent.press(screen.getByLabelText('Send'))

    await screen.findByText('How does escrow work?', {}, LOAD)
    await screen.findByText('The buyer locks USDC against one batch until the lock expires.', {}, LOAD)
    expect(postBodies(fetchMock)[0]).toMatchObject({ message: 'How does escrow work?' })
  })

  it('carries the farm name and the policy figures once they have settled', async () => {
    const farm: Farm = {
      owner: 'Farmer111',
      name: 'Blue Berry Farms',
      latE6: 46_882_100,
      lngE6: -98_702_300,
      reportCount: 6,
      batchCount: 1,
      verifiedReportCount: 5,
      policyCount: 1,
      index: 0,
      bump: 254,
      address: 'FarmPDA1',
    }
    const policy: Policy = {
      farm: 'FarmPDA1',
      farmer: 'Farmer111',
      index: 0,
      crop: 'Maize',
      coverageUsdc: 15_000_000,
      premiumUsdc: 750_000,
      triggerThresholdMm: 1200,
      seasonStart: 1_760_000_000,
      seasonEnd: 1_762_000_000,
      verifiedReportsAtCreation: 5,
      state: 'active',
      bump: 254,
      address: 'PolicyPDA1',
    }
    const reading: WeatherReading = {
      farm: 'FarmPDA1',
      seasonStart: 1_760_000_000,
      totalRainfallMm: 850,
      readingTimestamp: 1_761_000_000,
      finalized: true,
      readings: [],
      bump: 254,
      address: 'OraclePDA1',
    }
    Object.assign(mockChain, { farm, farmAddress: 'FarmPDA1', farmState: 'ready', policy, reading })

    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    await render(<AssistantSheet initialQuestion="Is my policy at risk?" onClose={vi.fn()} />)
    await screen.findByText(REPLY, {}, LOAD)

    // Units match the Weather screen: cover in dollars, trigger/rainfall in mm.
    expect(postBodies(fetchMock)[0]).toMatchObject({
      context: {
        route: '/farms',
        hasFarm: true,
        farmName: 'Blue Berry Farms',
        policy: { status: 'active', coverUsdc: 15, triggerMm: 120, totalMm: 85 },
      },
    })
  })

  it('copies any message to the clipboard from its small icon', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    await render(<AssistantSheet initialQuestion="What does escrow hold?" onClose={vi.fn()} />)
    await screen.findByText(REPLY, {}, LOAD)

    // Both turns carry a copy icon.
    expect(await screen.findAllByLabelText('Copy')).toHaveLength(2)

    // The question's icon copies the question…
    await fireEvent.press(screen.getAllByLabelText('Copy')[0])
    expect(Clipboard.setString).toHaveBeenLastCalledWith('What does escrow hold?')
    // …and the reply's icon copies the reply (only the pressed one shows the check).
    expect(screen.getAllByLabelText('Copy')).toHaveLength(1)
    await fireEvent.press(screen.getAllByLabelText('Copy')[0])
    expect(Clipboard.setString).toHaveBeenLastCalledWith(REPLY)
    expect(screen.getByLabelText('Copied')).toBeTruthy()
  })

  it('re-asks the failed question from the retry icon, without duplicating it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response))
    await render(<AssistantSheet initialQuestion="Will the bundle sync?" onClose={vi.fn()} />)
    await screen.findByText('The guide could not answer — try again.', {}, LOAD)

    // The failed question stays one bubble and the honest error offers a retry.
    expect(screen.getAllByText('Will the bundle sync?')).toHaveLength(1)

    // The second attempt succeeds: same question, answered, icon gone.
    vi.stubGlobal('fetch', okFetch('It syncs once a batch is verified.'))
    await fireEvent.press(screen.getByLabelText('Retry'))
    await screen.findByText('It syncs once a batch is verified.', {}, LOAD)
    expect(screen.getAllByText('Will the bundle sync?')).toHaveLength(1)
    expect(screen.queryByLabelText('Retry')).toBeNull()
  })

  it('keeps an earlier question’s retry alive after a later question succeeds', async () => {
    // Regression: the error lived in one shared slot, so typing a second
    // question cleared the first one's error line. The first question then
    // sat on screen answered by nothing, with no retry — exactly what the
    // live screenshot showed ("What should I do first on this screen?"
    // unanswered, the next user message following straight after it).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ reply: 'Escrow holds USDC.', lang: 'en' }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)
    await render(<AssistantSheet onClose={vi.fn()} />)

    // Question one fails.
    await fireEvent.changeText(screen.getByLabelText('Ask anything about the app…'), 'How do I set up a bounty?')
    await fireEvent.press(screen.getByLabelText('Send'))
    await screen.findByText('The guide could not answer — try again.', {}, LOAD)

    // Question two succeeds.
    await fireEvent.changeText(screen.getByLabelText('Ask anything about the app…'), 'What is escrow?')
    await fireEvent.press(screen.getByLabelText('Send'))
    await screen.findByText('Escrow holds USDC.', {}, LOAD)

    // Both questions are present, and the FIRST still owns its error and retry.
    expect(screen.getAllByText('How do I set up a bounty?')).toHaveLength(1)
    expect(screen.getByText('The guide could not answer — try again.')).toBeTruthy()
    expect(screen.getAllByLabelText('Retry')).toHaveLength(1)

    // Retrying it re-asks that question specifically, not the newer one.
    vi.stubGlobal('fetch', okFetch('indorse has no bounties.'))
    await fireEvent.press(screen.getByLabelText('Retry'))
    await screen.findByText('indorse has no bounties.', {}, LOAD)
    expect(screen.getAllByText('How do I set up a bounty?')).toHaveLength(1)
    expect(screen.queryByLabelText('Retry')).toBeNull()
  })

  it('says so honestly when the endpoint is not configured', async () => {
    delete process.env.EXPO_PUBLIC_AI_ASSISTANT_URL
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    await render(<AssistantSheet initialQuestion="What is this?" onClose={vi.fn()} />)
    await screen.findByText('The assistant endpoint is not configured.', {}, LOAD)
    expect(fetchMock).not.toHaveBeenCalled()
    // No retry — none could help until the endpoint exists.
    expect(screen.queryByLabelText('Retry')).toBeNull()
  })

  it('shows the rate-limit note on 429 and the generic note on 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as Response))
    const rateScreen = await render(<AssistantSheet initialQuestion="One more question" onClose={vi.fn()} />)
    await rateScreen.findByText('Too many questions — wait a minute and try again.', {}, LOAD)
    expect(rateScreen.getByText('One more question')).toBeTruthy()
    rateScreen.unmount()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response))
    const failScreen = await render(<AssistantSheet initialQuestion="And another" onClose={vi.fn()} />)
    await failScreen.findByText('The guide could not answer — try again.', {}, LOAD)
    failScreen.unmount()
  })
})
