/**
 * api/_lib/app-config.ts — minimal cluster config for serverless functions
 *
 * Copied from constants/app-config.ts to avoid tsconfig path aliases.
 * Keep in sync when the source changes.
 */

/** Default public RPC for each selectable cluster. */
export const CLUSTER_URLS = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  // 10.0.2.2 is the Android emulator's alias for the host machine.
  localnet: 'http://10.0.2.2:8899',
} as const
