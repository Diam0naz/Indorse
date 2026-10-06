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

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { fromE6 } from '@/lib/format'
import { useMobileWalletSetup } from '@/features/wallet/useMobileWalletSetup'
import { farmCounterPda, farmPda, fetchAccount, useProgramRpc, useRpcUrl } from '@/lib/program'
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

  return null
}
