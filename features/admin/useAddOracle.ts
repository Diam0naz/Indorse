/**
 * useAddOracle — admin assigns a reader seat on the oracle set.
 *
 * Seats are admin-assigned (no bond — the median is the defence, not
 * collateral). The new reader joins the set that already exists; readings
 * they posted before joining stay theirs.
 */

import { useQueryClient } from '@tanstack/react-query'
import { address as toAddress } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { getAddOracleInstruction } from '@/lib/generated/indorse'
import { configPda, oracleSetPda } from '@/lib/program'
import { validateOracleMember } from './types'
import type { OracleMemberValues } from './types'

export function useAddOracle() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<OracleMemberValues, string>({
    actionLabel: 'add oracle reader',
    validate: validateOracleMember,
    action: async (input, address) => {
      const [config, oracleSet] = await Promise.all([configPda(), oracleSetPda()])
      const ix = getAddOracleInstruction({
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
