/**
 * provenance.test.tsx — Provenance screen against stubbed chain reads.
 *
 * The screen composes four queries (farm, reports, escrow, harvest); here
 * they are stubbed at the hook level so the score tiers, the escrow card and
 * the address rows stay covered without a chain. The JSON-RPC read path
 * itself is exercised by scout-chain.test.tsx.
 *
 * The setup flows run for real on top of a stand-in wallet: the escrow and
 * harvest mutations build their instructions (PDAs, discriminators, encoded
 * args) and hand them to `sendTransactions`, so pressing "Fund escrow" or
 * "Release funds" here asserts the exact bytes the client would broadcast.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getBase58Decoder } from '@solana/kit'
import ProvenanceScreen from '@/app/(tabs)/farms'
import { encodeInstruction } from '@/lib/program/codec'
import { IDL_PROGRAM_ID } from '@/lib/program/idl'
import { ataPda, batchPda, escrowPda, escrowVaultPda } from '@/lib/program/pdas'
import { USDC_DEVNET } from '@/constants/tokens'
import { photoHash } from '@/features/scout/photo'

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  notificationAsync: vi.fn(),
}))

vi.mock('@react-native-clipboard/clipboard', () => ({
  default: { setString: vi.fn() },
}))

// The modals pad below the status bar; a device-like inset keeps that
// deterministic (same stand-in register-farm-modal.test uses).
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}))

// Stand-in for @wallet-ui/react-native-kit: there is no MobileWalletProvider
// in tests, so useMobileWallet, useMobileWalletSetup and every wallet
// mutation run against this account + sendTransactions spy. Everything else
// (createSolanaDevnet for the cluster config) stays real.
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

const chain = vi.hoisted(() => ({
  farm: null as null | {
    owner: string
    name: string
    latE6: number
    lngE6: number
    reportCount: number
    batchCount: number
    verifiedReportCount: number
    policyCount: number
    bump: number
  },
  farmAddress: null as string | null,
  reports: [] as { status: string }[],
  escrow: null as null | {
    amountUsdc: number
    state: string
    buyer: string
    farmer: string
    lockUntil: number
  },
  escrowAddress: null as string | null,
  batchAddress: null as string | null,
  batches: [] as { address: string; crop: string; quantityKg: number }[],
}))

vi.mock('@/features/farm/useFarmQuery', () => ({
  useFarmQuery: () => ({ farm: chain.farm, farmAddress: chain.farmAddress, state: 'ready', retry: vi.fn() }),
}))

vi.mock('@/features/reports/useReportsQuery', () => ({
  useReportsQuery: () => ({ reports: chain.reports, state: 'ready', retry: vi.fn() }),
}))

vi.mock('@/features/escrow/useEscrowQuery', () => ({
  useEscrowQuery: () => ({
    escrow: chain.escrow,
    escrowAddress: chain.escrowAddress,
    batchAddress: chain.batchAddress,
    state: 'ready',
    retry: vi.fn(),
  }),
}))

vi.mock('@/features/harvest/useHarvestQuery', () => ({
  useHarvestQuery: () => ({ batches: chain.batches, state: 'ready', retry: vi.fn() }),
}))

// The provenance screen drops the registry entry after a successful on-chain
// farm delete — capture that call without mounting the whole provider.
const registry = vi.hoisted(() => ({ removeFarm: vi.fn() }))

vi.mock('@/components/farm-registry-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/farm-registry-provider')>()
  return {
    ...actual,
    useFarmRegistry: () =>
      ({ removeFarm: registry.removeFarm }) as unknown as ReturnType<typeof actual.useFarmRegistry>,
  }
})

/** Base58 of 32 fixed bytes — round-trips through kit's strict `address()`. */
const b58 = (fill: number) => getBase58Decoder().decode(new Uint8Array(32).fill(fill))

const FARM_ADDRESS = '2fwJZcsNu2egzq2GUFtanYBE1Lf5GpMKehBszoeik6xk'
const ESCROW_ADDRESS = 'EscWr4xKp2NvQdMsJhLbWoE4uYTgXcVnAiZ9qR3sFarm'
const BATCH_ADDRESS = 'BatcH4xKp2NvQdMsJhLbWoE4uYTgXcVnAiZ9qR3sFarm'
const BUYER = b58(9)
const FARMER = b58(7)

