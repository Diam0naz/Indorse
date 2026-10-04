/**
 * Escrow mutation hooks — the real instructions
 *
 * useCreateEscrow  — buyer deposits USDC into escrow for a harvest batch
 * useReleaseEscrow — farmer claims the escrowed funds
 * useCancelEscrow  — buyer reclaims funds before the lock period
 *
 * All three derive their accounts client-side (escrow + vault PDAs from the
 * batch, the signer's USDC associated token account) and go through the
 * Mobile Wallet Adapter; a successful send invalidates `['indorse']` so the
 * provenance screen refetches. `useReleaseEscrow`/`useCancelEscrow` take the
 * **batch address** — the escrow and vault PDAs are derived from it, and the
 * program enforces who may sign (farmer releases, buyer cancels while the
 * lock has not expired).
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import { ataPda, buildInstruction, escrowPda, escrowVaultPda } from '@/lib/program'
import { usdcToLamports } from '@/lib/format'
import { validateCreateEscrow } from './types'
import type { CreateEscrowInput } from './types'

/** The active cluster's USDC mint — same resolution as the balance query. */
function useUsdcMint(): string {
  const { network } = useSettings()
  return network.cluster === 'mainnet' ? USDC_MAINNET : USDC_DEVNET
}

export function useCreateEscrow() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const mint = useUsdcMint()

  return useWalletMutation<CreateEscrowInput, string>({
    actionLabel: 'create escrow',
    validate: validateCreateEscrow,
    action: async (input, address) => {
      const [escrow, escrowVault, buyerUsdc] = await Promise.all([
        escrowPda(input.batchAddress),
        escrowVaultPda(input.batchAddress),
        ataPda(address, mint),
      ])

      const ix = buildInstruction(
        'create_escrow',
        { buyer: address, batch: input.batchAddress, escrow, escrowVault, buyerUsdc, usdcMint: mint },
        {
          amountUsdc: usdcToLamports(input.amountUsdc),
          lockUntil: Math.floor(Date.now() / 1000) + input.lockDurationSeconds,
        },
      )
      await wallet.sendTransactions([ix])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return escrow
    },
  })
}

export function useReleaseEscrow() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const mint = useUsdcMint()

  return useWalletMutation<string, string>({
    actionLabel: 'release escrow',
    action: async (batchAddress, address) => {
      const [escrow, escrowVault, farmerUsdc] = await Promise.all([
        escrowPda(batchAddress),
        escrowVaultPda(batchAddress),
        ataPda(address, mint),
      ])

      const ix = buildInstruction('release_escrow', {
        farmer: address,
        escrow,
        escrowVault,
        farmerUsdc,
      })
      await wallet.sendTransactions([ix])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return escrow
    },
  })
}

export function useCancelEscrow() {
  const wallet = useMobileWallet()
  const queryClient = useQueryClient()
  const mint = useUsdcMint()

  return useWalletMutation<string, string>({
    actionLabel: 'cancel escrow',
    action: async (batchAddress, address) => {
      const [escrow, escrowVault, buyerUsdc] = await Promise.all([
        escrowPda(batchAddress),
        escrowVaultPda(batchAddress),
        ataPda(address, mint),
      ])

      const ix = buildInstruction('cancel_escrow', {
        buyer: address,
        escrow,
        escrowVault,
        buyerUsdc,
      })
      await wallet.sendTransactions([ix])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return escrow
    },
  })
}
