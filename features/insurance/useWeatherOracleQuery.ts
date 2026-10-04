/**
 * useWeatherOracleQuery — reads the WeatherOracle account for a policy's
 * season (seeded by [b"weather", farm, i64(seasonStart)]).
 *
 * Disabled until both farmAddress and seasonStart are known (i.e. the policy
 * was read first).
 */

import { useQuery } from '@tanstack/react-query'
import { weatherOraclePda, fetchAccount, useProgramRpc, useRpcUrl } from '@/lib/program'
import type { WeatherReading } from './types'

export interface WeatherOracleQueryResult {
  reading: WeatherReading | null
  state: 'loading' | 'error' | 'ready'
  retry: () => void
}

export function useWeatherOracleQuery(
  target: { farmAddress: string; seasonStart: number } | null,
): WeatherOracleQueryResult {
  const rpc = useProgramRpc()
  const url = useRpcUrl()
  const enabled = !!target

  const query = useQuery({
    queryKey: ['indorse', 'weather', url, target?.farmAddress ?? null, target?.seasonStart ?? null],
    enabled,
    retry: 1,
    queryFn: async () => {
      if (!target) return null
      const addr = await weatherOraclePda(target.farmAddress, target.seasonStart)
      return fetchAccount<WeatherReading>(rpc, addr, 'WeatherOracle')
    },
  })

  return {
    reading: query.data ?? null,
    state: !enabled ? 'ready' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    retry: query.refetch,
  }
}