/** 7 of 10 reports verified → score 70 → the "incomplete" banner tier. */
function registeredFarm() {
  chain.farm = {
    owner: FARMER,
    name: 'Clearwater Ridge Farm',
    latE6: 46_882_110,
    lngE6: -98_702_310,
    reportCount: 10,
    batchCount: 1,
    verifiedReportCount: 7,
    policyCount: 1,
    bump: 255,
  }
  chain.farmAddress = FARM_ADDRESS
  chain.reports = Array.from({ length: 10 }, (_, i) => ({
    status: i < 7 ? 'verified' : 'pending',
  }))
  chain.escrow = {
    amountUsdc: 45_200_000_000,
    state: 'funded',
    buyer: BUYER,
    farmer: FARMER,
    lockUntil: Math.floor(Date.now() / 1000) + 86_400,
  }
  chain.escrowAddress = ESCROW_ADDRESS
  chain.batchAddress = BATCH_ADDRESS
  chain.batches = [{ address: BATCH_ADDRESS, crop: 'Sunflower', quantityKg: 45200 }]
}

/** A registered farm with no escrow yet — the batches decide the setup CTA. */
function farmAwaitingEscrow(batches: { address: string; crop: string; quantityKg: number }[]) {
  chain.farm = {
    owner: FARMER,
    name: 'Clearwater Ridge Farm',
    latE6: 46_882_110,
    lngE6: -98_702_310,
    reportCount: 10,
    batchCount: batches.length,
    verifiedReportCount: 7,
    policyCount: 1,
    bump: 255,
  }
  chain.farmAddress = FARM_ADDRESS
  chain.reports = Array.from({ length: 10 }, (_, i) => ({
    status: i < 7 ? 'verified' : 'pending',
  }))
  chain.escrow = null
  chain.escrowAddress = null
  chain.batchAddress = null
  chain.batches = batches
}

function clearChain() {
  chain.farm = null
  chain.farmAddress = null
  chain.reports = []
  chain.escrow = null
  chain.escrowAddress = null
  chain.batchAddress = null
  chain.batches = []
}

const LOAD = { timeout: 3000 }

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProvenanceScreen />
    </QueryClientProvider>,
  )
}

/** The single instruction handed to the wallet, with its address list. */
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
  wallet.address = null
  wallet.sendTransactions.mockClear()
  registry.removeFarm.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  wallet.address = null
})

describe('provenance screen', () => {
  it('renders the provenance score, escrow and addresses', async () => {
    registeredFarm()
    const screen = await renderScreen()

    await screen.findByText('70', {}, LOAD)
    expect(screen.getByText('Sunflower · 45,200 kg')).toBeTruthy()
    expect(screen.getByText('Fully funded')).toBeTruthy()
    expect(screen.getByText('Farm Record PDA')).toBeTruthy()
    expect(screen.getByText('Release Conditions')).toBeTruthy()
  })

  it('flags incomplete evidence while the score sits below 80', async () => {
    registeredFarm()
    const screen = await renderScreen()

    await screen.findByText('Evidence incomplete', {}, LOAD)
  })

  it('shows the empty states until a farm and escrow exist', async () => {
    clearChain()
    const screen = await renderScreen()

    await screen.findByText('Score at risk', {}, LOAD)
    expect(screen.getByText('No active escrow')).toBeTruthy()
    expect(screen.getByText('Nothing deployed yet')).toBeTruthy()
    expect(screen.queryByText('Set up escrow')).toBeNull()
    expect(screen.queryByText('Log a harvest batch')).toBeNull()
  })
})

