import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react-native'
import { useDeviceVerification } from '@/features/wallet/useDeviceVerification'

const walletMock = vi.hoisted(() => ({
  address: 'HollowTulipAddress111111111111111111111111' as string | null,
  signIn: vi.fn(),
}))

vi.mock('./useMobileWalletSetup', () => ({
  useMobileWalletSetup: () => ({
    wallet: { signIn: walletMock.signIn },
    address: walletMock.address,
  }),
}))

const ISSUED = {
  chainId: 'solana:mainnet',
  domain: 'indorse.app',
  expirationTime: '2026-10-02T17:00:00.000Z',
  issuedAt: '2026-10-02T16:55:00.000Z',
  nonce: 'a'.repeat(32),
  statement: 'Sign in to verify this device',
  uri: 'https://indorse.app',
  version: '1',
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body } as Response
}

/** Script the two endpoints the hook talks to. */
function scriptFetch(options?: { nonceStatus?: number; verifyStatus?: number; verdict?: unknown }) {
  const nonceStatus = options?.nonceStatus ?? 200
  const verifyStatus = options?.verifyStatus ?? 200
  const verdict = options?.verdict ?? { verified: true, address: walletMock.address, method: 'allowlist' }

  return vi.fn(async (url: string) => {
    if (url.endsWith('/api/siws/nonce'))
      return jsonResponse(nonceStatus, nonceStatus === 200 ? ISSUED : { error: 'nope' })
    if (url.endsWith('/api/siws/verify')) return jsonResponse(verifyStatus, verdict)
    throw new Error(`unexpected fetch: ${url}`)
  })
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  walletMock.address = 'HollowTulipAddress111111111111111111111111'
  process.env.EXPO_PUBLIC_AI_CLASSIFY_URL = 'http://localhost:3000/api/classify-gemini'
  walletMock.signIn.mockResolvedValue({
    signature: new Uint8Array(64).fill(7),
    signedMessage: new Uint8Array(32).fill(9),
  })
  fetchSpy = scriptFetch()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
})

describe('useDeviceVerification', () => {
  it('starts idle', async () => {
    const { result } = await renderHook(() => useDeviceVerification())
    expect(result.current.status).toBe('idle')
    expect(result.current.reason).toBeNull()
  })

  it('runs issue → sign → verify and lands on verified', async () => {
    const { result } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })

    expect(result.current.status).toBe('verified')
    expect(result.current.reason).toBeNull()

    // The wallet signed the server-issued payload, bound to this address.
    expect(walletMock.signIn).toHaveBeenCalledWith({ ...ISSUED, address: walletMock.address })

    // …and the proof went back with plain JSON number arrays.
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/api/siws/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          address: walletMock.address,
          nonce: ISSUED.nonce,
          signature: Array.from(new Uint8Array(64).fill(7)),
          signedMessage: Array.from(new Uint8Array(32).fill(9)),
        }),
      }),
    )
  })

  it('reports unverified with the server reason when the allowlist says no', async () => {
    fetchSpy = scriptFetch({ verdict: { verified: false, reason: 'not-allowlisted' } })
    vi.stubGlobal('fetch', fetchSpy)
    const { result } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })

    expect(result.current.status).toBe('unverified')
    expect(result.current.reason).toBe('not-allowlisted')
  })

  it('fails to error when the nonce request fails', async () => {
    fetchSpy = scriptFetch({ nonceStatus: 500 })
    vi.stubGlobal('fetch', fetchSpy)
    const { result } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.reason).toContain('nonce request failed (500)')
    expect(walletMock.signIn).not.toHaveBeenCalled()
  })

  it('fails to error when the wallet declines to sign', async () => {
    walletMock.signIn.mockRejectedValue(new Error('user rejected'))
    const { result } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.reason).toBe('user rejected')
  })

  it('fails to error when the server rejects the proof', async () => {
    fetchSpy = scriptFetch({ verifyStatus: 401, verdict: { error: 'Invalid signature.' } })
    vi.stubGlobal('fetch', fetchSpy)
    const { result } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.reason).toBe('Invalid signature.')
  })

  it('refuses to run without a connected wallet and never fetches', async () => {
    walletMock.address = null
    const { result } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.reason).toBe('wallet-not-connected')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses to run without a configured API origin', async () => {
    delete process.env.EXPO_PUBLIC_AI_CLASSIFY_URL
    const { result } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })

    expect(result.current.status).toBe('error')
    expect(result.current.reason).toBe('endpoint-not-configured')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forgets the verdict when the wallet address changes', async () => {
    const { result, rerender } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })
    expect(result.current.status).toBe('verified')

    walletMock.address = 'AnotherWalletAddress22222222222222222222222'
    await act(async () => {
      rerender({})
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.reason).toBeNull()
  })

  it('resets on demand', async () => {
    fetchSpy = scriptFetch({ verdict: { verified: false, reason: 'not-allowlisted' } })
    vi.stubGlobal('fetch', fetchSpy)
    const { result } = await renderHook(() => useDeviceVerification())

    await act(async () => {
      await result.current.verify()
    })
    expect(result.current.status).toBe('unverified')

    await act(async () => {
      result.current.reset()
    })
    expect(result.current.status).toBe('idle')
  })
})
