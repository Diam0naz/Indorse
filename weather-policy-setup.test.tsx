/**
 * weather-policy-setup.test.tsx — Underwriting parametric cover
 *
 * The Weather screen's empty state is the entry point: with a farm on chain
 * it offers "Underwrite policy", which opens a form for crop, coverage,
 * premium, the rainfall trigger (mm — stored as mm × 10) and the season
 * window (ISO dates → unix seconds). Submitting runs the real
 * `useCreatePolicy` against a stand-in wallet and asserts the exact
 * instruction bytes, so the whole client path — PDAs, discriminator, arg
 * encoding — is covered without a device.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getBase58Decoder } from '@solana/kit'
import WeatherScreen from '@/app/(tabs)/reports'
import { encodeInstruction } from '@/lib/program/codec'
import { IDL_PROGRAM_ID } from '@/lib/program/idl'
import { ataPda, insuranceVaultPda, policyPda, treasuryPda } from '@/lib/program/pdas'
import { USDC_DEVNET } from '@/constants/tokens'
import type { Policy } from '@/features/insurance/types'

// Device-like safe-area inset for the modal header (as in register-farm-modal.test).
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}))

// Stand-in wallet: no MobileWalletProvider in tests, so the real
// useCreatePolicy builds its instruction and hands it to this spy. Everything
// else (createSolanaDevnet for the cluster config) stays real.
const wallet = vi.hoisted(() => ({
  address: null as string | null,
  sendTransactions: vi.fn(async (_instructions: unknown[]) => undefined),
}))

vi.mock('@wallet-ui/react-native-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wallet-ui/react-native-kit')>()
  return {
    ...actual,
    useMobileWallet: () => ({
      account: wallet.address ? { address: wallet.address } : null,
      sendTransactions: wallet.sendTransactions,
    }),
  }
})

const weather = vi.hoisted(() => ({
  farmAddress: null as string | null,
  policyCount: 2,
  policy: null as null | Policy,
  policyAddress: null as string | null,
}))

vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({
    farm: weather.farmAddress
      ? {
          owner: 'Farmer111',
          name: 'Clearwater Ridge Farm',
          latE6: 46_882_110,
          lngE6: -98_702_310,
          reportCount: 0,
          batchCount: 0,
          verifiedReportCount: 0,
          policyCount: weather.policyCount,
          bump: 255,
        }
      : null,
    farmAddress: weather.farmAddress,
    state: 'ready',
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/insurance/usePolicyQuery', () => ({
  usePolicyQuery: () => ({
    policy: weather.policy,
    policyAddress: weather.policyAddress,
    state: 'ready',
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/insurance/useWeatherOracleQuery', () => ({
  useWeatherOracleQuery: () => ({ reading: null, state: 'ready', retry: vi.fn() }),
}))

/** Base58 of 32 fixed bytes — round-trips through kit's strict `address()`. */
const b58 = (fill: number) => getBase58Decoder().decode(new Uint8Array(32).fill(fill))

const FARM_ADDRESS = '2fwJZcsNu2egzq2GUFtanYBE1Lf5GpMKehBszoeik6xk'
const FARMER = b58(7)

const LOAD = { timeout: 3000 }

function renderWeather() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WeatherScreen />
    </QueryClientProvider>,
  )
}

function sentInstruction() {
  expect(wallet.sendTransactions).toHaveBeenCalledTimes(1)
  const [instructions] = wallet.sendTransactions.mock.calls[0]
  expect(instructions).toHaveLength(1)
  const ix = instructions[0] as {
    programAddress: string
    accounts: { address: string }[]
    data: Uint8Array
  }
  expect(ix.programAddress).toBe(IDL_PROGRAM_ID)
  return ix
}

beforeEach(() => {
  weather.farmAddress = FARM_ADDRESS
  weather.policy = null
  weather.policyAddress = null
  wallet.address = null
  wallet.sendTransactions.mockClear()
})

afterEach(() => {
  wallet.address = null
})

