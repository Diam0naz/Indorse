/**
 * lib/skr.test.ts — unit tests for the .skr domain resolver and hook
 *
 * The tests stub the @solana/kit RPC and TanStack Query so that:
 *   - No real network calls are made.
 *   - The module-level `_rpc` singleton used by `useSkrName` is replaced with a
 *     controlled mock via `vi.mock`.
 *
 * Coverage:
 *   1. normalizeSkrName — input normalisation
 *   2. resolveSkrNames  — not-found (empty accounts) falls back to []
 *   3. resolveSkrNames  — RPC error propagates (does not silently swallow)
 *   4. useSkrName hook  — returns null while query is loading (no address)
 *   5. useSkrName hook  — returns null on not-found (resolveSkrNames → [])
 *   6. useSkrName hook  — returns null on error (query error path)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
// vi.mock/vi.hoisted above hoist ahead of every import, so the module under
// test always loads against the stubs regardless of position in the file.
import { normalizeSkrName, resolveSkrNames, useSkrName } from './skr'

// ── Hoist the mock RPC so it is defined before vi.mock factories run ───────
// vi.mock factories are hoisted to the top of the file by Vitest, so any
// variable they reference must also be hoisted via vi.hoisted().

const { mockRpc } = vi.hoisted(() => {
  const mockRpc = {
    getProgramAccounts: vi.fn(),
    getMultipleAccounts: vi.fn(),
    getAccountInfo: vi.fn(),
    getTokenSupply: vi.fn(),
    getTokenLargestAccounts: vi.fn(),
  }
  return { mockRpc }
})

// ── Stub @solana/kit before importing skr.ts ──────────────────────────────

vi.mock('@solana/kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/kit')>()
  return {
    ...actual,
    getProgramDerivedAddress: vi.fn().mockResolvedValue(['MockPDA111111111111111111111111111', 255]),
    createSolanaRpc: vi.fn(() => mockRpc),
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────

// Helper: make a `.send()` stub that resolves to `value`.
const makeSend = <T>(value: T) => ({ send: vi.fn().mockResolvedValue(value) })

/** Wrap a hook with a fresh QueryClient so tests are isolated. */
function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('normalizeSkrName', () => {
  it('strips .skr suffix and lowercases', () => {
    expect(normalizeSkrName('Alice.SKR')).toBe('alice')
  })

  it('accepts bare label', () => {
    expect(normalizeSkrName('alice')).toBe('alice')
  })

  it('accepts hyphenated labels', () => {
    expect(normalizeSkrName('green-valley.skr')).toBe('green-valley')
  })

  it('rejects empty string', () => {
    expect(normalizeSkrName('')).toBeNull()
  })

  it('rejects labels with dots (subdomains)', () => {
    expect(normalizeSkrName('a.alice.skr')).toBeNull()
  })

  it('rejects labels longer than 63 chars', () => {
    expect(normalizeSkrName('a'.repeat(64))).toBeNull()
  })
})

describe('resolveSkrNames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns [] when no accounts are found (address has no .skr name)', async () => {
    mockRpc.getProgramAccounts.mockReturnValue(makeSend([]))

    const result = await resolveSkrNames(
      mockRpc as unknown as Parameters<typeof resolveSkrNames>[0],
      'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht' as Parameters<typeof resolveSkrNames>[1],
    )
    expect(result).toEqual([])
  })

  it('propagates RPC errors (does not swallow them)', async () => {
    mockRpc.getProgramAccounts.mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error('RPC timeout')),
    })

    await expect(
      resolveSkrNames(
        mockRpc as unknown as Parameters<typeof resolveSkrNames>[0],
        'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht' as Parameters<typeof resolveSkrNames>[1],
      ),
    ).rejects.toThrow('RPC timeout')
  })
})

describe('useSkrName hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no address is provided', async () => {
    const { result } = await renderHook(() => useSkrName(null), { wrapper })
    // Query is disabled, so data stays undefined → null.
    expect(result.current).toBeNull()
  })

  it('returns null while the query is in-flight', async () => {
    // Never-resolving promise.
    mockRpc.getProgramAccounts.mockReturnValue({
      send: vi.fn().mockReturnValue(new Promise(() => {})),
    })

    const { result } = await renderHook(() => useSkrName('GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'), { wrapper })
    expect(result.current).toBeNull()
  })

  it('returns null when the address has no .skr name', async () => {
    mockRpc.getProgramAccounts.mockReturnValue(makeSend([]))

    const { result } = await renderHook(() => useSkrName('GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'), { wrapper })

    await waitFor(() => {
      // Once the query settles the hook returns null (no names registered).
      expect(result.current).toBeNull()
    })
  })

  it('returns null on query error (does not throw from the hook)', async () => {
    mockRpc.getProgramAccounts.mockReturnValue({
      send: vi.fn().mockRejectedValue(new Error('network error')),
    })

    const { result } = await renderHook(() => useSkrName('GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'), { wrapper })

    // After the error the hook must still return null, not throw.
    await waitFor(() => {
      expect(result.current).toBeNull()
    })
  })
})
