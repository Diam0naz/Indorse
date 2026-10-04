/**
 * scripts/bootstrap-sas.ts — one-time SAS setup for email attestations
 *
 * Creates the two on-chain objects this app's email verification needs and
 * prints the env block to paste into `.env`:
 *
 *   1. a Credential named after the issuer ("indorse"),
 *   2. an "indorse.email" Schema under it: [string, i64, string] =
 *      ["emailHash", "verifiedAt", "method"].
 *
 *   SAS_AUTHORITY_SECRET=<base58 or JSON secret key> \
 *     npx -y tsx scripts/bootstrap-sas.ts
 *     # or: npm run sas:bootstrap
 *
 * The script is idempotent: if the credential or schema already exists it
 * skips that step and prints the same addresses. It never overwrites anything.
 *
 * Env:
 *   SAS_AUTHORITY_SECRET — credential authority / payer (falls back to
 *                          SAS_ISSUER_SECRET). base58 or a keygen JSON array.
 *   SAS_ACCOUNT_NAME     — credential name, default "indorse"
 *   SAS_SCHEMA_NAME      — schema name, default "indorse.email"
 *   SAS_EXTRA_SIGNERS    — comma-separated addresses added as authorized signers
 *   SAS_RPC_URL          — defaults to devnet (or EXPO_PUBLIC_SOLANA_RPC_URL)
 *
 * Why not `@solana/attestation`: it targets @solana/kit v8 (this repo is on v7)
 * and is not published. The instructions are built from the SAS IDL in
 * `lib/program/sas.ts` instead.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  address,
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  createKeyPairFromBytes,
  createSignerFromKeyPair,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getBase58Encoder,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type ReadonlyUint8Array,
  type RpcSubscriptions,
  type SolanaRpcSubscriptionsApi,
  type TransactionSigner,
} from '@solana/kit'
import {
  INDORSE_CREDENTIAL_NAME,
  INDORSE_EMAIL_SCHEMA,
  createCredentialInstruction,
  createSchemaInstruction,
  credentialPda,
  schemaPda,
} from '../lib/program/sas'
import type { ProgramRpc } from '../lib/program/rpc'

const DEFAULT_RPC_URL = 'https://api.devnet.solana.com'

/** Minimal `KEY=value` loader — no dependency, no override of real env. */
function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    const [, key, raw] = match
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, '')
  }
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** Decode a keypair from base58 or a `[1,2,…]` keygen JSON array. */
function decodeSecretKey(raw: string): ReadonlyUint8Array {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) fail('SAS_AUTHORITY_SECRET JSON is not an array')
    return Uint8Array.from(parsed as number[])
  }
  return getBase58Encoder().encode(trimmed)
}

async function signerFromEnv(): Promise<TransactionSigner> {
  const raw = process.env.SAS_AUTHORITY_SECRET?.trim() || process.env.SAS_ISSUER_SECRET?.trim()
  if (!raw) {
    fail(
      'No authority key found. Set SAS_AUTHORITY_SECRET (or SAS_ISSUER_SECRET) to the base58\n' +
        '  secret key of the wallet that will own the SAS credential, e.g.\n' +
        '    (the full base58 keypair, or the 64-number JSON array from solana-keygen)',
    )
  }
  const bytes = decodeSecretKey(raw)
  if (bytes.length !== 64) fail(`Expected a 64-byte secret key, got ${bytes.length} bytes`)
  const keyPair = await createKeyPairFromBytes(bytes)
  return createSignerFromKeyPair(keyPair)
}

function rpcUrlFromEnv(): string {
  return process.env.SAS_RPC_URL?.trim() || process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL
}

/** `https://` → `wss://`, `http://` → `ws://`. */
function subscriptionsUrl(rpcUrl: string): string {
  return rpcUrl.replace(/^http/, 'ws')
}

