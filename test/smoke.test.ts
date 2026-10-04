/**
 * test/smoke.test.ts — live end-to-end smoke of the on-chain client.
 *
 * Exercises the exact path the app takes — `buildInstruction` → kit signing →
 * send → confirm → `fetchAccount` round-trip — against a real cluster:
 *
 *   local:  SMOKE_RPC=http://127.0.0.1:8899 npx vitest run test/smoke.test.ts
 *   devnet: SMOKE_RPC=https://api.devnet.solana.com npx vitest run test/smoke.test.ts
 *
 * Signs with `SMOKE_KEY` (default `~/.config/solana/id.json`) and needs a
 * funded wallet; on a local validator a low balance is topped up from the
 * faucet automatically, on devnet the wallet must already hold SOL.
 *
 * The suite is skipped unless `SMOKE_RPC` is set, so the offline gate never
 * touches the network. It is idempotent: an existing farm is reused and each
 * run appends one report at the farm's next free index.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Lamports,
  type Signature,
} from '@solana/kit'
import { buildInstruction, createProgramRpc, farmPda, fetchAccount, reportPda, type ProgramRpc } from '@/lib/program'
import type { Farm } from '@/features/farm/types'
import type { ScoutReport } from '@/features/reports/types'

const SMOKE_RPC = process.env.SMOKE_RPC ?? ''
const SMOKE_KEY = process.env.SMOKE_KEY ?? join(homedir(), '.config/solana/id.json')

/** Distinctive coordinates so a smoke farm is easy to recognise on-chain. */
const LAT_E6 = 34_052_000
const LNG_E6 = -118_243_000
const AI_LABEL = 'smoke-ok'
const ONE_SOL = 1_000_000_000n

/** Deterministic 32-byte stand-in for the camera photo hash. */
function smokePhotoHash(): number[] {
  return Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 256)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll `getSignatureStatuses` until the signature confirms or fails. */
async function confirm(rpc: ProgramRpc, signature: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await rpc.getSignatureStatuses([signature as Signature]).send()
    const status = res.value[0]
    if (status?.err) throw new Error(`transaction failed: ${JSON.stringify(status.err)}`)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${signature}`)
    await sleep(400)
  }
}

/** Build → sign (local keypair) → send → confirm; returns the signature. */
async function sendIx(rpc: ProgramRpc, signer: KeyPairSigner, ix: Instruction): Promise<string> {
  const blockhash = await rpc.getLatestBlockhash().send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash.value, tx),
    (tx) => appendTransactionMessageInstructions([ix], tx),
  )
  const signed = await signTransactionMessageWithSigners(message)
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64' }).send()
  await confirm(rpc, signature)
  return signature
}

/** Ensure the signer can pay fees; pulls from the local faucet when needed. */
async function fundIfNeeded(rpc: ProgramRpc, signer: KeyPairSigner): Promise<bigint> {
  let lamports = BigInt((await rpc.getBalance(signer.address).send()).value)
  if (lamports >= ONE_SOL / 100n) return lamports
  console.log(' · balance below 0.01 SOL — requesting airdrop')
  try {
    await rpc.requestAirdrop(signer.address, ONE_SOL as Lamports).send()
  } catch (err) {
    console.log(` · airdrop failed: ${(err as Error).message}`)
  }
  const deadline = Date.now() + 30_000
  while (lamports < ONE_SOL / 100n && Date.now() < deadline) {
    await sleep(500)
    lamports = BigInt((await rpc.getBalance(signer.address).send()).value)
  }
  return lamports
}

describe.runIf(SMOKE_RPC)('on-chain smoke', () => {
  it('registers a farm, submits a scout report, and reads both back', async () => {
    console.log(`rpc      ${SMOKE_RPC}`)
    const rpc = createProgramRpc(SMOKE_RPC)

    const keyBytes = new Uint8Array(JSON.parse(readFileSync(SMOKE_KEY, 'utf8')) as number[])
    const signer = await createKeyPairSignerFromBytes(keyBytes)
    console.log(`signer   ${signer.address}`)
    console.log(`slot     ${await rpc.getSlot().send()}`)

    const lamports = await fundIfNeeded(rpc, signer)
    if (lamports === 0n) throw new Error(`no SOL in ${SMOKE_KEY} — fund the wallet and retry`)
    console.log(`balance  ${Number(lamports) / 1e9} SOL`)
    expect(lamports).toBeGreaterThan(0n)

    // ── register_farm (or reuse the wallet's existing farm) ──────────────
    const farmAddress = await farmPda(signer.address)
    let farm = await fetchAccount<Farm>(rpc, farmAddress, 'Farm')
    let registeredNow = false
    if (!farm) {
      const ix = buildInstruction(
        'register_farm',
        { owner: signer.address, farm: farmAddress },
        { name: 'Smoke Test Farm', latE6: LAT_E6, lngE6: LNG_E6 },
      )
      const signature = await sendIx(rpc, signer, ix)
      console.log(`register_farm        ${signature}`)
      farm = await fetchAccount<Farm>(rpc, farmAddress, 'Farm')
      registeredNow = true
    } else {
      console.log(`farm exists          ${farmAddress} (reusing)`)
    }
    if (!farm) throw new Error(`farm account missing after register at ${farmAddress}`)
    expect(farm.owner).toBe(signer.address)
    if (registeredNow) {
      expect(farm.name).toBe('Smoke Test Farm')
      expect(farm.latE6).toBe(LAT_E6)
      expect(farm.lngE6).toBe(LNG_E6)
    }
    console.log(`farm                 ${farmAddress} (reports=${farm.reportCount})`)

    // ── submit_scout_report at the farm's next free index ────────────────
    const nextIndex = farm.reportCount
    const reportAddress = await reportPda(farmAddress, nextIndex)
    const occupied = await fetchAccount(rpc, reportAddress, 'ScoutReport')
    expect(occupied).toBeNull()

    const hash = smokePhotoHash()
    const uri = `https://indorse.example/smoke/${Date.now()}.jpg`
    const submitIx = buildInstruction(
      'submit_scout_report',
      { reporter: signer.address, farm: farmAddress, report: reportAddress },
      { photoHash: hash, uri, latE6: LAT_E6, lngE6: LNG_E6, aiLabel: AI_LABEL },
    )
    const signature = await sendIx(rpc, signer, submitIx)
    console.log(`submit_scout_report  ${signature}`)

    // ── read both accounts back through the codec ────────────────────────
    const report = await fetchAccount<ScoutReport>(rpc, reportAddress, 'ScoutReport')
    if (!report) throw new Error(`report account missing at ${reportAddress}`)
    expect(report).toMatchObject({
      farm: farmAddress,
      reporter: signer.address,
      index: nextIndex,
      photoHash: hash,
      uri,
      latE6: LAT_E6,
      lngE6: LNG_E6,
      aiLabel: AI_LABEL,
      status: 'pending',
    })
    expect(report.timestamp).toBeGreaterThan(0)

    const farmAfter = await fetchAccount<Farm>(rpc, farmAddress, 'Farm')
    if (!farmAfter) throw new Error('farm account disappeared')
    expect(farmAfter.reportCount).toBe(nextIndex + 1)

    console.log(`report               ${reportAddress} (index=${report.index}, status=${report.status})`)
    console.log(`reportCount          ${nextIndex} → ${farmAfter.reportCount}`)
    console.log('smoke OK')
  }, 300_000)
})
