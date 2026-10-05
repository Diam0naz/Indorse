/**
 * scripts/init-config.cjs — one-shot bootstrap of program state per ledger.
 *
 * Five pieces of state have to exist before the protocol paths can run:
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
 *  3. The verifier set (["verifier_set"], Phase 1): quorum k and bond price,
 *     signed by whoever holds config.admin *now* (derived key after the
 *     role-keys rotation, bootstrap before it). Membership itself is a
 *     per-member `post_bond` — deliberately not scripted, because each
 *     verifier must pay their own bond from their own wallet.
 *
 *  4. The bond vault: the verifier set's canonical USDC ATA, validated by
 *     address inside `post_bond` (same external-create pattern as the
 *     treasury ATA).
 *
 *  5. The oracle set (["oracle_set"], Phase 2): odd quorum k (median rules)
 *     plus its reader seats, assigned by config.admin. Unlike verifiers the
 *     readers carry no bond — the median is the defence — so this script can
 *     seat them itself: the deterministic `oracle-1…n` keys from role-keys,
 *     each topped up for fees and the tally's first-rent.
 *
 * Re-running after a devnet reset is safe: all five steps are idempotent.
 *
 *   node scripts/init-config.cjs                          # devnet (default)
 *   RPC_URL=http://127.0.0.1:8899 node scripts/init-config.cjs   # localnet
 *
 * ADMIN / VERIFIER / ORACLE (base58) override the initial role keys;
 * USDC_MINT (base58) overrides the treasury/bond mint; K and BOND_AMOUNT
 * (atomic units, defaults 2 and 5 USDC) set the verifier-set rules;
 * ORACLE_K (odd, default 3) sets the median quorum and reader count.
 */
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')
const anchor = require('@coral-xyz/anchor')
const { getOrCreateAssociatedTokenAccount } = require('@solana/spl-token')
const { oracleReaders, pickAdminSigner } = require('./role-keys.cjs')

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
  let config
  const existing = await connection.getAccountInfo(configPda)
  if (existing) {
    config = await program.account.config.fetch(configPda)
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

    config = await program.account.config.fetch(configPda)
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
  const hasMint = Boolean(await connection.getAccountInfo(usdcMint))
  if (hasMint) {
    const treasuryUsdc = await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, treasuryPda, true)
    console.log('treasury USDC ATA at', treasuryUsdc.address.toBase58())
    console.log({ treasury: treasuryPda.toBase58(), mint: usdcMint.toBase58() })
  } else {
    console.log('no USDC mint on this cluster (' + usdcMint.toBase58() + '); skipping the treasury ATA')
  }

  // 3. Verifier set (Phase 1) — signed by whoever holds config.admin *now*.
  const [verifierSetPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from('verifier_set')],
    program.programId,
  )
  if (await connection.getAccountInfo(verifierSetPda)) {
    const set = await program.account.verifierSet.fetch(verifierSetPda)
    console.log('verifier set already initialised at', verifierSetPda.toBase58())
    console.log({ k: set.k, bondAmount: set.bondAmount.toString(), members: set.members.length })
  } else {
    const signer = pickAdminSigner(config.admin.toBase58(), payer)
    const k = Number(process.env.K ?? 2)
    const bond = new anchor.BN(process.env.BOND_AMOUNT ?? '5000000')

    // init pays rent from the signer, and the derived admin starts empty —
    // top it up from the bootstrap wallet first (bootstrap pays this fee too).
    if ((await connection.getBalance(signer.publicKey)) < 10_000_000) {
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: signer.publicKey,
          lamports: 100_000_000,
        }),
      )
      await provider.sendAndConfirm(fundTx)
      console.log('funded', signer.publicKey.toBase58(), 'with 0.1 SOL for rent')
    }

    const signature = await program.methods
      .initVerifierSet(k, bond)
      .accounts({
        authority: signer.publicKey,
        config: configPda,
        verifierSet: verifierSetPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([signer])
      .rpc()
    console.log('init_verifier_set', signature)
    console.log({ verifierSet: verifierSetPda.toBase58(), k, bondAmount: bond.toString() })
  }

  // 4. Bond vault — the verifier set's canonical USDC ATA (post_bond
  //    validates it by address; the program never creates accounts).
  if (hasMint) {
    const bondVault = await getOrCreateAssociatedTokenAccount(connection, payer, usdcMint, verifierSetPda, true)
    console.log('bond vault USDC ATA at', bondVault.address.toBase58())
    console.log({ verifierSet: verifierSetPda.toBase58(), mint: usdcMint.toBase58() })
  } else {
    console.log('skipping the bond-vault ATA (no USDC mint on this cluster)')
  }

  // 5. Oracle set (Phase 2) — the admin-managed reader seats; their median
  //    (odd k) is the only season reading settle_policy will trust.
  const [oracleSetPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('oracle_set')], program.programId)
  const k = Number(process.env.ORACLE_K ?? 3)
  const readers = oracleReaders(k) // seats default to the quorum itself
  let oracleSet
  if (await connection.getAccountInfo(oracleSetPda)) {
    oracleSet = await program.account.oracleSet.fetch(oracleSetPda)
    console.log('oracle set already initialised at', oracleSetPda.toBase58())
    console.log({ k: oracleSet.k, members: oracleSet.members.length })
  } else {
    const signer = pickAdminSigner(config.admin.toBase58(), payer)
    // init pays rent from the signer, and the derived admin starts empty —
    // top it up from the bootstrap wallet first (bootstrap pays this fee too).
    if ((await connection.getBalance(signer.publicKey)) < 10_000_000) {
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: signer.publicKey,
          lamports: 100_000_000,
        }),
      )
      await provider.sendAndConfirm(fundTx)
      console.log('funded', signer.publicKey.toBase58(), 'with 0.1 SOL for rent')
    }

    const signature = await program.methods
      .initOracleSet(k)
      .accounts({
        authority: signer.publicKey,
        config: configPda,
        oracleSet: oracleSetPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([signer])
      .rpc()
    console.log('init_oracle_set', signature)
    console.log({ oracleSet: oracleSetPda.toBase58(), k })
    oracleSet = await program.account.oracleSet.fetch(oracleSetPda)
  }

  // Seats (idempotent): each deterministic reader gets a seat if it lacks
  // one. Unlike verifiers they carry no bond, so the admin can seat them —
  // but add_oracle still signs as config.admin, never as the reader.
  const seated = new Set(oracleSet.members.map((m) => m.toBase58()))
  const missing = readers.filter((reader) => !seated.has(reader.publicKey.toBase58()))
  if (missing.length > 0) {
    const signer = pickAdminSigner(config.admin.toBase58(), payer)
    for (const reader of missing) {
      const signature = await program.methods
        .addOracle(reader.publicKey)
        .accounts({ authority: signer.publicKey, config: configPda, oracleSet: oracleSetPda })
        .signers([signer])
        .rpc()
      console.log('add_oracle', signature, reader.publicKey.toBase58())
    }
    oracleSet = await program.account.oracleSet.fetch(oracleSetPda)
  }

  // Gas for the readers: fees are paid by whoever submits, and the season's
  // first reading also pays the tally's rent — so each seat carries SOL.
  for (const reader of readers) {
    if ((await connection.getBalance(reader.publicKey)) < 20_000_000) {
      const fundTx = new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: reader.publicKey,
          lamports: 50_000_000,
        }),
      )
      await provider.sendAndConfirm(fundTx)
      console.log('funded reader', reader.publicKey.toBase58(), 'with 0.05 SOL for fees + rent')
    }
  }
  console.log({
    oracleSet: oracleSetPda.toBase58(),
    k: oracleSet.k,
    members: oracleSet.members.map((m) => m.toBase58()),
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
