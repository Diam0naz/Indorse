/**
 * useInitVerifierSet — creates the verifier-set PDA when it does not exist
 * (fresh localnet / first deploy; devnet already has one).
 *
 * The authority pays the PDA's rent. Only offered by the console when the
 * set read comes back null — running it twice fails on-chain anyway.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { getInitVerifierSetInstruction } from '@/lib/generated/indorse'
import { configPda, verifierSetPda } from '@/lib/program'
import { toE6 } from '@/lib/format'
import { validateVerifierSet } from './types'
import type { VerifierSetValues } from './types'

export function useInitVerifierSet() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()

  return useWalletMutation<VerifierSetValues, string>({
    actionLabel: 'init verifier set',
    validate: validateVerifierSet,
    action: async (input, address) => {
      const [config, verifierSet] = await Promise.all([configPda(), verifierSetPda()])
      const ix = getInitVerifierSetInstruction({
        authority: walletSigner(address),
        config,
        verifierSet,
        k: input.k,
        bondAmount: toE6(input.bondAmount),
      })
      await wallet.sendTransactions([toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return verifierSet
    },
  })
}
