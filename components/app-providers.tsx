import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PropsWithChildren, useMemo } from 'react'
import { MobileWalletProvider } from '@wallet-ui/react-native-kit'
import { AppConfig, buildCluster } from '@/constants/app-config'
import { useSettings } from '@/components/settings-provider'

const queryClient = new QueryClient()

export function AppProviders({ children }: PropsWithChildren) {
  const { network } = useSettings()
  // Rebuilt whenever the cluster preference changes; the key remounts the
  // provider so the wallet session is established against the new RPC.
  const cluster = useMemo(() => buildCluster(network), [network])

  return (
    <QueryClientProvider client={queryClient}>
      <MobileWalletProvider key={cluster.url} cluster={cluster} identity={AppConfig.identity}>
        {children}
      </MobileWalletProvider>
    </QueryClientProvider>
  )
}
