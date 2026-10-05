/**
 * Escrow mutation hooks — the real instructions
 *
 * useCreateEscrow  — buyer deposits USDC into escrow for a harvest batch
 * useReleaseEscrow — farmer claims the escrowed funds
 * useCancelEscrow  — buyer reclaims funds before the lock period
 *
 * All three derive their accounts client-side (escrow + vault PDAs from the
 * batch, the signer's USDC associated token account) and go through the
 * Mobile Wallet Adapter; each transaction prepends an idempotent create of
 * that token account, so a wallet which has never held USDC isn't rejected
 * with Anchor's `AccountNotInitialized` — a missing account Solflare can only
 * show as "simulation failed". A successful send invalidates `['indorse']` so the
 * provenance screen refetches. `useReleaseEscrow`/`useCancelEscrow` take the
 * **batch address** — the escrow and vault PDAs are derived from it, and the
 * program enforces who may sign (farmer releases, buyer cancels while the
 * lock has not expired).
 */

import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useSettings } from '@/components/settings-provider'
import { useWalletMutation } from '@/features/wallet/useWalletMutation'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { USDC_DEVNET, USDC_MAINNET } from '@/constants/tokens'
import {
  getCancelEscrowInstruction,
  getCreateEscrowInstruction,
  getReleaseEscrowInstruction,
} from '@/lib/generated/indorse'
import { ataPda, buildCreateAtaInstruction, escrowPda, escrowVaultPda, toAddress } from '@/lib/program'
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

      const ix = getCreateEscrowInstruction({
        buyer: walletSigner(address),
        batch: toAddress(input.batchAddress),
        escrow,
        escrowVault,
        buyerUsdc,
        usdcMint: toAddress(mint),
        amountUsdc: usdcToLamports(input.amountUsdc),
        lockUntil: Math.floor(Date.now() / 1000) + input.lockDurationSeconds,
      })
      const ataIx = buildCreateAtaInstruction({ payer: address, ata: buyerUsdc, owner: address, mint })
      await wallet.sendTransactions([toWalletInstruction(ataIx), toWalletInstruction(ix)])
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

      const ix = getReleaseEscrowInstruction({
        farmer: walletSigner(address),
        escrow,
        escrowVault,
        farmerUsdc,
      })
      const ataIx = buildCreateAtaInstruction({ payer: address, ata: farmerUsdc, owner: address, mint })
      await wallet.sendTransactions([toWalletInstruction(ataIx), toWalletInstruction(ix)])
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

      const ix = getCancelEscrowInstruction({
        buyer: walletSigner(address),
        escrow,
        escrowVault,
        buyerUsdc,
      })
      const ataIx = buildCreateAtaInstruction({ payer: address, ata: buyerUsdc, owner: address, mint })
      await wallet.sendTransactions([toWalletInstruction(ataIx), toWalletInstruction(ix)])
      await queryClient.invalidateQueries({ queryKey: ['indorse'] })
      return escrow
    },
  })
}
