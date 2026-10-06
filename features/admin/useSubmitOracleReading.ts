/**
 * useSubmitOracleReading — post a reader's season total to the weather tally.
 *
 * The signer is a **member** of the oracle set, not `config.admin`: the
 * program gates on `oracle_set.members.contains(member)`, so the connected
 * wallet has to hold a reader seat for the transaction to land. Each seat
 * owns exactly one reading for the season — re-posting replaces its own
 * entry while the tally is open (a typo must not be counted, and it can
 * never double-weight the source), and the k-th distinct seat freezes the
 * median and finalises the season for `settle_policy`.
 *
 * Rainfall arrives in millimetres, the unit every screen in the app shows,
 * and is scaled to the program's `mm × 10` here — no caller needs to know
 * the representation exists.
 */

import { useQueryClient } from '@tanstack/react-query'
import { address as toAddress } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { getSubmitOracleReadingInstruction } from '@/lib/generated/indorse'
import { oracleSetPda, weatherOraclePda } from '@/lib/program'
import { rainfallToScaledX10, validateSubmitOracleReading } from './types'
import type { SubmitOracleReadingValues } from './types'

export function useSubmitOracleReading() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<SubmitOracleReadingValues, string>({
    actionLabel: 'submit oracle reading',
    validate: validateSubmitOracleReading,
    action: async (input, address) => {
      const [oracleSet, oracle] = await Promise.all([
        oracleSetPda(),
        weatherOraclePda(input.farmAddress, input.seasonStart),
      ])
      const ix = getSubmitOracleReadingInstruction({
        member: walletSigner(address),
        oracleSet,
        farm: toAddress(input.farmAddress),
        oracle,
        seasonStart: input.seasonStart,
        totalRainfallMm: rainfallToScaledX10(input.rainfallMm),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return oracle
    },
  })
}
