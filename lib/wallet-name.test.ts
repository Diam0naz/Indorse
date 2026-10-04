import { describe, it, expect } from 'vitest'
import { walletName } from '@/lib/wallet-name'

const ADDRESS_A = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'
const ADDRESS_B = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

describe('lib/wallet-name', () => {
  it('is deterministic for the same address', () => {
    expect(walletName(ADDRESS_A)).toBe(walletName(ADDRESS_A))
  })

  it('produces a two-word name', () => {
    expect(walletName(ADDRESS_A)).toMatch(/^\w+ \w+$/)
  })

  it('produces a different name for a different address', () => {
    expect(walletName(ADDRESS_A)).not.toBe(walletName(ADDRESS_B))
  })

  it('falls back to a guest name when disconnected', () => {
    expect(walletName(null)).toBe('Guest Wallet')
    expect(walletName(undefined)).toBe('Guest Wallet')
    expect(walletName('')).toBe('Guest Wallet')
  })

  it('never contains raw address characters', () => {
    expect(walletName(ADDRESS_A)).not.toContain('GVen')
  })
})
