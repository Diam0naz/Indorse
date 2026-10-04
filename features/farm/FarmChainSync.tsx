/**
 * FarmChainSync — mirrors the wallet's on-chain farm into the local registry
 *
 * Runs inside the tab navigator (wallet + query client + registry provider
 * are all ancestors there) and upserts the farm account whenever the chain
 * read lands: the entry gets its `source: 'chain'` badge, PDA address and
 * report count, and — if nothing is selected yet — claims the header pill.
 *
 * The effect keys on the farm's *fields*, not the query result object, so a
 * refetch (new object, same data) can't re-fire it; combined with the
 * registry's unchanged-content guard there is no path back into itself.
 *
 * Renders nothing; it is a side-effect leaf.
 */

import { useEffect } from 'react'
import { useFarmRegistry } from '@/components/farm-registry-provider'
import { fromE6 } from '@/lib/format'
import { useFarmQuery } from '@/features/farm/useFarmQuery'

export function FarmChainSync() {
  const { farm, farmAddress } = useFarmQuery()
  const { upsertChainFarm } = useFarmRegistry()

  const name = farm?.name
  const latE6 = farm?.latE6
  const lngE6 = farm?.lngE6
  const reportCount = farm?.reportCount

  useEffect(() => {
    if (name === undefined || latE6 === undefined || lngE6 === undefined || !farmAddress) return
    upsertChainFarm({
      name,
      lat: fromE6(latE6),
      lng: fromE6(lngE6),
      address: farmAddress,
      reportCount: reportCount ?? 0,
    })
  }, [name, latE6, lngE6, reportCount, farmAddress, upsertChainFarm])

  return null
}
