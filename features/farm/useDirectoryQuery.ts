/**
 * useDirectoryQuery — reads the farm directory behind the Discover card
 *
 * The card only ever renders from this list, and the list is only ever a
 * verified cache of public chain accounts (see `api/directory.ts`). No API
 * origin configured → the query never runs and the card treats the result
 * as "nothing to discover", exactly like every other feature that keys off
 * the single configured URL.
 */

import { useQuery } from '@tanstack/react-query'
import { directoryEndpoint, fetchDirectory, type DirectoryFarm } from './directory'

export interface DirectoryQueryResult {
  farms: DirectoryFarm[]
  /** `ready` + an empty list also covers "no origin configured" — the card hides. */
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useDirectoryQuery(): DirectoryQueryResult {
  const endpoint = directoryEndpoint()

  const query = useQuery({
    queryKey: ['indorse', 'directory', endpoint],
    enabled: !!endpoint,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => fetchDirectory(endpoint as string),
  })

  return {
    farms: endpoint ? (query.data ?? []) : [],
    state: !endpoint ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