describe('escrow setup', () => {
  it('offers the step the farm is actually ready for', async () => {
    // No farm yet → nothing to set up against.
    clearChain()
    const noFarm = await renderScreen()
    await noFarm.findByText('No active escrow', {}, LOAD)
    expect(noFarm.queryByText('Set up escrow')).toBeNull()
    expect(noFarm.queryByText('Log a harvest batch')).toBeNull()

    // Farm, but no harvest batch → escrow has nothing to attach to.
    farmAwaitingEscrow([])
    const noBatch = await renderScreen()
    await noBatch.findByText('Log a harvest batch', {}, LOAD)
    expect(noBatch.getByText(/Escrow attaches to a harvest batch/)).toBeTruthy()
    expect(noBatch.queryByText('Set up escrow')).toBeNull()

    // Farm with a batch → the escrow form is one tap away.
    farmAwaitingEscrow([{ address: BATCH_ADDRESS, crop: 'Sunflower', quantityKg: 45200 }])
    const withBatch = await renderScreen()
    await withBatch.findByText('Set up escrow', {}, LOAD)
    expect(withBatch.queryByText('Log a harvest batch')).toBeNull()
  })

  it('funds an escrow against the newest batch', async () => {
    farmAwaitingEscrow([{ address: BATCH_ADDRESS, crop: 'Sunflower', quantityKg: 45200 }])
    wallet.address = BUYER
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByText('Set up escrow', {}, LOAD))
    await screen.findByText(/Lock USDC against this batch/, {}, LOAD)

    // Freeze time so lock_until (now + 7 days) is byte-for-byte predictable.
    const when = new Date('2026-01-02T03:04:05.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(when)

    await fireEvent.changeText(screen.getByLabelText('Amount (USDC)'), '250')
    await fireEvent.changeText(screen.getByLabelText('Lock (days)'), '7')
    await fireEvent.press(screen.getByLabelText('Fund escrow'))

    await waitFor(() => expect(wallet.sendTransactions).toHaveBeenCalledTimes(1))
    const ix = sentInstruction()
    const lockUntil = Math.floor(when.getTime() / 1000) + 7 * 86_400

    expect(Array.from(ix.data)).toEqual(
      Array.from(encodeInstruction('create_escrow', { amountUsdc: 250_000_000, lockUntil })),
    )
    expect(ix.accounts.map((m) => m.address)).toEqual([
      BUYER,
      BATCH_ADDRESS,
      await escrowPda(BATCH_ADDRESS),
      await escrowVaultPda(BATCH_ADDRESS),
      await ataPda(BUYER, USDC_DEVNET),
      USDC_DEVNET,
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      '11111111111111111111111111111111',
      'SysvarRent111111111111111111111111111111111',
    ])

    // Success closes the modal again.
    vi.useRealTimers()
    await waitFor(() => expect(screen.queryByLabelText('Fund escrow')).toBeNull())
  })

  it('tells a guest plainly that an escrow needs a wallet', async () => {
    farmAwaitingEscrow([{ address: BATCH_ADDRESS, crop: 'Sunflower', quantityKg: 45200 }])
    wallet.address = null
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByText('Set up escrow', {}, LOAD))
    await screen.findByText('Connect a wallet to fund an escrow.', {}, LOAD)

    const submit = screen.getByLabelText('Fund escrow')
    expect(submit.props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(submit)
    expect(wallet.sendTransactions).not.toHaveBeenCalled()
  })

  it('lets the buyer cancel while the lock still holds', async () => {
    registeredFarm()
    wallet.address = BUYER
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByText('Cancel & refund', {}, LOAD))

    await waitFor(() => expect(wallet.sendTransactions).toHaveBeenCalledTimes(1))
    const ix = sentInstruction()
    expect(Array.from(ix.data)).toEqual(Array.from(encodeInstruction('cancel_escrow', {})))
    expect(ix.accounts.map((m) => m.address)).toEqual([
      BUYER,
      await escrowPda(BATCH_ADDRESS),
      await escrowVaultPda(BATCH_ADDRESS),
      await ataPda(BUYER, USDC_DEVNET),
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ])
  })

  it('hides the cancel once the lock has expired', async () => {
    registeredFarm()
    chain.escrow = {
      amountUsdc: 45_200_000_000,
      state: 'funded',
      buyer: BUYER,
      farmer: FARMER,
      lockUntil: Math.floor(Date.now() / 1000) - 86_400,
    }
    wallet.address = BUYER
    const screen = await renderScreen()

    await screen.findByText('Release Conditions', {}, LOAD)
    expect(screen.queryByText('Cancel & refund')).toBeNull()
    expect(screen.getByText('No conditions attached — funds release on delivery.')).toBeTruthy()
  })

  it('lets the farmer release the funded escrow', async () => {
    registeredFarm()
    wallet.address = FARMER
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByText('Release funds', {}, LOAD))

    await waitFor(() => expect(wallet.sendTransactions).toHaveBeenCalledTimes(1))
    const ix = sentInstruction()
    expect(Array.from(ix.data)).toEqual(Array.from(encodeInstruction('release_escrow', {})))
    expect(ix.accounts.map((m) => m.address)).toEqual([
      FARMER,
      await escrowPda(BATCH_ADDRESS),
      await escrowVaultPda(BATCH_ADDRESS),
      await ataPda(FARMER, USDC_DEVNET),
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ])
  })
})

