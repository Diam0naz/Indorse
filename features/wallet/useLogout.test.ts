/**
 * features/wallet/useLogout.test.ts — the logout action
 *
 * Locks the two-effect contract: connected → disconnect THEN lock,
 * disconnected → lock only, and no button at all when there is nothing
 * to end.
 */

import { act, renderHook } from '@testing-library/react-native'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLogout } from './useLogout'

const mocks = vi.hoisted(() => ({
  walletState: 'connected' as string,
  authStatus: 'unlocked' as string,
  toggleConnection: vi.fn(async () => undefined),
  lock: vi.fn(),
}))

vi.mock('@/features/wallet/useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({ walletState: mocks.walletState, toggleConnection: mocks.toggleConnection }),
}))
vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({ status: mocks.authStatus, lock: mocks.lock }),
}))

beforeEach(() => {
  mocks.walletState = 'connected'
  mocks.authStatus = 'unlocked'
  mocks.toggleConnection.mockClear()
  mocks.lock.mockClear()
})

describe('wallet/useLogout', () => {
  it('disconnects the wallet and then re-locks the app', async () => {
    const { result } = await renderHook(() => useLogout())
    const order: string[] = []
    mocks.toggleConnection.mockImplementation(async () => {
      order.push('disconnect')
    })
    mocks.lock.mockImplementation(() => {
      order.push('lock')
    })

    await act(async () => {
      await result.current.logout()
    })

    expect(mocks.toggleConnection).toHaveBeenCalledTimes(1)
    expect(mocks.lock).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['disconnect', 'lock'])
  })

  it('locks without touching the wallet when already disconnected', async () => {
    mocks.walletState = 'disconnected'
    const { result } = await renderHook(() => useLogout())

    await act(async () => {
      await result.current.logout()
    })

    expect(mocks.toggleConnection).not.toHaveBeenCalled()
    expect(mocks.lock).toHaveBeenCalledTimes(1)
  })

  it('still locks when the disconnect fails', async () => {
    mocks.toggleConnection.mockRejectedValueOnce(new Error('wallet said no'))
    const { result } = await renderHook(() => useLogout())

    await act(async () => {
      await expect(result.current.logout()).resolves.toBeUndefined()
    })

    expect(mocks.lock).toHaveBeenCalledTimes(1)
  })

  it('hides only when disconnected with no passcode registered', async () => {
    mocks.walletState = 'connected'
    expect((await renderHook(() => useLogout())).result.current.available).toBe(true)

    mocks.walletState = 'disconnected'
    mocks.authStatus = 'unlocked'
    expect((await renderHook(() => useLogout())).result.current.available).toBe(true)

    mocks.authStatus = 'unregistered'
    expect((await renderHook(() => useLogout())).result.current.available).toBe(false)
  })

  it('reports a connecting wallet as busy', async () => {
    mocks.walletState = 'connecting'
    expect((await renderHook(() => useLogout())).result.current.busy).toBe(true)
  })
})
