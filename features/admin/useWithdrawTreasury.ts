/**
 * useWithdrawTreasury — admin pulls accumulated funds out of the program
 * treasury.
 *
 * The destination is pinned twice over: the program requires the USDC
 * account's owner to equal `config.admin`, and this hook derives it from
 * the connected wallet — so a rotation of `config.admin` moves the
 * destination with it. Amount arrives in whole USDC, converted to e6.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { getWithdrawTreasuryInstruction } from '@/lib/generated/indorse'
import { ataPda, configPda, treasuryPda } from '@/lib/program'
import { toE6 } from '@/lib/format'
import { validateWithdrawTreasury } from './types'
import type { WithdrawTreasuryValues } from './types'

export function useWithdrawTreasury() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const { network } = useSettings()

  return useWalletMutation<WithdrawTreasuryValues, string>({
    actionLabel: 'withdraw treasury',
    validate: validateWithdrawTreasury,
    action: async (input, address) => {
      const mint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
      const [config, treasury] = await Promise.all([configPda(), treasuryPda()])
      const [treasuryUsdc, destinationUsdc] = await Promise.all([ataPda(treasury, mint), ataPda(address, mint)])

      const ix = getWithdrawTreasuryInstruction({
        authority: walletSigner(address),
        config,
        treasury,
        treasuryUsdc,
        destinationUsdc,
        amount: toE6(input.amountUsdc),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return treasuryUsdc
    },
  })
}
