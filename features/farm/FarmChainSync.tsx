/**
 * FarmChainSync — mirrors every on-chain farm of the connected wallet into
 * the local registry
 *
 * Runs inside the tab navigator (wallet + query client + registry provider
 * are all ancestors there) and re-reads the roster whenever the wallet or
 * the `['indorse']` queries change (registering a farm invalidates them):
 *
 *   1. read the wallet's farm allocator   (["farm_counter", owner])
 *   2. derive farms 0 … count-1           (["farm", owner, u32(i)])
 *   3. upsert each into the registry — chain badge, PDA address, report
 *      count — so the header pill and the policy strip can order them all
 *
 * It deliberately does NOT depend on which farm is selected: the roster
 * must mirror the wallet whether or not any entry is currently featured
 * (the registry is device-scoped and can outlive a wallet switch).
 *
 * The registry's unchanged-content guard makes an upsert of identical
 * rows a no-op, so a refetch (new array, same data) cannot loop back
 * into the context. Renders nothing; it is a side-effect leaf.
 */

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { fromE6 } from '@/lib/format'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { farmCounterPda, farmPda, fetchAccount, useProgramRpc, useRpcUrl } from '@/lib/program'
import { directoryEndpoint, publishFarm } from './directory'
import type { Farm, FarmCounter } from './types'

interface ChainFarmEntry {
  name: string
  lat: number
  lng: number
  address: string
  reportCount: number
}

export function FarmChainSync() {
  const { address } = useMobileWalletSetup()
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const { upsertChainFarm } = useFarmRegistry()

  const query = useQuery({
    queryKey: ['indorse', 'farms-sync', url, address ?? null],
    enabled: !!address,
    retry: 1,
    queryFn: async (): Promise<ChainFarmEntry[]> => {
      if (!address) return []
      const counterAddress = await farmCounterPda(address)
      const counter = await fetchAccount<FarmCounter>(rpc, counterAddress, 'FarmCounter')
      const count = counter?.count ?? 0
      if (count === 0) return []

      const addresses = await Promise.all(Array.from({ length: count }, (_, index) => farmPda(address, index)))
      const accounts = await Promise.all(addresses.map((farmAddress) => fetchAccount<Farm>(rpc, farmAddress, 'Farm')))

      const entries: ChainFarmEntry[] = []
      accounts.forEach((farm, index) => {
        if (!farm) return // deleted or unreadable — the roster keeps what exists
        entries.push({
          name: farm.name,
          lat: fromE6(farm.latE6),
          lng: fromE6(farm.lngE6),
          address: addresses[index],
          reportCount: farm.reportCount,
        })
      })
      return entries
    },
  })

  useEffect(() => {
    const entries = query.data
    if (!entries?.length) return
    for (const entry of entries) upsertChainFarm(entry)
  }, [query.data, upsertChainFarm])

  // Publish the roster to the farm directory so other scouts can find it
  // (cross-farm discovery). Each address publishes once per session; a
  // failure drops it from the done-set so the next sync retries. The server
  // re-reads every address against the chain before storing it, so this can
  // only ever share farms that really exist — and with no origin configured
  // it is a no-op, like every other single-URL feature.
  const publishedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const entries = query.data
    if (!entries?.length) return
    const endpoint = directoryEndpoint()
    if (!endpoint) return
    for (const entry of entries) {
      if (publishedRef.current.has(entry.address)) continue
      publishedRef.current.add(entry.address)
      // Fire-and-forget: a dead directory never blocks the registry sync.
      publishFarm(endpoint, entry.address).catch(() => {
        publishedRef.current.delete(entry.address)
      })
    }
  }, [query.data])

  return null
}
