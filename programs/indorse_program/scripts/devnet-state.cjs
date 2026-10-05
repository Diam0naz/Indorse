/**
 * scripts/devnet-state.cjs — read-only preflight for the devnet lifecycle
 * rehearsal. Prints everything the rehearsal needs to know before it spends
 * a lamport: verifier-set layout (old vs. Phase 3A size), rules, membership,
 * vault/treasury balances, and whether the bootstrap wallet can fund the run.
 *
 *   node scripts/devnet-state.cjs
 *
 * Read-only: no transaction is ever sent.
 */
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')
const anchor = require('@coral-xyz/anchor')
const { getAssociatedTokenAddressSync } = require('@solana/spl-token')

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const KEY_PATH = process.env.SOLANA_KEYPAIR ?? join(homedir(), '.config/solana/id.json')
const IDL = require(resolve(__dirname, '../../../lib/idl/indorse_program.json'))
const OLD_SET_SIZE = 246 // 8 + pre-Phase-3A VerifierSet (238)
const CURRENT_SET_SIZE = 8 + 294 // 8 + VerifierSet::MAX_SIZE today

async function main() {
  const secret = Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, 'utf8')))
  const payer = anchor.web3.Keypair.fromSecretKey(secret)
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed')
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: 'confirmed',
  })
  const program = new anchor.Program(IDL, provider)

  const usdc = new anchor.web3.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)
  const [setPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('verifier_set')], program.programId)
  const [treasuryPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('treasury')], program.programId)

  const lamports = (n) => (n / anchor.web3.LAMPORTS_PER_SOL).toFixed(4)
  const usdcAmt = (n) => (Number(n) / 1_000_000).toFixed(2)

  const config = await program.account.config.fetch(configPda)
  console.log('config', configPda.toBase58(), {
    admin: config.admin.toBase58(),
    verifier: config.verifier.toBase58(),
    oracle: config.oracle.toBase58(),
  })

  const info = await connection.getAccountInfo(setPda)
  if (!info) throw new Error('verifier set missing on this cluster — run scripts/init-config.cjs first')
  console.log('verifier set', setPda.toBase58(), {
    dataLen: info.data.length,
    layout:
      info.data.length === CURRENT_SET_SIZE
        ? 'phase-3a'
        : info.data.length === OLD_SET_SIZE
          ? 'OLD (realloc fires on first join)'
          : 'UNKNOWN',
  })
  const set = await program.account.verifierSet.fetch(setPda)
  console.log('rules', {
    k: set.k,
    bondAmount: usdcAmt(set.bondAmount) + ' USDC',
    members: set.members.map((m) => ({ pubkey: m.pubkey.toBase58(), stake: usdcAmt(m.stake) })),
  })

  const vault = getAssociatedTokenAddressSync(usdc, setPda, true)
  const treasuryUsdc = getAssociatedTokenAddressSync(usdc, treasuryPda, true)
  const payerUsdc = getAssociatedTokenAddressSync(usdc, payer.publicKey)
  const balance = async (owner, addr) => {
    try {
      const a = await connection.getTokenAccountBalance(addr)
      return usdcAmt(a.value.amount) + ' USDC'
    } catch {
      return owner === 'payer' ? 'no ATA' : 'missing'
    }
  }
  console.log('balances', {
    bootstrapSOL: lamports(await connection.getBalance(payer.publicKey)) + ' SOL',
    bootstrapUSDC: await balance('payer', payerUsdc),
    bondVault: await balance('vault', vault),
    treasuryUSDC: await balance('treasury', treasuryUsdc),
  })
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
