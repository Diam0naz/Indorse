/**
 * useInitOracleSet — creates the reader-set PDA when it does not exist
 * (fresh localnet / first deploy; devnet already has one).
 *
 * `k` must be odd and within 3..=7 — the program's init gate, mirrored by
 * the client-side validator so a bad quorum fails before the wallet prompt.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { getInitOracleSetInstruction } from '@/lib/generated/indorse'
import { configPda, oracleSetPda } from '@/lib/program'
import { validateInitOracleSet } from './types'
import type { InitOracleSetValues } from './types'

export function useInitOracleSet() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<InitOracleSetValues, string>({
    actionLabel: 'init oracle set',
    validate: validateInitOracleSet,
    action: async (input, address) => {
      const [config, oracleSet] = await Promise.all([configPda(), oracleSetPda()])
      const ix = getInitOracleSetInstruction({
        authority: walletSigner(address),
        config,
        oracleSet,
        k: input.k,
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return oracleSet
    },
  })
}
