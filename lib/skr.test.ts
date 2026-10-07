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
import { address as toAddress, getAddressEncoder, getBase64Decoder } from '@solana/kit'
// vi.mock/vi.hoisted above hoist ahead of every import, so the module under
// test always loads against the stubs regardless of position in the file.
import {
  classifyAddressInput,
  normalizeSkrName,
  resolveAddressFields,
  resolveAddressInput,
  resolveSkrNames,
  useSkrName,
} from './skr'

// ── Hoist the mock RPC so it is defined before vi.mock factories run ───────
// vi.mock factories are hoisted to the top of the file by Vitest, so any
// variable they reference must also be hoisted via vi.hoisted().

const { mockRpc, MOCK_PDA } = vi.hoisted(() => {
  const mockRpc = {
    getProgramAccounts: vi.fn(),
    getMultipleAccounts: vi.fn(),
    getAccountInfo: vi.fn(),
    getTokenSupply: vi.fn(),
    getTokenLargestAccounts: vi.fn(),
  }
  // Must be a *valid* 32-byte address: every derivation feeds its result back
  // through `addressBytes` as the next derivation's parent, so a plausible-
  // looking non-address would throw inside the resolver. Declared here because
  // `vi.hoisted` runs before any top-level const in this file.
  const MOCK_PDA = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx'
  return { mockRpc, MOCK_PDA }
})

// ── Stub @solana/kit before importing skr.ts ──────────────────────────────

vi.mock('@solana/kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/kit')>()
  return {
    ...actual,
    // Must be a *valid* 32-byte address: every derivation feeds its result
    // back through `addressBytes` as the next derivation's parent.
    getProgramDerivedAddress: vi.fn().mockResolvedValue([MOCK_PDA, 255]),
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

// ── Forward resolution — what a form field holds ────────────────────────────

/** The wallet a registered name resolves to. */
const HOLDER = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
/** A different, valid wallet — proves the resolver doesn't just echo input. */
const OTHER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
/** HEADER_SIZE (200) + slack, so the body clears the resolver's length gate. */
const BODY_SIZE = 240
const OWNER_OFFSET = 40
const EXPIRES_AT_OFFSET = 104

/**
 * A name-account body as `resolveSkrDomain` reads it: owner at offset 40,
 * `expiresAt` (little-endian u64, 0 = never) at offset 104. Offsets mirror the
 * private constants in lib/skr.ts — if they move, these tests move with them
 * or fail loudly.
 */
function nameAccountBody(owner: string, expiresAt = 0): string {
  const body = new Uint8Array(BODY_SIZE)
  body.set(getAddressEncoder().encode(toAddress(owner)), OWNER_OFFSET)
  new DataView(body.buffer).setBigUint64(EXPIRES_AT_OFFSET, BigInt(expiresAt), true)
  // The resolver decodes `value.data[0]` through kit's base64 *encoder*
  // (string → bytes), so the fixture has to hand it a base64 string.
  return getBase64Decoder().decode(body)
}

/** Stub `getAccountInfo` to answer with a name account (or nothing). */
function mockNameAccount(body: string | null) {
  mockRpc.getAccountInfo.mockReturnValue(
    makeSend(body === null ? { value: null } : { value: { data: [body, 'base64'] } }),
  )
}

describe('classifyAddressInput', () => {
  it('reads a pubkey as an address without touching the network', () => {
    expect(classifyAddressInput(HOLDER)).toBe('address')
    expect(classifyAddressInput(`  ${HOLDER}  `)).toBe('address')
    expect(mockRpc.getAccountInfo).not.toHaveBeenCalled()
  })

  it('reads a suffixed name as a domain, whatever the case', () => {
    expect(classifyAddressInput('alice.skr')).toBe('domain')
    expect(classifyAddressInput('Alice.SKR')).toBe('domain')
    expect(classifyAddressInput('green-valley.skr')).toBe('domain')
  })

  it('rejects a bare label: shape alone cannot tell a name from a mangled pubkey', () => {
    // Every base58 pubkey lowers to a legal label, so requiring the suffix is
    // the only thing keeping a typo out of the name branch.
    expect(classifyAddressInput('alice')).toBe('invalid')
    expect(classifyAddressInput('gvenujqgmjzcvypkqmm')).toBe('invalid')
  })

  it('rejects everything else, including empty input', () => {
    expect(classifyAddressInput('')).toBe('invalid')
    expect(classifyAddressInput('   ')).toBe('invalid')
    expect(classifyAddressInput('a.alice.skr')).toBe('invalid')
    expect(classifyAddressInput('not_an_address!')).toBe('invalid')
    expect(classifyAddressInput('a b.skr')).toBe('invalid')
  })
})

describe('resolveAddressInput', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes an address straight through with no network call', async () => {
    const result = await resolveAddressInput(mockRpc as never, ` ${OTHER} `)
    expect(result).toEqual({ kind: 'address', address: OTHER })
    expect(mockRpc.getAccountInfo).not.toHaveBeenCalled()
  })

  it('resolves a registered name to the wallet that holds it', async () => {
    mockNameAccount(nameAccountBody(HOLDER))
    const result = await resolveAddressInput(mockRpc as never, 'alice.skr')
    expect(result).toEqual({ kind: 'domain', domain: 'alice.skr', address: HOLDER })
    // Resolved to HOLDER, not to a mock PDA or back to the input.
    expect(result.kind === 'domain' && result.address).not.toBe(MOCK_PDA)
  })

  it('distinguishes an unregistered name from a malformed value', async () => {
    mockNameAccount(null)
    expect(await resolveAddressInput(mockRpc as never, 'nobody.skr')).toEqual({
      kind: 'unregistered',
      domain: 'nobody.skr',
    })
    // No lookup at all for a value that names nothing.
    vi.clearAllMocks()
    expect(await resolveAddressInput(mockRpc as never, 'alice')).toEqual({ kind: 'invalid' })
    expect(mockRpc.getAccountInfo).not.toHaveBeenCalled()
  })

  it('treats an expired name as unregistered rather than resolving it', async () => {
    mockNameAccount(nameAccountBody(HOLDER, 1_000_000)) // seconds — long past
    expect(await resolveAddressInput(mockRpc as never, 'stale.skr')).toEqual({
      kind: 'unregistered',
      domain: 'stale.skr',
    })
  })

  it('lets an RPC failure reject so the caller reports reachability, not registration', async () => {
    mockRpc.getAccountInfo.mockReturnValue({ send: vi.fn().mockRejectedValue(new Error('RPC timeout')) })
    await expect(resolveAddressInput(mockRpc as never, 'alice.skr')).rejects.toThrow('RPC timeout')
  })
})

