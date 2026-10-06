/**
 * useRegisterFarm — the one-farm-per-wallet preflight.
 *
 * A second `register_farm` for the same wallet cannot work: the farm PDA is
 * ["farm", owner], and `init` on the existing account fails with System's
 * "already in use" (custom 0x0) — which the wallet can only report as an
 * opaque failed simulation. The mutation must therefore read the PDA first
 * and reject with the real reason **without opening the wallet**, while a
 * wallet with no farm still sends exactly the one instruction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, act, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { fetchAccount, farmPda, useProgramRpc } from '@/lib/program'
import { useRegisterFarm } from '@/features/farm/useRegisterFarm'

vi.mock('@wallet-ui/react-native-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wallet-ui/react-native-kit')>()
  return { ...actual, useMobileWallet: vi.fn() }
})

vi.mock('@/lib/program', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/program')>()
  return { ...actual, fetchAccount: vi.fn(), useProgramRpc: vi.fn(() => ({})) }
})

const OWNER = 'Fy2aWfeFLUBLge74F9fVfPcA83bG1vkomBHD7rj8CLU5'
const sendTransactions = vi.fn(async (_instructions: unknown[]) => 'sig')

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

const INPUT = { name: 'Second Farm', lat: 34.052, lng: -118.243 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useMobileWallet).mockReturnValue({
    account: { address: OWNER },
    sendTransactions,
  } as unknown as ReturnType<typeof useMobileWallet>)
  vi.mocked(useProgramRpc).mockReturnValue({} as never)
})

describe('useRegisterFarm preflight', () => {
  it('rejects with the real reason when the roster slot is already occupied — without opening the wallet', async () => {
    vi.mocked(fetchAccount).mockResolvedValue({ name: 'Blue Berry Farms' } as never)
    const { result } = await renderHook(() => useRegisterFarm(), { wrapper: makeWrapper() })

    await act(async () => {
      await expect(result.current.mutateAsync(INPUT)).rejects.toThrow(/already occupied on chain/)
    })

    expect(sendTransactions).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('sends the single register_farm instruction when no farm exists', async () => {
    vi.mocked(fetchAccount).mockResolvedValue(null)
    const { result } = await renderHook(() => useRegisterFarm(), { wrapper: makeWrapper() })

    let farm!: string
    await act(async () => {
      farm = await result.current.mutateAsync(INPUT)
    })

    expect(farm).toBe(await farmPda(OWNER, 0))
    expect(sendTransactions).toHaveBeenCalledTimes(1)
    const [instructions] = sendTransactions.mock.calls[0]
    expect(instructions).toHaveLength(1)
  })
})
