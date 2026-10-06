/**
 * components/farm-registry-provider.test.tsx — acreage lives locally
 *
 * The chain account stores no acreage, so this registry is the only home
 * the number has: addFarm carries it through to state and disk, a
 * re-register that omits it never erases what was recorded, and the chain
 * mirror (upsertChainFarm) leaves it alone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { FarmRegistryProvider, useFarmRegistry } from './farm-registry-provider'

const makeWrapper = () => {
  function Wrapper({ children }: { children: ReactNode }) {
    return <FarmRegistryProvider>{children}</FarmRegistryProvider>
  }
  return Wrapper
}

const PDA = 'Fy2aWfeFLUBLge74F9fVfPcA83bG1vkomBHD7rj8CLU5'

/** Mount a fresh registry against an empty store, ready to take writes. */
async function mountRegistry() {
  const { result } = await renderHook(() => useFarmRegistry(), { wrapper: makeWrapper() })
  await waitFor(() => expect(result.current?.ready).toBe(true))
  return result
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

describe('farm-registry-provider acreage', () => {
  it('carries typed acres into state and onto disk', async () => {
    const result = await mountRegistry()

    await act(async () => {
      result.current.addFarm({ name: 'Green Valley', lat: 34.052, lng: -118.243, source: 'local', acres: 120 })
    })
    expect(result.current.farms[0]?.acres).toBe(120)

    // ...and the stored document follows, not just the session.
    await waitFor(async () => {
      const doc = JSON.parse((await AsyncStorage.getItem('indorse.farms.v1')) ?? '{}') as {
        farms?: { acres?: number }[]
      }
      expect(doc.farms?.[0]?.acres).toBe(120)
    })
  })

  it('keeps recorded acres when a re-register omits them', async () => {
    const result = await mountRegistry()

    // Both passes share the PDA address — the upsert key a wallet's
    // re-registration would produce.
    await act(async () => {
      result.current.addFarm({
        name: 'Green Valley',
        lat: 34.052,
        lng: -118.243,
        source: 'chain',
        address: PDA,
        acres: 120,
      })
    })
    await act(async () => {
      result.current.addFarm({ name: 'Green Valley Farm', lat: 34.052, lng: -118.243, source: 'chain', address: PDA })
    })

    expect(result.current.farms).toHaveLength(1)
    expect(result.current.farms[0]?.name).toBe('Green Valley Farm')
    expect(result.current.farms[0]?.acres).toBe(120)
  })

  it('leaves acreage alone when the chain mirror syncs the entry', async () => {
    const result = await mountRegistry()

    await act(async () => {
      result.current.addFarm({
        name: 'Green Valley',
        lat: 34.052,
        lng: -118.243,
        source: 'chain',
        address: PDA,
        acres: 120,
      })
    })
    await act(async () => {
      result.current.upsertChainFarm({
        name: 'Green Valley',
        lat: 34.052,
        lng: -118.243,
        address: PDA,
        reportCount: 2,
      })
    })

    const entry = result.current.farms[0]
    expect(entry?.source).toBe('chain')
    expect(entry?.reportCount).toBe(2)
    expect(entry?.acres).toBe(120)
  })

  it('accepts registration without acreage — the field is optional', async () => {
    const result = await mountRegistry()

    await act(async () => {
      result.current.addFarm({ name: 'East Draw', lat: 35.052, lng: -117.243, source: 'local' })
    })

    expect(result.current.farms).toHaveLength(1)
    expect(result.current.farms[0]?.acres).toBeUndefined()
  })
})
