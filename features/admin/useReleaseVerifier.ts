/**
 * useReleaseVerifier — governance's fair-exit valve: frees a member's seat
 * and returns their recorded stake.
 *
 * The bond leaves the set's bond vault and lands in the *target's own* USDC
 * account — the program pins the destination's owner to `target`, so
 * governance can free a seat but never redirect the refund.
 */

import { useQueryClient } from '@tanstack/react-query'
import { address as toAddress } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { getReleaseVerifierInstruction } from '@/lib/generated/indorse'
import { ataPda, configPda, verifierSetPda } from '@/lib/program'
import { validateVerifierTarget } from './types'
import type { VerifierTargetValues } from './types'

export function useReleaseVerifier() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const { network } = useSettings()

  return useWalletMutation<VerifierTargetValues, string>({
    actionLabel: 'release verifier',
    validate: validateVerifierTarget,
    action: async (input, address) => {
      const mint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
      const target = toAddress(input.target.trim())
      const [config, verifierSet] = await Promise.all([configPda(), verifierSetPda()])
      const [bondVault, memberUsdc] = await Promise.all([ataPda(verifierSet, mint), ataPda(target, mint)])

      const ix = getReleaseVerifierInstruction({
        authority: walletSigner(address),
        config,
        verifierSet,
        bondVault,
        usdcMint: toAddress(mint),
        memberUsdc,
        target,
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return verifierSet
    },
  })
}
