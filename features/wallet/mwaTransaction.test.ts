/**
 * features/wallet/mwaTransaction.test.ts — the payload Solflare receives
 *
 * `wallet.sendTransactions` compiles these instructions into one v0
 * transaction and hands it to Mobile Wallet Adapter. When a signing request
 * bounces with no approval UI, a malformed payload is the first thing to
 * rule out — so this pins the three properties a wallet needs:
 *
 *   1. the signer *object* is stripped (kit's dedupe would otherwise throw
 *      against the wallet's own fee-payer signer) while the signer ROLE
 *      survives, so the wallet knows to ask for a signature,
 *   2. exactly one signature slot, owned by the fee payer (the wallet) —
 *      a second required signer with no signer behind it never reaches the
 *      chain,
 *   3. the wire transaction stays under Solana's 1232-byte packet limit.
 */

import { describe, expect, it } from 'vitest'
import type { Blockhash } from '@solana/kit'
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { getCreatePolicyInstruction } from '@/lib/generated/indorse'
import { ataPda, buildCreateAtaInstruction, insuranceVaultPda, policyPda, toAddress, treasuryPda } from '@/lib/program'
import { toWalletInstruction, walletSigner } from '@/features/wallet/mwaTransaction'
import { USDC_DEVNET } from '@/constants/tokens'

/** A valid 32-byte base58 address, and a base58 32 zero blockhash. */
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const FARM = 'FARM111111111111111111111111111111111111111'
const BLOCKHASH = '11111111111111111111111111111111' as Blockhash

/** Solana's packet ceiling — a transaction over this is undeliverable. */
const MAX_WIRE_BYTES = 1232

describe('MWA payload', () => {
  async function buildCreatePolicyPayload() {
    const [policy, insuranceVault, farmerUsdc, treasury] = await Promise.all([
      policyPda(FARM, 0),
      insuranceVaultPda(FARM, 0),
      ataPda(WALLET, USDC_DEVNET),
      treasuryPda(),
    ])
    const treasuryUsdc = await ataPda(treasury, USDC_DEVNET)

    const ix = getCreatePolicyInstruction({
      farmer: walletSigner(WALLET),
      farm: toAddress(FARM),
      policy,
      insuranceVault,
      farmerUsdc,
      usdcMint: toAddress(USDC_DEVNET),
      treasury,
      treasuryUsdc,
      crop: 'Sunflower',
      coverageUsdc: 100_000_000n,
      premiumUsdc: 5_000_000n,
      triggerThresholdMm: 1200,
      seasonStart: 1_760_000_000n,
      seasonEnd: 1_762_000_000n,
    })
    const ataIx = buildCreateAtaInstruction({ payer: WALLET, ata: farmerUsdc, owner: WALLET, mint: USDC_DEVNET })

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => appendTransactionMessageInstructions([toWalletInstruction(ataIx), toWalletInstruction(ix)], tx),
      (tx) => setTransactionMessageFeePayerSigner(walletSigner(WALLET), tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000n }, tx),
    )

    return { ataIx, ix, compiled: compileTransaction(message) }
  }

  it('strips the signer object but keeps the signer role', async () => {
    const { ix } = await buildCreatePolicyPayload()

    // Raw: a signer OBJECT — handing that to kit's signAndSend collides with
    // the wallet's own fee-payer signer at the same address and throws.
    const raw = (ix.accounts ?? [])[0] as { signer?: unknown; role: number }
    expect('signer' in raw).toBe(true)

    // Handed over: a plain meta, with the signer ROLE intact so the wallet
    // still knows a signature is required there. 3 = writable signer.
    const farmer = (toWalletInstruction(ix).accounts ?? [])[0] as unknown as Record<string, unknown>
    expect('signer' in farmer).toBe(false)
    expect(farmer.role).toBe(raw.role)
    expect(farmer.role).toBe(3)
  })

  it('compiles to a single-signer transaction inside the packet limit', async () => {
    const { compiled } = await buildCreatePolicyPayload()

    // One slot, owned by the fee payer: the wallet signs for itself and for
    // the farmer account, which is the same address.
    const slots = Object.keys(compiled.signatures)
    expect(slots).toHaveLength(1)
    expect(slots[0]).toBe(WALLET)

    const bytes = Math.floor((getBase64EncodedWireTransaction(compiled).length * 3) / 4)
    expect(bytes).toBeLessThanOrEqual(MAX_WIRE_BYTES)
  })
})
