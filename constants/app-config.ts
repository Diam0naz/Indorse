import {
  AppIdentity,
  createSolanaDevnet,
  createSolanaLocalnet,
  createSolanaMainnet,
  createSolanaTestnet,
  SolanaCluster,
} from '@wallet-ui/react-native-kit'
import type { ClusterId, NetworkPrefs } from '@/components/settings-provider'
import type { MessageKey } from '@/lib/i18n'

/** On-chain program ID — matches declare_id! in programs/indorse_program/src/lib.rs */
export const PROGRAM_ID = 'GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht'

/**
 * Hackathon authority (verifier, treasury owner, weather oracle) — mirrors
 * the `ADMIN` constant in the Rust program. `revoke_policy` sweeps any
 * treasury-funded coverage back to this wallet's USDC account.
 */
export const ADMIN_ADDRESS = 'AXUTwBhtwbgAJGAZYKHXAJgSo4dMC29XrnbP91BPcYg8'

/** Translation key for each selectable cluster's display name. */
export const CLUSTER_LABEL_KEYS: Record<ClusterId, MessageKey> = {
  mainnet: 'network.mainnet',
  devnet: 'network.devnet',
  testnet: 'network.testnet',
  localnet: 'network.localnet',
  custom: 'network.custom',
}

/** Default public RPC for each selectable cluster. */
export const CLUSTER_URLS: Record<Exclude<ClusterId, 'custom'>, string> = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  // 10.0.2.2 is the Android emulator's alias for the host machine.
  localnet: 'http://10.0.2.2:8899',
}

export const DEFAULT_CLUSTER: SolanaCluster = createSolanaDevnet({ url: CLUSTER_URLS.devnet })

/** The RPC endpoint a set of preferences actually points at. */
export function rpcUrl(network: NetworkPrefs): string {
  if (network.cluster === 'custom') return network.customRpc.trim() || CLUSTER_URLS.devnet
  return CLUSTER_URLS[network.cluster]
}

/** Build the wallet-provider cluster descriptor for a set of preferences. */
export function buildCluster(network: NetworkPrefs): SolanaCluster {
  const url = rpcUrl(network)
  switch (network.cluster) {
    case 'mainnet':
      return createSolanaMainnet({ url })
    case 'testnet':
      return createSolanaTestnet({ url })
    case 'localnet':
      return createSolanaLocalnet({ url })
    case 'custom':
      return createSolanaLocalnet({ url, label: 'Custom RPC' })
    default:
      return createSolanaDevnet({ url })
  }
}

export class AppConfig {
  static cluster: SolanaCluster = DEFAULT_CLUSTER
  static identity: AppIdentity = { name: 'indorse' }
}
