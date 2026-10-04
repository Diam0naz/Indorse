/**
 * useSubmitReport
 *
 * TanStack Query mutation hook for the `submit_scout_report` instruction:
 *
 *   1. Read the farm account for its current `reportCount`
 *   2. Derive the report PDA from ["report", farm, reportCount] — the next
 *      slot, which is exactly what the program's `init` constraint expects
 *   3. Encode {photoHash, uri, latE6, lngE6, aiLabel} + send via the wallet
 *   4. Invalidate farm/reports queries (the farm's reportCount just changed)
 *
 * Returns the on-chain address of the newly-created ScoutReport account.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation, TransactionError } from '../wallet/useWalletMutation'
import { validateSubmitReport } from './types'
import { buildInstruction, fetchAccount, reportPda, useProgramRpc } from '@/lib/program'
import { toE6 } from '@/lib/format'
import type { SubmitScoutReportInput } from './types'
import type { Farm } from '@/features/farm/types'

export function useSubmitReport() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const rpc = useProgramRpc()

  return useWalletMutation<SubmitScoutReportInput, string>({
    actionLabel: 'submit scout report',
    validate: validateSubmitReport,
    action: async (input, address) => {
      const farm = await fetchAccount<Farm>(rpc, input.farmAddress, 'Farm')
      if (!farm) throw new TransactionError('This wallet has no registered farm yet.')

      const report = await reportPda(input.farmAddress, farm.reportCount)
      const ix = buildInstruction(
        'submit_scout_report',
        { reporter: address, farm: input.farmAddress, report },
        {
          photoHash: input.photoHash,
          uri: input.uri,
          latE6: toE6(input.lat),
          lngE6: toE6(input.lng),
          aiLabel: input.aiLabel,
        },
      )
      await wallet.sendTransactions([ix])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return report
    },
  })
}
