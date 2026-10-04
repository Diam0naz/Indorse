/**
 * scripts/init-config.cjs — one-shot bootstrap of program state per ledger.
 *
 * Two pieces of state have to exist before the insurance paths can run:
 *
 *  1. The config PDA (["config"]): authority lives in account data, but
 *     somebody has to create that account once per ledger — the hard-coded
 *     bootstrap keypair (~/.config/solana/id.json) signs `init_config` and
 *     picks the initial admin/verifier/oracle, all three defaulting to that
 *     same key, exactly what the pre-config program did. From here on,
 *     rotating roles is a `set_roles` transaction, never a redeploy.
 *
 *  2. The treasury USDC ATA: `settle_policy` / `revoke_policy` validate the
 *     canonical ATA of the ["treasury"] PDA as their sweep destination, and
 *     the program never creates accounts — so this creates it (owner is a
 *     PDA, hence allowOwnerOffCurve). Skipped when the cluster has no USDC
 *     mint yet (fresh localnet — the integration tests mint their own).
 *
 * Re-running after a devnet reset is safe: both steps are idempotent.
 *
 *   node scripts/init-config.cjs                          # devnet (default)
 *   RPC_URL=http://127.0.0.1:8899 node scripts/init-config.cjs   # localnet
 *
 * ADMIN / VERIFIER / ORACLE (base58) override the initial role keys;
 * USDC_MINT (base58) overrides the treasury mint.
 */
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')
const anchor = require('@coral-xyz/anchor')
const { getOrCreateAssociatedTokenAccount } = require('@solana/spl-token')

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const KEY_PATH = process.env.SOLANA_KEYPAIR ?? join(homedir(), '.config/solana/id.json')
const IDL = require(resolve(__dirname, '../../../lib/idl/indorse_program.json'))

async function main() {
  const secret = Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, 'utf8')))
  const payer = anchor.web3.Keypair.fromSecretKey(secret)
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed')
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: 'confirmed',
  })
  const program = new anchor.Program(IDL, provider)

  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)
  const [treasuryPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('treasury')], program.programId)

  // 1. Config PDA — one-shot, then read-only.
  const existing = await connection.getAccountInfo(configPda)
  if (existing) {
    const config = await program.account.config.fetch(configPda)
    console.log('config already initialised at', configPda.toBase58())
    console.log({
      admin: config.admin.toBase58(),
      verifier: config.verifier.toBase58(),
      oracle: config.oracle.toBase58(),
    })
  } else {
    const role = (name) => (process.env[name] ? new anchor.web3.PublicKey(process.env[name]) : payer.publicKey)

    const signature = await program.methods
      .initConfig(role('ADMIN'), role('VERIFIER'), role('ORACLE'))
      .accounts({
        initializer: payer.publicKey,
        config: configPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc()

    const config = await program.account.config.fetch(configPda)
    console.log('init_config', signature)
    console.log('config at', configPda.toBase58())
    console.log({
      admin: config.admin.toBase58(),
      verifier: config.verifier.toBase58(),
      oracle: config.oracle.toBase58(),
    })
  }

  // 2. Treasury USDC ATA — where settle/revoke sweep refunds.
  const usdcMint = new anchor.web3.PublicKey(process.env.USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  if (!(await connection.getAccountInfo(usdcMint))) {
    console.log('no USDC mint on this cluster (' + usdcMint.toBase58() + '); skipping the treasury ATA')
    return
  }
  const treasuryUsdc = await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, treasuryPda, true)
  console.log('treasury USDC ATA at', treasuryUsdc.address.toBase58())
  console.log({ treasury: treasuryPda.toBase58(), mint: usdcMint.toBase58() })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