describe('resolveAddressFields', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves a mixed form in one pass — pubkeys and names together', async () => {
    mockNameAccount(nameAccountBody(HOLDER))
    const result = await resolveAddressFields({ admin: OTHER, reader: 'alice.skr' }, mockRpc as never)
    expect(result).toEqual({ ok: true, values: { admin: OTHER, reader: HOLDER } })
  })

  it('reports a blank field without spending a lookup', async () => {
    const result = await resolveAddressFields({ admin: '   ' }, mockRpc as never)
    expect(result).toEqual({ ok: false, errors: { admin: 'Address is required' } })
    expect(mockRpc.getAccountInfo).not.toHaveBeenCalled()
  })

  it('names the unregistered domain in the error', async () => {
    mockNameAccount(null)
    const result = await resolveAddressFields({ reader: 'nobody.skr' }, mockRpc as never)
    expect(result).toEqual({ ok: false, errors: { reader: 'No wallet holds nobody.skr' } })
  })

  it('separates malformed input from a name that merely resolves to nothing', async () => {
    mockNameAccount(null)
    const result = await resolveAddressFields({ a: 'oops!', b: 'nobody.skr' }, mockRpc as never)
    expect(result).toEqual({
      ok: false,
      errors: { a: 'Not a valid address or .skr name', b: 'No wallet holds nobody.skr' },
    })
  })

  it('blames mainnet when the lookup fails, and only for the field that asked', async () => {
    mockRpc.getAccountInfo.mockReturnValue({ send: vi.fn().mockRejectedValue(new Error('boom')) })
    const result = await resolveAddressFields({ admin: OTHER, reader: 'alice.skr' }, mockRpc as never)
    // The pubkey field still resolved — an outage must not smear over it.
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.admin).toBeUndefined()
      expect(result.errors.reader).toBe('Could not read alice.skr — mainnet unreachable')
    }
  })

  it('fails the whole form if any field fails, so a partial map is never usable', async () => {
    mockNameAccount(null)
    const result = await resolveAddressFields({ admin: OTHER, reader: 'nobody.skr' }, mockRpc as never)
    expect(result.ok).toBe(false)
    // The successful field is deliberately absent — the union says values do
    // not exist when ok is false.
    if (!result.ok) expect('values' in result).toBe(false)
  })
})
