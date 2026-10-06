/**
 * useCloseSettledPolicy — recognise the premium and release both accounts.
 *
 * Settlement deliberately leaves two things behind: the policy account, still
 * holding rent, and the policy's vault, still holding the premium — in *both*
 * terminal branches, because `settle_policy` either pays coverage out to the
 * farmer or reclaims it for the treasury, and never moves the premium. This
 * is the step that finishes the money. The vault's balance — read, never
 * assumed to be exactly the premium, so an accounting surprise sweeps instead
 * of being left behind — goes to the treasury's USDC account, the vault's
 * rent goes to the farmer who paid for it, and Anchor's `close` refunds the
 * policy's rent to that same farmer.
 *
 * Permissionless, exactly like `settle_policy`: the program's state gate
 * (PaidOut or Expired) and the pinned destinations are the whole authority,
 * so this signer only carries the signature and the fee. The console
 * confirms first because it is terminal — afterwards the policy PDA no longer
 * exists and nothing can read or act on it again.
 */

import { useQueryClient } from '@tanstack/react-query'
import { address as toAddress } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { getCloseSettledPolicyInstruction } from '@/lib/generated/indorse'
import { ataPda, insuranceVaultPda, policyPda, treasuryPda } from '@/lib/program'
import { validateCloseSettledPolicy } from './types'
import type { CloseSettledPolicyValues } from './types'

export function useCloseSettledPolicy() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const { network } = useSettings()

  return useWalletMutation<CloseSettledPolicyValues, string>({
    actionLabel: 'close settled policy',
    validate: validateCloseSettledPolicy,
    action: async (input, address) => {
      const mint = network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
      const index = input.policyCount - 1
      const [policy, insuranceVault, treasury] = await Promise.all([
        policyPda(input.farmAddress, index),
        insuranceVaultPda(input.farmAddress, index),
        treasuryPda(),
      ])
      const insurerUsdc = await ataPda(treasury, mint)

      const ix = getCloseSettledPolicyInstruction({
        closer: walletSigner(address),
        policy,
        insuranceVault,
        farmer: toAddress(input.farmerAddress),
        treasury,
        insurerUsdc,
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return policy
    },
  })
}