describe('weather policy setup', () => {
  it('offers underwriting only when the farm exists', async () => {
    weather.farmAddress = null
    const noFarm = await renderWeather()
    await noFarm.findByText('No policy yet', {}, LOAD)
    expect(noFarm.queryByText('Underwrite policy')).toBeNull()

    weather.farmAddress = FARM_ADDRESS
    const withFarm = await renderWeather()
    await withFarm.findByText('No policy yet', {}, LOAD)
    expect(withFarm.getByText('Underwrite policy')).toBeTruthy()
  })

  it('tells a guest plainly that cover needs a wallet', async () => {
    wallet.address = null
    const screen = await renderWeather()

    await fireEvent.press(await screen.findByText('Underwrite policy', {}, LOAD))
    await screen.findByText(/A parametric policy pays out in USDC/, {}, LOAD)
    await screen.findByText('Connect a wallet to underwrite — policies live on-chain.', {}, LOAD)

    const submit = screen.getByTestId('underwrite-submit')
    expect(submit.props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(submit)
    expect(wallet.sendTransactions).not.toHaveBeenCalled()
  })

  it('reports field errors before anything touches the wallet', async () => {
    wallet.address = FARMER
    const screen = await renderWeather()

    await fireEvent.press(await screen.findByText('Underwrite policy', {}, LOAD))
    const submit = await screen.findByTestId('underwrite-submit', {}, LOAD)
    await fireEvent.press(submit)

    await screen.findByText('Crop type is required', {}, LOAD)
    expect(screen.getByText('Coverage amount must be greater than zero')).toBeTruthy()
    expect(screen.getByText('Premium must be greater than zero')).toBeTruthy()
    expect(screen.getByText('Season end must be after season start')).toBeTruthy()
    expect(wallet.sendTransactions).not.toHaveBeenCalled()
  })

  it('flags a season window that runs backwards', async () => {
    wallet.address = FARMER
    const screen = await renderWeather()

    await fireEvent.press(await screen.findByText('Underwrite policy', {}, LOAD))
    await fireEvent.changeText(await screen.findByLabelText('Crop'), 'Sunflower')
    await fireEvent.changeText(screen.getByLabelText('Coverage (USDC)'), '500')
    await fireEvent.changeText(screen.getByLabelText('Premium (USDC)'), '25')
    await fireEvent.changeText(screen.getByLabelText('Rainfall trigger (mm)'), '50')
    await fireEvent.changeText(screen.getByLabelText('Season start'), '2026-10-01')
    await fireEvent.changeText(screen.getByLabelText('Season end'), '2026-04-01')
    await fireEvent.press(screen.getByTestId('underwrite-submit'))

    await screen.findByText('Season end must be after season start', {}, LOAD)
    expect(wallet.sendTransactions).not.toHaveBeenCalled()
  })

  it('builds create_policy with the documented units and derived PDAs', async () => {
    wallet.address = FARMER
    const screen = await renderWeather()

    await fireEvent.press(await screen.findByText('Underwrite policy', {}, LOAD))
    await fireEvent.changeText(await screen.findByLabelText('Crop'), 'Sunflower')
    await fireEvent.changeText(screen.getByLabelText('Coverage (USDC)'), '500')
    await fireEvent.changeText(screen.getByLabelText('Premium (USDC)'), '25')
    // The form takes whole millimetres; the program stores mm × 10.
    await fireEvent.changeText(screen.getByLabelText('Rainfall trigger (mm)'), '50')
    await fireEvent.changeText(screen.getByLabelText('Season start'), '2026-04-01')
    await fireEvent.changeText(screen.getByLabelText('Season end'), '2026-10-01')
    await fireEvent.press(screen.getByTestId('underwrite-submit'))

    await waitFor(() => expect(wallet.sendTransactions).toHaveBeenCalledTimes(1))
    const ix = sentInstruction()

    expect(Array.from(ix.data)).toEqual(
      Array.from(
        encodeInstruction('create_policy', {
          crop: 'Sunflower',
          coverageUsdc: 500_000_000,
          premiumUsdc: 25_000_000,
          triggerThresholdMm: 500,
          seasonStart: Math.floor(Date.parse('2026-04-01') / 1000),
          seasonEnd: Math.floor(Date.parse('2026-10-01') / 1000),
        }),
      ),
    )
    expect(ix.accounts.map((m) => m.address)).toEqual([
      FARMER,
      FARM_ADDRESS,
      await policyPda(FARM_ADDRESS, weather.policyCount),
      await insuranceVaultPda(FARM_ADDRESS, weather.policyCount),
      await ataPda(FARMER, USDC_DEVNET),
      USDC_DEVNET,
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      '11111111111111111111111111111111',
      'SysvarRent111111111111111111111111111111111',
    ])

    // Success closes the form again.
    await waitFor(() => expect(screen.queryByTestId('underwrite-submit')).toBeNull())
  })
})

describe('revoking an active policy', () => {
  const DAY = 86_400

  /** The current policy (index = policyCount - 1) in a given season state. */
  function activePolicy(seasonEndSeconds: number) {
    weather.policy = {
      farm: FARM_ADDRESS,
      farmer: FARMER,
      index: weather.policyCount - 1,
      crop: 'Sunflower',
      coverageUsdc: 500_000_000,
      premiumUsdc: 25_000_000,
      triggerThresholdMm: 500,
      seasonStart: Math.floor(Date.now() / 1000) - 30 * DAY,
      seasonEnd: seasonEndSeconds,
      verifiedReportsAtCreation: 3,
      state: 'active',
      bump: 254,
    }
    weather.policyAddress = b58(5)
  }

  it('offers revocation while the season is still running', async () => {
    activePolicy(Math.floor(Date.now() / 1000) + 30 * DAY)
    const screen = await renderWeather()

    await screen.findByText('Revoke policy', {}, LOAD)
    await screen.findByText('The premium returns to your wallet; the policy and its vault close.', {}, LOAD)
  })

  it('hides revocation once the season has ended — settlement takes over', async () => {
    activePolicy(Math.floor(Date.now() / 1000) - DAY)
    const screen = await renderWeather()

    await screen.findByText('Expired', {}, LOAD)
    expect(screen.queryByTestId('revoke-policy-open')).toBeNull()
  })

  it('tells a guest plainly that revoking needs the farmer wallet', async () => {
    activePolicy(Math.floor(Date.now() / 1000) + 30 * DAY)
    const screen = await renderWeather()

    await fireEvent.press(await screen.findByTestId('revoke-policy-open', {}, LOAD))
    await screen.findByText('Revoke this policy?', {}, LOAD)

    const confirm = screen.getByTestId('revoke-policy-confirm')
    expect(confirm.props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(confirm)
    expect(wallet.sendTransactions).not.toHaveBeenCalled()
  })

  it('sends revoke_policy against the current policy + vault', async () => {
    activePolicy(Math.floor(Date.now() / 1000) + 30 * DAY)
    wallet.address = FARMER
    const screen = await renderWeather()

    await fireEvent.press(await screen.findByTestId('revoke-policy-open', {}, LOAD))
    await screen.findByText('Revoke this policy?', {}, LOAD)
    await fireEvent.press(screen.getByTestId('revoke-policy-confirm'))

    await waitFor(() => expect(wallet.sendTransactions).toHaveBeenCalledTimes(1), LOAD)
    const ix = sentInstruction()
    expect(Array.from(ix.data)).toEqual(Array.from(encodeInstruction('revoke_policy', {})))

    // Most-recent policy: index = policyCount - 1. The sweep destination is
    // the canonical USDC ATA of the program-treasury PDA — derived locally,
    // no RPC read — and everything else follows the policy.
    const index = weather.policyCount - 1
    const treasury = await treasuryPda()
    expect(ix.accounts.map((m) => m.address)).toEqual([
      FARMER,
      await policyPda(FARM_ADDRESS, index),
      await insuranceVaultPda(FARM_ADDRESS, index),
      await ataPda(FARMER, USDC_DEVNET),
      treasury,
      await ataPda(treasury, USDC_DEVNET),
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ])

    // Success closes the sheet again.
    await waitFor(() => expect(screen.queryByTestId('revoke-policy-confirm')).toBeNull())
  })
})
