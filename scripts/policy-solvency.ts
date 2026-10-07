/**
 * scripts/policy-solvency.ts — can every active policy be paid?
 *
 * Reads every `Policy` account the program owns, derives its insurance
 * vault, and compares the vault balance against the policy's coverage —
 * the same `vault.amount >= coverage` requirement `settle_policy` enforces
 * at payout time. A vault below its coverage (or missing entirely) is a
 * policy that will refuse to settle: the pre-demo solvency gap, made
 * measurable before anyone presses the button.
 *
 *   npx tsx scripts/policy-solvency.ts [rpc-url]
 *   SMOKE_RPC=… npx tsx scripts/policy-solvency.ts   # env fallback
 *
 * Defaults to https://api.devnet.solana.com. Exit codes:
 *   0 — every active policy's vault holds its coverage (or none exist)
 *   1 — at least one active policy is short or has no vault
 *   2 — could not reach or parse the cluster (never a silent pass)
 *
 * Terminal policies (PaidOut/Expired) are skipped: their vaults no longer
 * feed a settlement. The treasury balance is printed as context only —
 * active vaults pay themselves; the treasury funds *new* policies.
 */

import process from 'node:process'
import { getBase58Decoder, getBase64Encoder, type Address, type Base58EncodedBytes } from '@solana/kit'
import { POLICY_DISCRIMINATOR, PolicyState, getPolicyDecoder } from '../lib/generated/indorse'
import { ataPda, createProgramRpc, insuranceVaultPda, treasuryPda } from '../lib/program'
import { IDL_PROGRAM_ID } from '../lib/program/idl'

/** SPL Token program — every insurance vault must be owned by it. */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

/** USDC has 6 decimals — same unit the program stores amounts in. */
const USDC_DECIMALS = 1_000_000

const base64Encoder = getBase64Encoder()

/** Display only — on-chain comparisons below stay in bigint. */
function fmtUsdc(amount: bigint): string {
  return (Number(amount) / USDC_DECIMALS).toFixed(6)
}

interface PolicyRow {
  address: string
  farm: Address
  index: number
  coverage: bigint
  /** Vault mint, set when the vault exists (drives the treasury line). */
  mint: string | null
  /** Vault balance, or null when the vault account does not exist. */
  vault: bigint | null
}

/** u64 at offset 64 of an SPL token account — its `amount` field. */
function tokenAmount(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true)
}

/** The 32-byte mint at offset 0 of an SPL token account. */
function tokenMint(data: Uint8Array): Address {
  return getBase58Decoder().decode(data.subarray(0, 32)) as Address
}

async function main(): Promise<number> {
  const url = process.argv[2] ?? process.env.SMOKE_RPC ?? 'https://api.devnet.solana.com'
  const rpc = createProgramRpc(url)
  const policyDecoder = getPolicyDecoder()
  const discriminator = getBase58Decoder().decode(POLICY_DISCRIMINATOR as Uint8Array)

  // The discriminator memcmp is the same filter Anchor's account.all()
  // sends — 8 bytes of sha256("account:Policy"), unique across accounts.
  const found = await rpc
    .getProgramAccounts(IDL_PROGRAM_ID as Address, {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: 0n,
            bytes: discriminator as string as Base58EncodedBytes,
            encoding: 'base58',
          },
        },
      ],
    })
    .send()

  const active: PolicyRow[] = []
  const settled: Record<string, number> = {}
  for (const { pubkey, account } of found) {
    const data = new Uint8Array(base64Encoder.encode(account.data[0]))
    const policy = policyDecoder.decode(data)
    if (policy.state !== PolicyState.Active) {
      const name = PolicyState[policy.state] ?? `Unknown(${policy.state})`
      settled[name] = (settled[name] ?? 0) + 1
      continue
    }
    active.push({
      address: pubkey as string,
      farm: policy.farm,
      index: policy.index,
      coverage: policy.coverageUsdc,
      mint: null,
      vault: null,
    })
  }

  // Vault balances: one read per active policy. A missing vault is a
  // settlement that can never happen — reported, never assumed zero.
  for (const row of active) {
    const vaultAddress = await insuranceVaultPda(row.farm, row.index)
    const { value } = await rpc.getAccountInfo(vaultAddress, { encoding: 'base64' }).send()
    if (!value) continue
    if (value.owner !== TOKEN_PROGRAM) {
      throw new Error(`vault ${vaultAddress} is owned by ${value.owner}, not the token program`)
    }
    const data = new Uint8Array(base64Encoder.encode(value.data[0]))
    if (data.length < 72) throw new Error(`vault ${vaultAddress} is not an SPL token account`)
    row.vault = tokenAmount(data)
    row.mint = tokenMint(data)
  }

  // Treasury context: one read per distinct vault mint.
  const treasury = await treasuryPda()
  const treasuryBalances: { mint: string; amount: bigint }[] = []
  for (const mint of new Set(active.flatMap((row) => (row.mint ? [row.mint] : [])))) {
    const ata = await ataPda(treasury, mint)
    const { value } = await rpc.getAccountInfo(ata, { encoding: 'base64' }).send()
    if (value) {
      treasuryBalances.push({
        mint,
        amount: tokenAmount(new Uint8Array(base64Encoder.encode(value.data[0]))),
      })
    }
  }

  // Report.
  console.log(`policy-solvency — ${url}`)
  console.log(`program ${IDL_PROGRAM_ID}\n`)

  if (active.length > 0) {
    const head = `${'POLICY'.padEnd(44)} ${'INDEX'.padStart(5)} ${'COVERAGE'.padStart(14)} ${'VAULT'.padStart(14)}  STATUS`
    console.log(head)
    let short = 0
    for (const row of active) {
      let status: string
      if (row.vault === null) {
        status = 'VAULT MISSING'
        short += 1
      } else if (row.vault >= row.coverage) {
        status = 'funded'
      } else {
        status = `SHORT by ${fmtUsdc(row.coverage - row.vault)}`
        short += 1
      }
      const vault = row.vault === null ? '(missing)' : fmtUsdc(row.vault)
      console.log(
        `${row.address.padEnd(44)} ${String(row.index).padStart(5)} ${fmtUsdc(row.coverage).padStart(14)} ${vault.padStart(14)}  ${status}`,
      )
    }
    console.log('')

    for (const { mint, amount } of treasuryBalances) {
      console.log(`treasury ${fmtUsdc(amount)} USDC (mint ${mint})`)
    }
    const totalCoverage = active.reduce((sum, row) => sum + row.coverage, 0n)
    console.log(
      `${active.length} active · ${fmtUsdc(totalCoverage)} USDC to pay · ${short} short` +
        (settled.PaidOut || settled.Expired
          ? ` · ${settled.PaidOut ?? 0} PaidOut / ${settled.Expired ?? 0} Expired skipped`
          : ''),
    )
    if (short > 0) {
      console.error(`FAIL — ${short} of ${active.length} active policies cannot be settled (vault below coverage)`)
      return 1
    }
    console.log('OK — every active policy’s vault holds its coverage')
    return 0
  }

  const skipped = Object.entries(settled)
    .map(([name, count]) => `${count} ${name}`)
    .join(' · ')
  console.log(`no active policies${skipped ? ` (${skipped} skipped)` : ''}`)
  console.log('OK — nothing to pay')
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err: unknown) => {
    console.error(`policy-solvency: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 2
  })