/** True when the account exists on chain. */
async function accountExists(rpc: ProgramRpc, account: string): Promise<boolean> {
  const res = await rpc.getAccountInfo(address(account), { encoding: 'base64', commitment: 'confirmed' }).send()
  return res.value !== null
}

async function rpcBalance(rpc: ProgramRpc, owner: string): Promise<bigint> {
  const { value } = await rpc.getBalance(address(owner), { commitment: 'confirmed' }).send()
  return value
}

async function send(
  rpc: ProgramRpc,
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>,
  signer: TransactionSigner,
  instruction: Instruction,
  label: string,
): Promise<void> {
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstruction(instruction, tx),
  )

  const signed = await signTransactionMessageWithSigners(message)
  assertIsTransactionWithBlockhashLifetime(signed)
  assertIsTransactionWithinSizeLimit(signed)
  console.log(`  · sending ${label}…`)
  await sendAndConfirm(signed, { commitment: 'confirmed' })
  console.log(`  ✓ ${label} confirmed`)
}

async function main(): Promise<void> {
  loadDotEnv()

  const rpcUrl = rpcUrlFromEnv()
  const authority = await signerFromEnv()
  const credentialName = process.env.SAS_ACCOUNT_NAME?.trim() || INDORSE_CREDENTIAL_NAME
  const schemaName = process.env.SAS_SCHEMA_NAME?.trim() || INDORSE_EMAIL_SCHEMA.name
  const extraSigners = (process.env.SAS_EXTRA_SIGNERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const payer = authority.address as string
  const credential = await credentialPda(payer, credentialName)
  const schema = await schemaPda(credential, schemaName, INDORSE_EMAIL_SCHEMA.version)

  const rpc: ProgramRpc = createSolanaRpc(rpcUrl)
  const rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi> = createSolanaRpcSubscriptions(
    subscriptionsUrl(rpcUrl),
  )

  console.log(`SAS bootstrap on ${rpcUrl}`)
  console.log(`  authority   ${payer}`)
  console.log(`  credential  ${credential}`)
  console.log(`  schema      ${schema}\n`)

  const hasCredential = await accountExists(rpc, credential)
  const hasSchema = hasCredential ? await accountExists(rpc, schema) : false

  if (!hasCredential || !hasSchema) {
    const balance = await rpcBalance(rpc, payer)
    if (balance === 0n) {
      fail(`${payer} has no SOL on ${rpcUrl}. Fund it first:\n` + `  solana airdrop 1 ${payer} --url ${rpcUrl}`)
    }
  }

  if (hasCredential) {
    console.log('• credential already exists — skipping')
  } else {
    const instruction = await createCredentialInstruction({
      payer,
      authority: payer,
      name: credentialName,
      signers: [payer, ...extraSigners],
    })
    await send(rpc, rpcSubscriptions, authority, instruction, `CreateCredential "${credentialName}"`)
  }

  if (hasSchema) {
    console.log('• schema already exists — skipping')
  } else {
    const instruction = await createSchemaInstruction({
      payer,
      authority: payer,
      credential,
      name: schemaName,
      description: INDORSE_EMAIL_SCHEMA.description,
      layout: INDORSE_EMAIL_SCHEMA.layout,
      fieldNames: INDORSE_EMAIL_SCHEMA.fieldNames,
      version: INDORSE_EMAIL_SCHEMA.version,
    })
    await send(rpc, rpcSubscriptions, authority, instruction, `CreateSchema "${schemaName}"`)
  }

  console.log('\nDone. Add this to your .env (never commit it):\n')
  console.log(`SAS_ISSUER_SECRET=${process.env.SAS_AUTHORITY_SECRET?.trim() || process.env.SAS_ISSUER_SECRET?.trim()}`)
  console.log(`SAS_CREDENTIAL_PDA=${credential}`)
  console.log(`SAS_SCHEMA_PDA=${schema}`)
  console.log(`SAS_RPC_URL=${rpcUrl}`)
  console.log('# SAS_EMAIL_PEPPER=<random string>   # optional, hardens the on-chain email hash')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
