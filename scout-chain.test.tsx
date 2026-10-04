/**
 * scout-chain.test.tsx — The scout tab against a stubbed JSON-RPC endpoint.
 *
 * Renders the real screen with a connected wallet and drives the whole read
 * path: farm PDA derivation → getAccountInfo → codec decode → getMultipleAccounts
 * → log rows. `fetch` is stubbed at the JSON-RPC level, so this exercises the
 * same code production runs (kit transport included) without a network.
 *
 * Three states: registered farm (on-chain log), unregistered wallet
 * (register prompt) and unreachable RPC (error + retry).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getBase64Decoder } from '@solana/kit'
import ScoutingScreen from '@/app/(tabs)/index'
import { encodeAccount } from '@/lib/program/codec'
import { demoPhotoHash } from '@/features/reports/types'
import { PROGRAM_ID } from '@/constants/app-config'

const OWNER = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const FARM_ACC = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const LOAD = { timeout: 4000 }

const wallet = vi.hoisted(() => ({
  address: 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht' as string | null,
}))

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 0, Medium: 1, Heavy: 2 },
  NotificationFeedbackType: { Success: 0, Warning: 1, Error: 2 },
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: {},
    walletState: wallet.address ? 'connected' : 'disconnected',
    address: wallet.address,
    toggleConnection: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}))

const base64 = getBase64Decoder()

/** JSON-RPC account wrapper — the shape `encoding: 'base64'` returns. */
function rpcAccount(bytes: Uint8Array) {
  return {
    data: [base64.decode(bytes), 'base64'],
    executable: false,
    lamports: 2_000_000,
    owner: PROGRAM_ID,
    rentEpoch: 0,
    space: bytes.length,
  }
}

const FARM = {
  owner: OWNER,
  name: 'Green Valley',
  latE6: 46_882_100,
  lngE6: -98_702_300,
  reportCount: 2,
  batchCount: 0,
  verifiedReportCount: 1,
  policyCount: 0,
  bump: 254,
}

const REPORTS = [
  {
    farm: FARM_ACC,
    reporter: OWNER,
    index: 0,
    photoHash: demoPhotoHash('first'),
    uri: 'https://cdn.indorse.app/scout/first.jpg',
    latE6: 46_882_110,
    lngE6: -98_702_310,
    aiLabel: 'Downy Mildew',
    status: 'verified',
    verifier: FARM_ACC,
    timestamp: 1_758_000_000,
    bump: 250,
  },
  {
    farm: FARM_ACC,
    reporter: OWNER,
    index: 1,
    photoHash: demoPhotoHash('second'),
    uri: 'https://cdn.indorse.app/scout/second.jpg',
    latE6: 46_882_120,
    lngE6: -98_702_320,
    aiLabel: 'Powdery Mildew',
    status: 'pending',
    verifier: '11111111111111111111111111111111',
    timestamp: 1_758_100_000,
    bump: 251,
  },
]

interface RpcBehavior {
  farm?: Uint8Array | null
  reports?: Uint8Array[]
  fail?: boolean
}

/** Stub `fetch` with a JSON-RPC responder for getAccountInfo / getMultipleAccounts. */
function stubRpc(behavior: RpcBehavior) {
  const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    if (behavior.fail) throw new TypeError('Network unavailable')
    const request = JSON.parse(String(init?.body ?? '{}')) as { id: number; method: string }
    const respond = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    if (request.method === 'getAccountInfo') {
      const value = behavior.farm ? rpcAccount(behavior.farm) : null
      return respond({ context: { slot: 1 }, value })
    }
    if (request.method === 'getMultipleAccounts') {
      const value = (behavior.reports ?? []).map((bytes) => rpcAccount(bytes))
      return respond({ context: { slot: 1 }, value })
    }
    return respond(null)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ScoutingScreen />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  wallet.address = OWNER
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('scout tab — chain reads', () => {
  it('renders the on-chain log for a registered farm, newest first', async () => {
    stubRpc({
      farm: encodeAccount('Farm', FARM),
      reports: REPORTS.map((report) => encodeAccount('ScoutReport', report)),
    })

    const screen = await renderScreen()

    await screen.findByText('Scouting Log · 2 On-chain', {}, LOAD)
    await screen.findByText('Downy Mildew', {}, LOAD)
    await screen.findByText('Powdery Mildew', {}, LOAD)
    await screen.findByText('Verified', {}, LOAD)
    await screen.findByText('Pending', {}, LOAD)

    // Newest report (index 1) is listed first.
    const diagnoses = screen.getAllByText(/Mildew$/)
    expect(diagnoses[0].props.children).toBe('Powdery Mildew')

    // Chain rows: no sample-data hint, no register prompt.
    expect(screen.queryByText(/Sample log/)).toBeNull()
    expect(screen.queryByText('Register your farm')).toBeNull()

    // Expanding a row shows the report PDA under the chain-specific label.
    fireEvent.press(screen.getByText('Powdery Mildew'))
    await screen.findByText('Report PDA', {}, LOAD)
  })

  it('offers the register-farm prompt when the wallet has no farm', async () => {
    const fetchMock = stubRpc({ farm: null })

    const screen = await renderScreen()

    await screen.findByText('Register your farm', {}, LOAD)
    // Two matches are expected: the empty-state action button and the docked FAB pill.
    await screen.findAllByText('Register farm', {}, LOAD)

    // The reports query never fires without a farm.
    const methods = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body ?? '{}')).method)
    expect(methods).toEqual(['getAccountInfo'])
  })

  it('surfaces an unreachable RPC as an error with a retry', async () => {
    const fetchMock = stubRpc({ fail: true })

    const screen = await renderScreen()

    await screen.findByText('Could not read the chain', {}, LOAD)
    const retry = await screen.findByText('Retry', {}, LOAD)

    fireEvent.press(retry)
    await screen.findByText('Could not read the chain', {}, LOAD)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('falls back to the sample log when the wallet is disconnected', async () => {
    wallet.address = null
    const fetchMock = stubRpc({})

    const screen = await renderScreen()

    await screen.findByText('Sclerotinia Head Rot', {}, LOAD)
    await screen.findByText(/Sample log/, {}, LOAD)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
