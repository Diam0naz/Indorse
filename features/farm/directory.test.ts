/**
 * features/farm/directory.test.ts — the Discover card's arithmetic and I/O
 *
 * Distances, the needs-scouting derivation and the row filter/sort are the
 * card's whole opinion — pinned here with no rendering involved. The two
 * HTTP calls run against a stubbed `fetch`, since the directory server has
 * its own suite in `api/directory.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deriveDiscovery,
  directoryEndpoint,
  fetchDirectory,
  formatDistance,
  haversineKm,
  isDirectoryFarm,
  publishFarm,
  type DirectoryFarm,
} from './directory'

function farm(overrides: Partial<DirectoryFarm> = {}): DirectoryFarm {
  return {
    address: 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht',
    name: 'Rowan Ridge',
    lat: 46.0,
    lng: -98.0,
    owner: 'Fy2aWfeFLUBLge74F9fVfPcA83bG1vkomBHD7rj8CLU5',
    reportCount: 3,
    verifiedReportCount: 2,
    batchCount: 0,
    policyCount: 0,
    updatedAt: 1,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('distance', () => {
  it('haversine measures one degree of latitude as ~111 km', () => {
    const km = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
    expect(km).toBeGreaterThan(111.0)
    expect(km).toBeLessThan(111.3)
    // Degenerate input is exactly zero, and distance is symmetric.
    expect(haversineKm({ lat: 46, lng: -98 }, { lat: 46, lng: -98 })).toBe(0)
    expect(haversineKm({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toBeCloseTo(
      haversineKm({ lat: 3, lng: 4 }, { lat: 1, lng: 2 }),
      9,
    )
  })

  it('formats below a kilometre in metres, beyond it with one decimal', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(0.045)).toBe('45 m')
    expect(formatDistance(1)).toBe('1.0 km')
    expect(formatDistance(12.34)).toBe('12.3 km')
  })
})

describe('directoryEndpoint', () => {
  it('is null when no API origin is configured, and never doubles the slash', () => {
    expect(directoryEndpoint(null)).toBeNull()
    expect(directoryEndpoint('https://api.example.com')).toBe('https://api.example.com/api/directory')
    expect(directoryEndpoint('https://api.example.com/')).toBe('https://api.example.com/api/directory')
  })
})

describe('deriveDiscovery', () => {
  it("excludes the device's own farms — they belong to the switcher", () => {
    const rows = deriveDiscovery([farm({ address: 'MINE' }), farm({ address: 'OTHER', name: 'Other' })], {
      excludeAddresses: ['MINE'],
    })
    expect(rows.map((r) => r.address)).toEqual(['OTHER'])
  })

  it('sorts nearest-first once the device position is known', () => {
    const near = farm({ address: 'NEAR', name: 'Near', lat: 46.1, lng: -98.0 })
    const far = farm({ address: 'FAR', name: 'Far', lat: 47.5, lng: -98.0 })
    const rows = deriveDiscovery([far, near], { origin: { lat: 46.0, lng: -98.0 } })
    expect(rows.map((r) => r.address)).toEqual(['NEAR', 'FAR'])
    expect(rows[0].km).toBeDefined()
    expect(rows[0].km!).toBeLessThan(rows[1].km!)
  })

  it('falls back to a stable name order with no position, distance absent', () => {
    const rows = deriveDiscovery([farm({ address: 'B', name: 'Zulu' }), farm({ address: 'A', name: 'Alpha' })])
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zulu'])
    expect(rows.every((r) => r.km === undefined)).toBe(true)
  })

  it('derives the needs-scouting facts: pending count and provenance score', () => {
    const rows = deriveDiscovery([
      farm({ address: 'UNSCTD', name: 'Untouched', reportCount: 0, verifiedReportCount: 0 }),
      farm({ address: 'HALF', name: 'Half', reportCount: 3, verifiedReportCount: 2 }),
      // Verified can exceed reports only through a chain edge — clamp, never go negative.
      farm({ address: 'CLAMP', name: 'Clamp', reportCount: 1, verifiedReportCount: 4 }),
    ])
    const untouched = rows.find((r) => r.address === 'UNSCTD')!
    expect(untouched.score).toBeNull()
    expect(untouched.pending).toBe(0)
    const half = rows.find((r) => r.address === 'HALF')!
    expect(half.score).toBe(67)
    expect(half.pending).toBe(1)
    expect(rows.find((r) => r.address === 'CLAMP')!.pending).toBe(0)
  })

  it('does not mutate the input array', () => {
    const input = [farm({ address: 'B' }), farm({ address: 'A' })]
    const before = input.map((f) => f.address)
    deriveDiscovery(input)
    expect(input.map((f) => f.address)).toEqual(before)
  })
})

describe('shape guard', () => {
  it('accepts a well-formed row and rejects anything missing the essentials', () => {
    expect(isDirectoryFarm(farm())).toBe(true)
    expect(isDirectoryFarm(null)).toBe(false)
    expect(isDirectoryFarm({ ...farm(), address: '' })).toBe(false)
    expect(isDirectoryFarm({ ...farm(), reportCount: '3' })).toBe(false)
    expect(isDirectoryFarm(farm({ verifiedReportCount: undefined as unknown as number }))).toBe(false)
  })
})

describe('HTTP', () => {
  it('fetchDirectory returns only well-formed rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ farms: [farm(), { junk: true }] }),
      })),
    )
    const rows = await fetchDirectory('https://api.example.com/api/directory')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Rowan Ridge')
  })

  it('fetchDirectory throws on a non-200 or an unrecognisable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    )
    await expect(fetchDirectory('https://x/api/directory')).rejects.toThrow('503')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ nope: [] }) })),
    )
    await expect(fetchDirectory('https://x/api/directory')).rejects.toThrow('no farms list')
  })

  it('publishFarm posts the address and reports the verdict', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishFarm('https://x/api/directory', 'FARM')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('https://x/api/directory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ farm: 'FARM' }),
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })),
    )
    await expect(publishFarm('https://x/api/directory', 'FARM')).resolves.toBe(false)
  })
})
