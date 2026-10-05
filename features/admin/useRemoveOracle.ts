/**
 * useRemoveOracle — admin revokes a reader seat on the oracle set.
 *
 * Readings the member already posted stay in the season tally — removing a
 * seat changes who may contribute from now on, never the median history.
 */

import { useQueryClient } from '@tanstack/react-query'
import { address as toAddress } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { getRemoveOracleInstruction } from '@/lib/generated/indorse'
import { configPda, oracleSetPda } from '@/lib/program'
import { validateOracleMember } from './types'
import type { OracleMemberValues } from './types'

export function useRemoveOracle() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<OracleMemberValues, string>({
    actionLabel: 'remove oracle reader',
    validate: validateOracleMember,
    action: async (input, address) => {
      const [config, oracleSet] = await Promise.all([configPda(), oracleSetPda()])
      const ix = getRemoveOracleInstruction({
        authority: walletSigner(address),
        config,
        oracleSet,
        member: toAddress(input.member.trim()),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return oracleSet
    },
  })
}