describe('harvest batch setup', () => {
  it('logs a batch the escrow can attach to', async () => {
    farmAwaitingEscrow([])
    wallet.address = FARMER
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByText('Log a harvest batch', {}, LOAD))
    await screen.findByText(/Record what came off the field/, {}, LOAD)

    // The batch URI embeds the clock — freeze it so the digest is predictable.
    const when = new Date('2026-01-02T03:04:05.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(when)

    await fireEvent.changeText(screen.getByLabelText('Crop'), 'Sunflower')
    await fireEvent.changeText(screen.getByLabelText('Quantity (kg)'), '640')
    await fireEvent.changeText(screen.getByLabelText('Latitude'), '46.882110')
    await fireEvent.changeText(screen.getByLabelText('Longitude'), '-98.702310')
    await fireEvent.press(screen.getByLabelText('Log batch'))

    await waitFor(() => expect(wallet.sendTransactions).toHaveBeenCalledTimes(1))
    const ix = sentInstruction()
    const uri = `indorse://harvest/${when.getTime()}`
    const digest = await photoHash(uri)

    expect(digest).toHaveLength(32)
    expect(Array.from(ix.data)).toEqual(
      Array.from(
        encodeInstruction('submit_harvest_batch', {
          photoHash: digest,
          uri,
          latE6: 46_882_110,
          lngE6: -98_702_310,
          crop: 'Sunflower',
          quantityKg: 640,
          notes: '',
        }),
      ),
    )
    expect(ix.accounts.map((m) => m.address)).toEqual([
      FARMER,
      FARM_ADDRESS,
      await batchPda(FARM_ADDRESS, 0),
      '11111111111111111111111111111111',
    ])

    vi.useRealTimers()
    await waitFor(() => expect(screen.queryByLabelText('Log batch')).toBeNull())
  })

  it('requires coordinates before a batch can be logged', async () => {
    farmAwaitingEscrow([])
    wallet.address = FARMER
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByText('Log a harvest batch', {}, LOAD))
    await fireEvent.changeText(await screen.findByLabelText('Crop'), 'Sunflower')
    await fireEvent.changeText(screen.getByLabelText('Quantity (kg)'), '640')
    await fireEvent.press(screen.getByLabelText('Log batch'))

    // lat/lng stay empty → the validator's range message, no transaction.
    await screen.findByText('Latitude must be between -90 and 90', {}, LOAD)
    expect(wallet.sendTransactions).not.toHaveBeenCalled()
  })
})

describe('farm lifecycle', () => {
  it('tells a guest plainly that deleting the farm needs the owner wallet', async () => {
    registeredFarm()
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByTestId('delete-farm-open', {}, LOAD))
    await screen.findByText('Delete this farm?', {}, LOAD)

    const confirm = screen.getByTestId('delete-farm-confirm')
    expect(confirm.props.accessibilityState?.disabled).toBe(true)
    await fireEvent.press(confirm)
    expect(wallet.sendTransactions).not.toHaveBeenCalled()
    expect(registry.removeFarm).not.toHaveBeenCalled()
  })

  it('sends delete_farm for the owner and drops the registry entry', async () => {
    registeredFarm()
    wallet.address = FARMER
    const screen = await renderScreen()

    await fireEvent.press(await screen.findByTestId('delete-farm-open', {}, LOAD))
    await screen.findByText('Delete this farm?', {}, LOAD)
    await fireEvent.press(screen.getByTestId('delete-farm-confirm'))

    await waitFor(() => expect(wallet.sendTransactions).toHaveBeenCalledTimes(1), LOAD)
    const ix = sentInstruction()
    expect(Array.from(ix.data)).toEqual(Array.from(encodeInstruction('delete_farm', {})))
    // The program re-derives ["farm", owner] from these two accounts.
    expect(ix.accounts.map((m) => m.address)).toEqual([FARM_ADDRESS, FARMER])

    await waitFor(() => expect(registry.removeFarm).toHaveBeenCalledWith(FARM_ADDRESS))
    // The sheet closes once the chain write lands.
    await waitFor(() => expect(screen.queryByTestId('delete-farm-confirm')).toBeNull())
  })
})
