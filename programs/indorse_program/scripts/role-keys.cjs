/**
 * scripts/role-keys.cjs — deterministic devnet role keys (Phase 0 rehearsal).
 *
 * Role separation without a ceremony: every role keypair derives from a
 * documented public formula, so it is reproducible forever (nothing to back
 * up, nothing to lose) and each role gets its own independent key instead of
 * one shared bootstrap key.
 *
 *   seed = sha256(`${ROLE_SEED}:${role}`)     32 bytes, ROLE_SEED below
 *   key  = Keypair.fromSeed(seed)             ed25519, Solana's own fromSeed
 *
 *   node scripts/role-keys.cjs            # print the three public keys
 *   node scripts/role-keys.cjs rotate     # set_roles(...) on-chain (idempotent)
 *
 * WARNING — the seed string is public by design (the default below), so
 * anybody can derive these keys: on devnet the roles are *structural*, not
 * secret. Anyone can sign as admin/verifier/oracle while the config says
 * they hold that role. This rehearses the Phase 0 rotation flow — real keys
 * or a Squads multisig vault are mandatory before anything value-bearing.
 *
 * ADMIN / VERIFIER / ORACLE (base58) override individual targets in
 * `rotate` — e.g. rotate back to the bootstrap key:
 *   ADMIN=<pubkey> VERIFIER=<pubkey> ORACLE=<pubkey> node scripts/role-keys.cjs rotate
 *
 * RPC_URL selects the cluster (devnet default), SOLANA_KEYPAIR the bootstrap
 * signer used while config.admin still points at it.
 */
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')
const anchor = require('@coral-xyz/anchor')

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com'
const KEY_PATH = process.env.SOLANA_KEYPAIR ?? join(homedir(), '.config/solana/id.json')
const IDL = require(resolve(__dirname, '../../../lib/idl/indorse_program.json'))
const ROLE_SEED = process.env.ROLE_SEED ?? 'indorse-devnet-role-v1'
const ROLES = ['admin', 'verifier', 'oracle']

const roleKeypair = (role) => anchor.web3.Keypair.fromSeed(createHash('sha256').update(`${ROLE_SEED}:${role}`).digest())

const deriveAll = () => Object.fromEntries(ROLES.map((r) => [r, roleKeypair(r)]))

/**
 * The signer for any config.admin-gated instruction: the derived admin key
 * once config.admin already points at it, the bootstrap keypair before the
 * first rotation, or an explicit error when neither holds the role. Shared
 * with init-config.cjs so both scripts agree on who may sign.
 */
const pickAdminSigner = (currentAdminBase58, bootstrap) => {
  const derived = roleKeypair('admin')
  if (currentAdminBase58 === derived.publicKey.toBase58()) return derived
  if (currentAdminBase58 === bootstrap.publicKey.toBase58()) return bootstrap
  throw new Error(
    `config.admin ${currentAdminBase58} matches neither the derived admin key nor ${KEY_PATH} — ` +
      'sign it from whichever key does hold it',
  )
}

module.exports = { ROLE_SEED, roleKeypair, deriveAll, pickAdminSigner }

const printRoles = (roles) => {
  console.log(`derived from sha256("${ROLE_SEED}:<role>") → Keypair.fromSeed`)
  for (const name of ROLES) console.log(`  ${name.padEnd(9)} ${roles[name].publicKey.toBase58()}`)
}

async function main() {
  const derived = deriveAll()

  if ((process.argv[2] ?? 'print') !== 'rotate') {
    printRoles(derived)
    return
  }

  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed')
  const bootstrap = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_PATH, 'utf8'))))
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(bootstrap), {
    commitment: 'confirmed',
  })
  const program = new anchor.Program(IDL, provider)
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)

  let config
  try {
    config = await program.account.config.fetch(configPda)
  } catch (err) {
    const exists = await connection.getAccountInfo(configPda)
    if (!exists) throw new Error(`no config PDA at ${configPda.toBase58()} — run scripts/init-config.cjs first`)
    throw new Error(`config exists at ${configPda.toBase58()} but the fetch failed: ${err.message ?? err}`)
  }
  const before = {
    admin: config.admin.toBase58(),
    verifier: config.verifier.toBase58(),
    oracle: config.oracle.toBase58(),
  }
  console.log('before:', before)

  // Targets: derived keys by default, env override per role.
  const target = (role) =>
    process.env[role.toUpperCase()]
      ? new anchor.web3.PublicKey(process.env[role.toUpperCase()])
      : derived[role].publicKey
  const targets = Object.fromEntries(ROLES.map((r) => [r, target(r)]))

  const unchanged = ROLES.every((r) => before[r] === targets[r].toBase58())
  if (unchanged) {
    console.log('roles already set — nothing to do')
    return
  }

  // set_roles is signed by whoever config.admin is *now*: the derived key
  // after a previous rotation, or the bootstrap keypair before the first one.
  const signer = pickAdminSigner(before.admin, bootstrap)

  const signature = await program.methods
    .setRoles(targets.admin, targets.verifier, targets.oracle)
    .accounts({ authority: signer.publicKey, config: configPda })
    .signers([signer])
    .rpc()

  const after = await program.account.config.fetch(configPda)
  console.log('set_roles', signature)
  console.log('after:   ', {
    admin: after.admin.toBase58(),
    verifier: after.verifier.toBase58(),
    oracle: after.oracle.toBase58(),
  })
}

// CLI-only: requiring this module (init-config.cjs) must not run print mode.
if (require.main === module) {
  main().catch((err) => {
    console.error(err.message ?? err)
    process.exit(1)
  })
}
