# indorse

A Solana mobile dApp for decentralised farm scouting, built with
[Expo](https://expo.dev) and the
[Mobile Wallet Adapter](https://docs.solanamobile.com/getting-started/overview)
via [`@wallet-ui/react-native-kit`](https://www.npmjs.com/package/@wallet-ui/react-native-kit).

Mobile Wallet Adapter is **Android-only**, so connecting a wallet requires an
Android device or emulator with a wallet app (e.g. Phantom, Solflare) installed.

---

## Project status

Snapshot as of **2026-10-05** — all four quality gates green
(`tsc --noEmit`, `prettier --check .`, `expo lint`, `vitest run`):
**495 tests passing · 1 skipped (the opt-in smoke test) across 58 files**.

| Area                | State   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| On-chain program    | Shipped | 27 instructions — authority is data (the config PDA `839zrf…YzaY8` on devnet holds the admin/verifier/oracle roles every ops gate reads, rotated by `set_roles` instead of a redeploy), verification is a bonded K-of-N quorum (the verifier-set PDA `H4HnKfqu…XK` holds k, the seat price, and members with their recorded stakes; `cast_vote` finalizes a report at quorum; `reconfigure_verifier_set` rewrites the rules, voluntary exits stop at the k-member floor, and `release_verifier` is governance's fair-exit valve), season readings are a median (the oracle-set PDA `12FrAm…zTf` holds an odd k and its unbound readers; the k-th reading freezes the median and `settle_policy` trusts only a finalized one), and custody is program-owned (settle/revoke sweep refunds to the treasury PDA's USDC ATA; `withdraw_treasury` releases them to the admin only); deployed to devnet (`GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht`), IDL synced via `npm run idl:sync`; 43 Anchor integration cases plus an opt-in RPC smoke test, the full Phase 1/3A lifecycle (realloc on an old-layout account, quorum floor, governed reconfigure, freeze-on-contact, release valve, recorded-stake refunds) rehearsed end to end against the live devnet state, and (Phase 3B) a live Switchboard On-Demand receipt — 3 enclave signatures proved off-chain and on-chain — relayed permissionlessly into the season tally on devnet (`5cfMd1pv…RUS8`) |
| Scout tab           | Shipped | Chain-fed log and field cards, attention banner, folding action stack, camera → AI diagnosis, the 3-step onboarding card for the no-farm state (scan works before setup — anchoring needs a farm), and a persisted scan store: captures survive restarts (`indorse.scout.v1`) and anchor through an outbox flush once a farm is reachable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Provenance & escrow | Shipped | Score, evidence trail, harvest batches; escrow create → release / cancel-and-retry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Weather             | Shipped | Policy setup, median-frozen oracle readings with error + retry, season chart plotted against the trigger — nothing reads as measured before the quorum finalizes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Profile & settings  | Shipped | Seven settings destinations (incl. Account & Local Data), passcode/biometrics app lock, hide balances, cluster health check, en/es/fr, system/dark/light themes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Data honesty        | Shipped | No mock data reaches the UI — empty states and honest guest/failure/loading notes instead; seed constants survive only as test/CSV fixtures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| CSV export          | Shipped | Live chain reads → one flat RFC 4180 file → share or copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AI proxy (`api/`)   | Shipped | One route, two backends — OpenAI (streamed, strict `json_schema`) and Gemini (`responseSchema`; provider keys never reach the device)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Device verification | Shipped | SIWS nonce/verify routes, SGT dev allowlist, transactional email via Resend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Launch media        | Shipped | Launch video in `brag-output-2026-09-30-183600/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**In flight:** the Solana Attestation Service issuer (`api/sas-issuer.ts` +
`npm run sas:bootstrap`) and the HyperFrames launch deck (`deck/`).

**Known gaps:** iOS scaffolding exists, but Mobile Wallet Adapter is
Android-only, so wallet connect is Android-only; persisted captures anchor
only to the farm that is current when the outbox flushes, and the captured
photo _files_ live in the OS cache (the hash and anchor payload persist —
the pixels are best-effort; copying each file into app storage at capture is
deferred); the React Query cache stays in-memory, so chain rows do not
survive an app restart without RPC — persisting the query client for offline
rows is deferred; on devnet the three roles are split across
deterministic per-role keys (`scripts/role-keys.cjs` — reproducible from a
public formula, so structural rather than secret), while the real Squads
M-of-N handover remains outstanding: creating the vault and signing the
rotation to it; Phase 1 verification ships bonds with a _governed_ slash only
(no automatic slash economics until real verifier behaviour exists to design
against), a set bounded at 7 members — since Phase 3A `k`/bond are
reconfigurable (`reconfigure_verifier_set`), but a split tally where every
member has already voted cannot finish after `k` is lowered, so finish open
tallies first; voluntary exits stop at the `k`-member floor, with
`release_verifier`/`slash_verifier` as governance's unconditional valves, and
the oracle-set equivalents of both are deferred until the Switchboard
question settles (compatibility is checked: `switchboard-on-demand` 0.13
compiles against anchor-lang 0.32 on a single solana 2.x stack, while classic
`switchboard-solana` 0.30 does not — it drags in anchor 0.30 +
solana-program 1.18; Phase 3B settled role 1 anyway by needing none of it —
the receipt path is native ed25519 precompile + address-pinned sysvar bytes
only, while queue/oracle-account validation (role 2) stays deferred), the now vestigial `config.verifier` field (it gates nothing since Phase 1 and is kept
only so the account layout doesn't migrate), and a protocol-fixed
`REPORT_REWARD`; Phase 2 readings defend by median alone — the readers carry
no bond (one liar cannot move the middle of three), their seats are
admin-assigned from deterministic devnet keys, seats default to exactly the
quorum so there is no liveness margin if a reader disappears (add spare
`add_oracle` seats for that), a reader's own pre-quorum correction replaces
rather than appends (once frozen the tally never moves), and `config.oracle`
is vestigial for the same layout reason as `config.verifier`; the final
device screenshots for the write-up are still outstanding; two on-chain
design edges — coverage funding with no solvency check, and admin-gated
settlement — are recorded under _Future work_ below.

---

## Future work

Recorded 2026-10-05 so none of this lives only in someone's head.

### Investor-funded vault model — marked for implementation

All underwriting capital is protocol-owned today: the program treasury PDA
is seeded by plain out-of-band USDC transfers, each policy's vault is topped
up with coverage the same way, and there is deliberately no path for outside
capital — no deposit instruction, no LP shares (the Phase 1 boundary). The
planned replacement, sketched against the current program:

1. a `deposit_treasury`-style instruction with share accounting, so third
   parties can fund capacity and earn premiums;
2. an on-chain coverage-funding step inside `create_policy` instead of the
   manual top-up, so a policy is provably funded the moment it exists;
3. solvency/allocation rules at `settle_policy` (per-policy allocation, not
   "whose vault happened to be topped up") plus a withdrawal queue for
   unencumbered capital.

### No solvency check before payout — known gap, operational today

`settle_policy` pays out of the policy's own vault and never checks that
the coverage top-up happened. Funding is an out-of-band plain transfer
("no instruction needed: anyone can credit the vault"), so a forgotten
top-up makes settlement fail at the CPI with an opaque token-program error
— a fully valid, breach-triggering policy whose payout simply does not
land. Until item 2 above ships on-chain, treat funding as a **pre-demo
checklist line, not memory**: for every demo policy, verify the vault (the
`["insurance_vault", farm, index]` PDA _is_ the token account) covers the
payout:

```bash
spl-token display <vault-pda>   # balance ≥ coverage_usdc, else transfer USDC in first
```

### `settle_policy` is admin-gated — named centralization edge

`SettlePolicy` requires `settler == config.admin`, so one key still decides
whether a season's reading turns into a payout: the verifier quorum decides
what is _true_, the admin decides _when (or whether)_ money moves. It sits
beside the devnet per-role keys and the outstanding Squads handover as the
remaining centralization edges. Phase 1 rationale: money moves under role
control, and the role lives in the `config` PDA — rotating to a multisig is
a `set_roles` transaction, never a redeploy. Judge-facing answer: the
_trigger_ is already decentralized (Phase 2 froze the season median
on-chain); what remains is who presses the button, and opening settlement
to anyone once the reading is finalized — every payable condition is then
objective on-chain state — is the direction marked here.

---

## Getting started

```bash
npm install
npm run android
```

---

## Build process

### Quality gates

Every change lands only with all four gates green, run in this order:

| Gate   | Command                  | What it catches                                                                   |
| ------ | ------------------------ | --------------------------------------------------------------------------------- |
| Types  | `npx tsc --noEmit`       | missing i18n keys (es/fr are typed `Record<MessageKey, string>`), hook/type drift |
| Format | `npx prettier --check .` | the whole tree — app, tests, `api/`, even `deck/` HTML and Markdown               |
| Lint   | `npx expo lint`          | React hooks rules, dead code                                                      |
| Tests  | `npx vitest run`         | behaviour — 58 files, 484 passing + 1 skipped (the opt-in smoke test)             |

`npm run ci` chains the same checks and finishes with an Android prebuild, so
it also catches anything Metro refuses to bundle.

### Test strategy — stub at the layer you are testing

Tests live at the repo root or beside the code, **never under `app/`** (see
_Failures_ below — Metro would bundle them into the release JS). Each suite
stubs the layer its subject actually talks to:

| Layer                  | Suites                                        | Stub                                                                                    |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Hook boundary          | `screens`, `settings`, weather/profile suites | `vi.mock` of `useFarmQuery`, `useMobileWalletSetup`, … driven by scenario objects       |
| JSON-RPC boundary      | `scout-chain.test.tsx`                        | a global `fetch` answering `getAccountInfo` / `getMultipleAccounts` — real codec + PDAs |
| Native module boundary | camera, auth, settings                        | `expo-haptics`, `expo-camera`, location and clipboard stand-ins                         |
| Network (opt-in)       | `test/smoke.test.ts`                          | a real RPC behind `SMOKE_RPC=…` — never runs in the offline gate                        |

Two rules the suite enforces, both learned from failures:

- **Reset scenario state in a file-level `beforeEach`** — vitest runs without
  `clearMocks`, so a scenario left populated poisons every later test in the
  file (this bit the Profile tests after the export suite).
- **Await every `fireEvent` call** — RNTL v14 flushes state per call; an
  un-awaited press races the re-render it is supposed to observe.

### Device dev loop

```bash
npm run api:dev                 # AI proxy + SIWS on :3000
npx expo start --dev-client --port 8081
adb reverse tcp:8081 tcp:8081   # Metro   → device
adb reverse tcp:3000 tcp:3000   # API     → device
adb install -r <debug.apk>      # first run, or after Android wipes app data
```

Background shells do not survive an environment restart, and when they die the
symptoms look exactly like an app failure. After any restart, re-run the lines
above and verify `POST /api/siws/nonce → 200` **before** debugging deeper.

### On-chain change loop

`anchor build` → `npm run idl:sync` → `npm run client:generate` → deploy (devnet,
or `solana program-v4` on a local validator — see _Running Anchor tests_) →
optional live round-trip with `SMOKE_RPC=… npx vitest run test/smoke.test.ts`.

### Rules the codebase enforces

- **No invented data** — screens render chain values or an explicit empty /
  error / guest state. A value the chain does not store becomes an empty CSV
  cell, never a plausible-looking number.
- **i18n** — `lib/translations/en.ts` is the source of truth; `es.ts` and
  `fr.ts` are typed against it, so a new key fails `tsc` until translated.
- **Theming** — every screen builds styles with `makeStyles(colors)`, which
  makes light mode a palette swap instead of a second stylesheet.
- **Secrets stay server-side** — provider keys live only in the `api/`
  proxies; the app knows a single `EXPO_PUBLIC_AI_CLASSIFY_URL`.
- **The app lock is not a wallet** — the passcode protects the app in
  `expo-secure-store`; signing always goes through Mobile Wallet Adapter.

---

## Failures & fixes

A running postmortem: what broke, why, and the guard that now prevents it.

### Release-blocking

| Failure                                                  | Root cause                                                                                                                                               | Fix / guard                                                                                                                                                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App died at startup with an opaque Metro transform error | A `*.test.*` file under `app/` entered Metro's module graph (its default `blockList` excludes nothing), bundling `describe`/`expect` into the release JS | Test moved to the repo root (`entry.test.tsx`); `test/bundle-guard.test.ts` now fails the suite if any test file appears under `app/` again                                                         |
| "App not loading" on the device (2026-10-04)             | Two independent faults at once: the `adb reverse` mappings for 8081/3000 were gone **and** the APK was not installed (Android had wiped local app data)  | Restored both `adb reverse` lines, `adb install -r` the debug APK, verified the bundle answered HTTP 200 (~15 MB). The recovery checklist now lives in _Build process → Device dev loop_            |
| Gemini proxy hung or failed silently in production       | Node's global `fetch` is HTTP/1.1-only, and the POC's mobile uplink blackholes H1 POSTs to Google's edge while H2 gets through                           | `h2Fetch` (`api/_lib/gemini.ts`) — a `node:http2` fetch-shaped client with a hard deadline that surfaces a mapped `timeout` instead of a hung proxy. **Never regress it**; tests inject `fetchImpl` |
| Plain `anchor test` could not run                        | Anchor 0.32 drives Surfpool, which does not start in this environment; separately, Agave ≥ 2.2 rejects _new_ loader-v3 deploys on a local validator      | Run against `solana-test-validator` and deploy with `solana program-v4` — documented in _Running Anchor tests_                                                                                      |
| Devnet reads failed intermittently                       | Helius free-tier rate limiting                                                                                                                           | Fall back to the public `https://api.devnet.solana.com` endpoint                                                                                                                                    |

### Mock data shipped to the UI (purged)

| Failure                                                           | Root cause                                                                                                                                                | Fix                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The scout screen still showed placeholder rows after the redesign | `SCOUT_EVENTS` was wired as the _fallback_ for log and fields, the success banner claimed "All fields clear" with zero data, a seeded row stayed expanded | Log/fields fall back to `[]`, the banner only renders when `fields.length > 0`, the expanded row defaults to nothing — seeds kept as test/CSV fixtures                                                   |
| Notifications arrived pre-populated                               | A `NOTIFICATIONS` constant seeded the provider                                                                                                            | The provider starts `useState([])` and the constant is deleted; real items (AI diagnosis, escrow) arrive only through `add()`                                                                            |
| Settings → CSV export showed fake records                         | The export screen read static data instead of the chain                                                                                                   | `lib/csv.ts` rebuilt around a pure `FarmRecordInput`; the screen wired to the live chain queries with banner states for chain error / loading / no wallet / no farm, and `canExport` gating both actions |

### Test-suite incidents

| Failure                                                                         | Root cause                                                                                                                                                                                                              | Fix / rule                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 export tests: "Connect a wallet to export" shown despite a populated scenario | The file-level `useMobileWalletSetup` mock hardcoded `address: null`, bypassing the kit-level scenario the suite drove                                                                                                  | The mock reads the shared `exportScenario.address`; `beforeEach` resets it so later suites still see a guest                                                        |
| Later tests poisoned by earlier ones                                            | No `clearMocks` in the vitest config — scenario objects leaked across tests (ProfileScreen mounted the export suite's mocks)                                                                                            | File-level `beforeEach` reset of every scenario + `vi.clearAllMocks()`                                                                                              |
| Fold-dock test: the modal never mounted after unfolding                         | Un-awaited `fireEvent.press` — RNTL v14 flushes per call, so the next press landed while the stack was still `pointerEvents: 'none'`                                                                                    | Await **every** `fireEvent` call                                                                                                                                    |
| Profile screen crashed after a camera-test mock changed                         | `vi.mock('@/features/scout/location')` returned only `getCurrentCoords`, but `useSetupSignals` also calls `getLocationPermission`                                                                                       | Mock a module's full export surface (or spread `importOriginal`) — a partial mock breaks every other consumer                                                       |
| CSV export button enabled for a wallet with nothing to export                   | The scenario set `rowCount > 0` while `address` was null                                                                                                                                                                | Scenario rule: `address` must be set whenever `farm` is set                                                                                                         |
| Phase 1 negative tests failed with "insufficient lamports" instead of the gate  | Anchor executes an instruction's `init` rent transfer **before** its account constraints, so a zero-lamport stranger paying for an `init`/`init_if_needed` died on the transfer instead of reaching `UnauthorisedAdmin` | `fund()` the transient signer first (rule documented at the helper); load failures also precede constraints, so account existence errors surface before gate errors |
| Phase 2 finalize assertion: "expected 1791161395 to be a number or a date"      | `reading_timestamp` is an i64, so the Anchor client hands back a BN — chai's `isAbove` only accepts number/Date comparands                                                                                              | Cast with `Number(...)` before numeric comparisons (BN stringifies to its decimal value)                                                                            |

### Program build incidents

| Failure                                                                                                                                                                                                           | Root cause                                                                                                                                                                                                                                                                                                             | Fix / rule                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchor build`: `expected ':'` at `realloc payer = member`                                                                                                                                                        | Anchor 0.32's constraint parser takes the **path** form for realloc's sub-keys; the bare `realloc payer = …` spelling in older examples predates it                                                                                                                                                                    | Write `realloc::payer = <signer>` and `realloc::zero = false`                                                                                                                                                                                                                                                                |
| `anchor build`: `cannot find value 'target' in this scope` (in a constraint)                                                                                                                                      | Instruction args are **not** in scope inside `#[account]` constraints — `ManageOracle`'s `member` is an account field, not the `remove_oracle` argument                                                                                                                                                                | Validate arg-derived conditions in the handler with `require!` before any state moves — the refund-owner pin in `release_verifier` does exactly that                                                                                                                                                                         |
| Every relay: `AnchorError caused by account: slot_hashes … AccountSysvarMismatch (3015)` — "The given public key does not match the required sysvar" — while the transaction provably carried `SysvarS1otHashes…` | `Sysvar<'info, SlotHashes>` can never work: solana-sysvar 2.3+ **deliberately refuses** in-program deserialization of `SlotHashes` (`from_account_info` → `UnsupportedSysvar` — 20 KB is "too large to bincode::deserialize"), and anchor maps any such failure to `AccountSysvarMismatch` with a key-mismatch message | Pin the address instead: `#[account(address = SLOT_HASHES_SYSVAR)]` on an `UncheckedAccount`, read the raw bytes with bounded count/length checks first — the pattern the instructions sysvar already used. A wrong error message sent the investigation through the tx's account metas before the crate source explained it |

### Environment & process

- **Parallel sessions share one working tree.** Repo-wide gates fail on
  artifacts from another workstream (scratch `*.test.tsx` at the root,
  unformatted `deck/` files). Run all four gates right before any handoff, and
  never leave scratch files at the repo root.
- **A gitignored worktree is not excluded by default.** A parallel session's
  `.kilo/worktrees/…` copy put its stale tests in the run, and with `@/*`
  resolving to _this_ tree they failed against the wrong source (7 files, 30
  tests). `vitest.config.mts` now excludes `.kilo/**` explicitly — vitest
  does not read `.gitignore`, unlike prettier and eslint.
- **Environment restarts kill background shells.** Metro, the API server and
  `adb reverse` vanish together — see _Device dev loop_ for the recovery order.

---

## On-chain program

The Anchor program lives in `programs/indorse_program/` and exposes 27
instructions. Layer 0 is the config: the `Config` PDA (seeds `["config"]`)
holds the admin/verifier/oracle roles every ops gate reads, so authority is
swappable account data — the `ADMIN` const survives only as the one key
allowed to call `init_config`. Custody is program-owned too: insurance refunds
sweep into the `["treasury"]` PDA's USDC ATA, never a wallet's.

Verification (Phase 1) replaces the old single `config.verifier` key with a
bonded K-of-N verifier set: `init_verifier_set` fixes the quorum `k` (2–7) and
the USDC bond price, members seat themselves with `post_bond` (recording
exactly what they paid), and `cast_vote` finalizes a report the moment one
side reaches `k` — approve or reject, one vote per member. Bonds leave only
three ways: back to the member via `remove_verifier` (refused while the set
stands at `k` members) or a governed `release_verifier`, or to the treasury
via a governed `slash_verifier`.

Season readings (Phase 2) replace the old single `config.oracle` key with an
admin-managed oracle set: `init_oracle_set` fixes an **odd** quorum `k` (3–7 —
an even count has no unambiguous middle value, and `k=1` would recreate the
single-reader regime), `config.admin` seats unbound readers with `add_oracle`,
and each reader posts its own rainfall to the per-season `["weather", farm,
season]` tally — replacing its own entry while the tally is open, never
double-counting. The `k`-th reading sorts the tally, freezes the **median**
into `total_rainfall_mm`, stamps the time and closes the account: late
submissions bounce off `finalized`, and `settle_policy` refuses to pay out of
a partial tally. Readers carry no bond — a liar cannot move the middle of
three — and removed readers' readings persist.

Governed reconfiguration (Phase 3A) takes the frozen rules off the verifier
set: `reconfigure_verifier_set` rewrites `k` and the seat price under the same
bounds init ran under (`config.admin`, evented), and repricing affects future
joins only because each seat's entry records the exact stake it paid — exits
refund it, slashes take it, never the current price. A voluntary exit refuses
to drop the set below `k` (the `DropBelowQuorum` floor); governance bypasses
that floor on purpose: `release_verifier` frees a seat with its stake
returning to that member's own USDC account (the fair-exit valve), and
`slash_verifier` still forfeits to the treasury. `cast_vote`
freezes-on-contact — when a side already stands at `k` after a lowering, the
next vote finalizes the report without recording a ballot (the ops rule
remains: finish open tallies before lowering `k`, because a split tally where
every member already voted cannot progress). Sets allocated under the old
bare-pubkey layout are normalized by a realloc on the first `post_bond` —
the realloc path has been exercised live on devnet, against an account
allocated by the old program (see the lifecycle rehearsal below). The
oracle-set equivalents (reconfigure, floor) are deferred until the Switchboard
integration question settles.

Switchboard receipts (Phase 3B) give an external oracle network a voice in
that same tally without ever handing it a key. `register_switchboard_feed`
(`config.admin` only, and the feed must already hold an oracle-set seat via
`add_oracle`, so a receipt enters as an assigned reader — not a spare voice)
pins a `SwitchboardFeedBinding` PDA: farm, season, feed, the 32-byte job
hash, and at least three distinct enclave signers; re-running it is the
rotation path, and it revokes the old keys the moment it lands.
`submit_switchboard_reading` is then **permissionless**: the authority is the
receipt itself. The transaction carries Solana's ed25519 precompile proof,
which the runtime verifies before our code runs; the instruction re-reads the
proven signer/message pairs through the address-pinned instructions sysvar,
requires the bound job hash, `max(3, min_samples)` distinct pinned enclave
keys, a slothash still inside the 512-slot `SlotHashes` window, and an i128
value that divides exactly into whole 0.1 mm units (the job signs at 1e18;
divide by 1e17) — then writes it into the per-season tally under the feed's
seat through the same helper `submit_oracle_reading` uses. Median, freeze and
`settle_policy` are untouched; the relayer's only cost is rent for a tally
the season has not created yet.

| Instruction                  | Description                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_config`                | One-shot bootstrap: the hard-coded `ADMIN` creates the config PDA and sets the initial admin/verifier/oracle roles (all three default to that same key)                                                                                                                                                                                      |
| `set_roles`                  | Rotate all three roles in one atomic transaction, signed by the current `config.admin` — how authority moves to a multisig vault without a program upgrade                                                                                                                                                                                   |
| `register_farm`              | Create a farm PDA seeded by `[b"farm", owner]`                                                                                                                                                                                                                                                                                               |
| `delete_farm`                | Close the farm PDA and refund its rent (owner only) — child accounts (reports, batches, policies) stay on chain as an independent trail                                                                                                                                                                                                      |
| `submit_scout_report`        | Submit a field photo report for a farm                                                                                                                                                                                                                                                                                                       |
| `init_verifier_set`          | One-shot rules for verification: quorum `k` (2–7) and the USDC bond each member posts (`config.admin` only)                                                                                                                                                                                                                                  |
| `reconfigure_verifier_set`   | Rewrite the verifier set's `k` and seat price (`config.admin`, same bounds as init) — repricing applies to future joins only; existing seats keep their recorded stakes                                                                                                                                                                      |
| `post_bond`                  | Join the set: the member's own USDC account pays the bond into the program-owned bond vault (the set PDA's canonical ATA) and the seat records exactly what was paid (a pre-Phase-3A set reallocs to the current layout on this first join)                                                                                                  |
| `remove_verifier`            | Voluntary exit: the member leaves and their recorded stake returns to their account — refused while the set stands at `k` members or below (the quorum floor); votes already cast keep counting                                                                                                                                              |
| `release_verifier`           | Governed fair exit (`config.admin`): the seat is removed and its stake returns to that member's own USDC account — the unconditional valve that keeps the quorum floor from becoming a trap                                                                                                                                                  |
| `slash_verifier`             | Governed slash (`config.admin`): the member is removed and their recorded stake moves to the treasury — deliberately no automatic slashing rules; may leave the set below `k` (governance's other unconditional lever)                                                                                                                       |
| `cast_vote`                  | One quorum vote per bonded member on a pending report; the first side to reach `k` finalizes it (an approval bumps the farm's verified count), and the pending gate closes the tally against late votes                                                                                                                                      |
| `init_oracle_set`            | One-shot rules for season readings: an **odd** quorum `k` (3–7) that defines the median (`config.admin` only — no bond, by design)                                                                                                                                                                                                           |
| `add_oracle`                 | Seat a reader (`config.admin` assigns the seat — unlike verifiers, readers carry no bond, so the assignment cannot be bought or forged)                                                                                                                                                                                                      |
| `remove_oracle`              | Revoke a reader's seat (`config.admin`); readings they already posted stay in the tally — a removed reader cannot un-notice a season                                                                                                                                                                                                         |
| `reward_report`              | Pay SKR tokens to the reporter — permissionless since Phase 1: the Verified status is the whole gate, the destination is pinned to `report.reporter`, and `REPORT_REWARD` is protocol-fixed                                                                                                                                                  |
| `submit_harvest_batch`       | Record a harvest batch with provenance snapshot                                                                                                                                                                                                                                                                                              |
| `create_escrow`              | Buyer deposits USDC into escrow for a batch                                                                                                                                                                                                                                                                                                  |
| `release_escrow`             | Farmer claims the escrowed funds                                                                                                                                                                                                                                                                                                             |
| `cancel_escrow`              | Buyer cancels before lock — escrow + vault are closed, USDC and rent refunded, batch slot freed for retry                                                                                                                                                                                                                                    |
| `create_policy`              | Create a parametric weather-insurance policy (single farmer signature; the treasury tops up coverage with a plain token transfer)                                                                                                                                                                                                            |
| `submit_oracle_reading`      | Post (or, pre-quorum, replace your own) season rainfall in the per-season tally; the `k`-th reading freezes the median and stamps `finalized` — readers only, one entry each                                                                                                                                                                 |
| `register_switchboard_feed`  | Pin — or re-pin — the Switchboard job's trust root for one farm/season: feed, 32-byte job hash and ≥3 distinct enclave signers (`config.admin` only, feed must already hold an oracle-set seat; re-running is the queue's key-rotation path)                                                                                                 |
| `submit_switchboard_reading` | Relay a Switchboard On-Demand receipt **permissionlessly**: re-read the ed25519 precompile's verified signer/message pairs through the address-pinned instructions sysvar, require the bound job hash, the pinned-enclave quorum, 512-slot freshness and an exact whole-0.1 mm value, then record it under the feed's seat in the same tally |
| `settle_policy`              | Pay out or expire a policy after the season ends (`config.admin`) — no-trigger refunds are swept to the program treasury's USDC ATA (address-derived, mint-checked)                                                                                                                                                                          |
| `revoke_policy`              | Farmer revokes an active policy before the season ends: the premium returns from the policy vault, the treasury's top-up sweeps into the program treasury's USDC ATA, both accounts close (rents to the farmer) — refused once the season is over, when `settle_policy` takes over                                                           |
| `withdraw_treasury`          | Move accumulated refunds out of the program treasury to the admin's own USDC account — the treasury PDA signs the transfer, `config.admin` gates it, and the destination must be the admin's account                                                                                                                                         |

**Program ID:** `GVenujqgMJZCvYPKqMmPiAXQp7o3mwQbXw1nSBu3U5Ht`

The IDL and TypeScript types are generated at:

- `programs/indorse_program/target/idl/indorse_program.json`
- `programs/indorse_program/target/types/indorse_program.ts`

The app consumes a copy at `lib/idl/indorse_program.json`; refresh it after any
program change with:

```bash
npm run idl:sync
```

A program change is a **coordinated cut-over**: the client and the program
must move together (account lists differ per version — e.g. `revoke_policy`
now takes the treasury PDA and no `config`, which an older program would
reject). Order of operations:

```bash
cd programs/indorse_program
anchor build                                 # compile + regenerate IDL/types
cd ../.. && npm run idl:sync && npm run client:generate
cd programs/indorse_program
solana program deploy --program-id target/deploy/indorse_program-keypair.json \
  target/deploy/indorse_program.so --url devnet    # in-place upgrade
node scripts/init-config.cjs                      # idempotent: config + treasury ATA + verifier set + bond vault + oracle set
```

`scripts/init-config.cjs` defaults to devnet, is safe to re-run (an existing
config prints its roles; the treasury and bond-vault USDC ATAs are
`getOrCreate`), takes `RPC_URL=http://127.0.0.1:8899` for a local validator,
and takes `USDC_MINT=…` where the mint isn't the app's devnet USDC. The
verifier-set step signs with whoever holds `config.admin` _now_ (derived key
after the role rotation, bootstrap before it) and takes `K` and `BOND_AMOUNT`
(atomic units) for the rules; membership itself is never scripted — each
verifier seats itself with `post_bond` from its own wallet. The oracle-set
step (Phase 2) takes `ORACLE_K` (odd, default 3) and — because readers carry
no bond — also seats the deterministic `oracle-1…n` keys from `role-keys.cjs`
and tops them up for fees and the tally's first rent, both idempotently.

### Devnet role keys

Roles on devnet are split across three independent keys, derived
deterministically so they never need a backup:

```bash
cd programs/indorse_program
node scripts/role-keys.cjs           # print admin/verifier/oracle keys + oracle-set seats
node scripts/role-keys.cjs rotate    # set_roles to them (idempotent)
```

The formula is `sha256("indorse-devnet-role-v1:<role>") → Keypair.fromSeed` —
public by design, which means anyone can derive it and sign as these roles:
the devnet roles structure the flow (a separate key per gate, the rotation
path rehearsed end to end with both signers proven), they do not secure it.
`ROLE_SEED` overrides the seed, `ADMIN/VERIFIER/ORACLE` override individual
rotation targets (rotate back to the bootstrap key with all three), and
`RPC_URL` picks the cluster. The same derived admin key also signs Phase 1,
Phase 2 and Phase 3A state (reconfigurations are run ad hoc, never scripted):
`scripts/init-config.cjs` creates the devnet verifier set
(`H4HnKfqu…XK`, k=2, 5 USDC bond) and the devnet oracle set
(`12FrAm…zTf`, odd k=3, seats `oracle-1…3`) with it. A Squads vault holding
real keys is still the actual Phase 0 handover.

### Devnet lifecycle rehearsal

`scripts/devnet-lifecycle.cjs` is the end-to-end proof that the bonded
quorum works outside localnet. Localnet starts on a fresh program every run,
so the one transition it can never reproduce is the **first join on an old
account**: a verifier set allocated by the pre-Phase-3A program (bare-pubkey
layout, 246 bytes) must realloc to the current member-with-stake layout
(302) while an empty `Vec` decodes identically under both. On 2026-10-05
the full arc ran against the deployed devnet state, all assertions green:

| Step | Live devnet result                                                              |
| ---- | ------------------------------------------------------------------------------- |
| 1    | seat-a joins → **realloc 246 → 302 bytes fired**, stake recorded 5 USDC         |
| 2    | seat-b joins → set stands at `k`                                                |
| 3    | seat-a self-exit → **refused** (`DropBelowQuorum`)                              |
| 4    | farm + report-1; a and b approve → **Verified at quorum**, farm count 1         |
| 5    | governed reconfigure → **k 2→3, bond 5→7**                                      |
| 6    | seat-c joins at 7 → **recorded stakes [a@5, b@5, c@7]** — reprice untouched a/b |
| 7    | seat-c self-exit at 3 members/k=3 → **refused**                                 |
| 8    | report-2; a, b approve → open tally **2/3** under k=3                           |
| 9    | governed reconfigure → **k 3→2 beneath the open tally**                         |
| 10   | seat-c approves → **freeze finalises report-2 without recording c's ballot**    |
| 11   | seat-c exits above the floor → **refunded its recorded 7 USDC**                 |
| 12   | release b → **refunded 5, set drops to 1 member** (the valve)                   |
| 13   | b rejoins → **at the current price of 7**                                       |

End state: k=2, members `a@5 + b@7`, bond vault 12 USDC, both reports
Verified (report-2 via freeze), `farm.verified_report_count = 2`, account
layout 302 bytes. Every step is guarded by on-chain state, so re-running
the script after an RPC failure resumes instead of double-spending (the
public endpoint's 429s hit twice mid-run; the script absorbed both).
Not covered: `reward_report` — devnet has no reward vault (the
`reward_authority` PDA holds no token accounts) and inventing a reward
mint just to tick the box would be theatre. The preflight-only variant is
`scripts/devnet-state.cjs` (read-only: layout, rules, membership, balances).

### Switchboard job-spec proof (Phase 3B — standalone, off-chain)

The mandated order was: prove the job spec **before** any program wiring —
one on-demand job, one fixed farm/season on devnet, pull an update, verify a
correct cumulative-rainfall receipt entirely off-chain, no Anchor instruction.
Verdict: **tractable — 9/9 checks yes** (probe workspace
`/tmp/opencode/sb-jobspec`, full log in `LOG.md` there; the workspace is
scratch, so what the repo keeps is the outcome and the re-runnable relay
script below).

- **Job** — Open-Meteo daily `precipitation_sum` over the fixed season
  2024-04-01…2024-09-30 (183 terms), **mean × 183**: the deployed oracle
  build rejects `aggregationMethod` SUM/MEAN, so the total is computed as
  mean × count (deterministic for a closed archive window).
- **Feed hash** — `0x1e70a1ea0099fc2c5146d332ecd10824ba421cc2480ba74828640e94f3f84623`,
  computed locally with `FeedHash.computeOracleFeedId` (public crossbar has
  no DNS record, so no hosted lookup was possible). Canonical quote account:
  `7bdFFmzdwnfzntEzYbo5nQRiq7dgHcv8FjkpLhRrqJUQ` (derivable by anyone).
- **Receipt** — 3/3 enclave signatures verified with tweetnacl over the exact
  81-byte message (`slothash(32) ‖ feed_hash(32) ‖ i128 LE value(16) ‖
min_samples(1)`), each signer matched to its oracle's on-chain enclave
  record; value `22_200_000_000_000_000_000` = **22.2 mm** at the job's 1e18
  scale. The SDK exposes no `verify*()` API — verification was manual over
  the reconstructed message.
- **Cost** — one update round trip + on-chain quote write: **6,076,816
  lamports** (probe tx `DoCPiJbA…oQ17`).

Caveats carried forward: gateways must be discovered from on-chain oracle
records and probed for health (crossbar is DNS-dead); gateway rounds do not
always reach 3 responding signers (retry until they do); the SDK's 65535
"current instruction" sentinel is rejected by the deployed quote program
(`instructionIdx: 0` + a hand-built v0 transaction is the workaround — our
instruction accepts either sentinel, and the localnet suite pins the 65535
form); and quote-SDK transactions need explicit CU/priority-fee ixs, which
the relay does not (its instruction fits the default budget).

### Switchboard relay on devnet (Phase 3B — on-chain)

With the job spec proven and both instructions landed (25 → 27),
`programs/indorse_program/scripts/switchboard-reading.cjs` closes the loop
against live devnet. State-guarded and re-runnable like the lifecycle script:

1. seat the canonical quote account on the devnet oracle set (admin) — skip
   if already seated;
2. pull one fresh receipt from a live gateway (crossbar bypassed), decode its
   ed25519 precompile instruction and verify **every** signature, the feed
   hash, and each signer against its oracle's **on-chain** enclave record
   (retrying until ≥3 distinct signers — the quorum the protocol demands);
3. register the binding with those signers (admin, idempotent);
4. relay `[ed25519 ix, submit_switchboard_reading]` — the bootstrap wallet
   signs only as relayer/fee-payer;
5. read the tally back and assert the value.

Result on 2026-10-05: receipt at slot 507672122, 3 distinct signers verified,
signed value `22_200_000_000_000_000_000` → **22.2 mm landed under the feed's
seat** in season 1711920000's tally (relay tx `5cfMd1pv…RUS8`,
`finalized = false` — one of three seats). Localnet covers the other side:
9 integration cases (registration gates, missing proof, impostor signers,
foreign job hash, stale slothash, fractional value, the permissionless happy
path, the median freeze with a late-receipt refusal, and key rotation) — 43
in total. The script needs the probe workspace's Switchboard SDK
(`SWB_DEPS=/tmp/opencode/sb-jobspec/node_modules`, the default).

### Generated client

`lib/generated/indorse` is a [Codama](https://github.com/codama-idl/codama)-rendered
`@solana/kit` client for that same IDL: one builder per instruction, PDA finders,
typed account codecs, event decoders and error codes. It is committed source, so
neither the app build nor Metro needs the Codama toolchain — only regeneration
does:

```bash
npm run client:generate
```

The renderer is pinned to `@codama/renderers-js@2.4.0`, the last release that
emits imports for the **kit v7** codecs this app is on (`@solana/codecs-strings@^7`);
newer versions target kit v8. `lib/program/generated-client.test.ts` asserts the
generated client and the hand-rolled `lib/program/*` client agree on the program
address, every instruction discriminator, the argument encoding and the PDA
seeds, so drift between them fails the suite.

---

## Project structure

```
indorse/
├── app/
│   ├── _layout.tsx          # Root layout — theme, language, settings, AuthProvider + AuthGate, wallet, farm registry, scout log
│   ├── index.tsx            # Entry redirect → /onboarding
│   ├── onboarding.tsx       # 3-slide intro + wallet connect CTA
│   ├── setup.tsx            # First-run setup wizard
│   ├── settings/
│   │   ├── notifications.tsx # Push / badge / category / quiet-hour switches
│   │   ├── security.tsx     # Wallet session, signature confirmations, app passcode, hide balances, auto-lock
│   │   ├── account.tsx      # Account & local data — what "delete" erases (device stores, wallet session)
│   │   ├── network.tsx      # Cluster picker + live getSlot health check
│   │   ├── export.tsx       # CSV farm record preview (live chain reads) → share or copy
│   │   ├── language.tsx     # English / Español / Français
│   │   └── theme.tsx        # System / Dark Field / Light Paper
│   └── (tabs)/
│       ├── _layout.tsx      # App header + custom Scout/Provenance/Weather/Profile tab bar
│       ├── index.tsx        # Scouting — onboarding card (no farm) or tiles, field status, log, banner, camera
│       ├── farms.tsx        # Provenance — score, evidence banner, escrow, addresses
│       ├── reports.tsx      # Weather — policy, oracle (error + retry), season chart
│       └── rewards.tsx      # Profile — wallet state, farm details, activity, settings destinations
│
├── components/
│   ├── app-providers.tsx    # QueryClient + theme + language + settings + MobileWalletProvider
│   ├── app-header.tsx       # Brand header: PDA, notification bell, avatar, farm pill
│   ├── app-splash.tsx       # Splash while the registry/providers hydrate
│   ├── auth-gate.tsx        # Full-screen lock modal: create passcode / unlock (+ biometrics)
│   ├── auth-provider.tsx    # App lock state: salted verifier in SecureStore, attempts, auto-lock
│   ├── camera-overlay.tsx   # Full-screen scouting camera overlay — captures stay local without a farm
│   ├── confirm-modal.tsx    # Shared destructive-action confirm sheet
│   ├── farm-registry-provider.tsx # On-chain + local-only farms, current-farm selection
│   ├── farm-switcher-sheet.tsx    # Switch between registered farms
│   ├── log-harvest-modal.tsx / setup-escrow-modal.tsx / underwrite-policy-modal.tsx / verify-email-modal.tsx
│   ├── notifications.tsx    # Notification context + bottom sheet (starts empty; push/category aware)
│   ├── profile-provider.tsx # On-device operator profile (name, bio, photo)
│   ├── register-farm-modal.tsx     # name + GPS (chain or local-only when disconnected)
│   ├── scout-onboarding.tsx # "Set up in 3 steps" entry card + scan-now info box (no-farm state)
│   ├── scout-log-provider.tsx # Device's scouting log (`indorse.scout.v1`) — captures persist, anchor later
│   ├── IndorseMark.tsx / person-icon.tsx # Brand mark + line-drawn avatar
│   ├── brand.tsx             # legacy logo component — unreferenced (IndorseMark replaced it)
│   ├── screen-kit.tsx       # Banner / EmptyState / ErrorState / Skeleton / Chip / RiskBar
│   ├── seed-vault-badge.tsx # Seeker seed-vault badge
│   ├── settings-provider.tsx # Persisted prefs: notifications, security, network
│   ├── settings-ui.tsx      # SettingsScreen / Group / Row / ToggleRow / OptionRow + sheet / button
│   ├── theme-provider.tsx   # Light / Dark / System mode, persisted, drives every makeStyles
│   └── ui.tsx               # Shared Card / FieldGrid / Badge primitives
│
├── lib/
│   ├── csv.ts               # Farm record → flat CSV (union header, record_type column, honest empty cells)
│   ├── format.ts            # toE6/fromE6, timestamps, USDC, shortenAddress
│   ├── i18n.tsx             # Language context + t() with {placeholder} interpolation
│   ├── translations/        # en / es / fr dictionaries, typed to MessageKey
│   ├── program/             # codec, PDA derivations, instruction builders, RPC helpers, SAS
│   ├── idl/                 # App-facing copy of the program IDL (refresh with npm run idl:sync)
│   ├── validation.ts        # Shared per-field validation helpers
│   ├── use-mock-fetch.ts    # legacy mock-state helper — unreferenced (mock era leftover)
│   └── wallet-name.ts / display-name.ts / greeting.ts / seeker.ts / skr.ts
│
├── constants/
│   ├── app-config.ts        # Cluster URLs, default cluster, rpcUrl()/buildCluster(), identity
│   ├── data.ts              # Design-era seed/fixture data — asserted unrendered by the screens
│   └── theme.ts             # Design tokens (dark + light palettes, Colors, sevFor, spacing, radii)
│
├── features/
│   ├── wallet/              # useMobileWalletSetup, useWalletMutation, device verification (SIWS/SGT)
│   ├── farm/                # Farm account, register/delete mutations, validation
│   ├── reports/             # ScoutReport, submit/verify mutations, chain → UI event mapping
│   ├── scout/               # Field derivation from reports, location helpers
│   ├── harvest/             # HarvestBatch, submit_harvest_batch mutation
│   ├── escrow/              # Escrow, create/release/cancel mutations, EscrowCard
│   ├── insurance/           # Policy + weather trigger types, oracle reads, mutations
│   ├── ai/                  # Photo classification client + verdict schema shared with api/
│   ├── email/               # Verification-email client for the api/ proxy
│   └── profile/             # Setup signals + profile types
│
├── api/                     # Vercel-style functions: AI classify (OpenAI/Gemini), SIWS, email, SAS
├── programs/
│   └── indorse_program/     # Anchor workspace (Rust program + integration tests + init-config/role-keys scripts)
│
├── *.test.tsx / **/*.test.ts  # 57 suites — see Build process → Test strategy
├── test/setup-mocks.ts       # Shared test mocks (icon set, expo-crypto digest)
├── test/bundle-guard.test.ts # Fails if any test file lands under app/ (Metro would bundle it)
├── test/smoke.test.ts        # Opt-in live-RPC round trip (SMOKE_RPC)
├── vitest.config.mts         # Vitest config (verbose reporter, vitest-native)
└── package.json
```

---

## Using the wallet

`useMobileWallet()` from `@wallet-ui/react-native-kit` is available anywhere
below `AppProviders`. For most UI work, use the higher-level
`useMobileWalletSetup` hook from `features/wallet`:

```tsx
import { useMobileWalletSetup } from '@/features/wallet'

const { walletState, address, toggleConnection, error } = useMobileWalletSetup()
```

Or drop in the ready-made button:

```tsx
import { WalletConnectButton } from '@/features/wallet'

;<WalletConnectButton onConnected={(address) => console.log(address)} />
```

For transaction mutations, use the shared `useWalletMutation` factory — it
handles validation, the connected-wallet check and error wrapping:

```tsx
import { useWalletMutation } from '@/features/wallet'

useWalletMutation<Input, Result>({
  actionLabel: 'register farm',
  validate: validateRegisterFarm, // optional
  action: async (input, address) => {
    // build + send the transaction
  },
})
```

For raw wallet access (RPC calls, signing):

```tsx
import { useMobileWallet } from '@wallet-ui/react-native-kit'

const { account, client, connect, disconnect, sendTransactions, signMessages } = useMobileWallet()
// account is null until connected; client.rpc is a @solana/kit RPC client
```

---

## Settings

The Profile tab's **Settings** card opens seven routes under `app/settings/`:

| Screen             | What it does                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Notifications      | Push master switch, unread badge, per-category toggles (diagnosis / escrow / weather / system), quiet hours                        |
| Wallet & Security  | Session status, disconnect, app passcode (change / forgot), confirm-signatures / biometrics, **hide balances**, auto-lock          |
| Account            | Account & local data — spells out exactly what "delete" erases (on-device stores + wallet session; on-chain records are untouched) |
| Network            | mainnet / devnet / testnet / localnet / custom RPC with a real `getSlot` health check (latency + slot)                             |
| Export Farm Record | Live chain record → flat CSV preview with row counts → share via `expo-sharing` or copy to clipboard                               |
| Language           | English / Español / Français                                                                                                       |
| Theme              | System / Dark Field / Light Paper                                                                                                  |

Everything the screens edit lives in `components/settings-provider.tsx` as one
AsyncStorage document, so other parts of the app react to it: the notification
sheet only lists categories that are enabled, the profile masks balances when
`hideBalances` is on, and switching cluster remounts `MobileWalletProvider`
(the screen warns that the wallet session drops).

**Theme** — `ThemeProvider` persists the mode and exposes `colors`; screens
build styles with `makeStyles(colors)` so light mode is a palette swap, not a
second stylesheet. System mode follows `useColorScheme()`.

**Language** — `LanguageProvider` persists the locale; `t('key')` looks the
string up in `lib/translations/{en,es,fr}.ts`. The dictionaries are typed as
`Record<MessageKey, string>`, so a key added to English but missing from
Spanish or French fails `tsc`. Seed data (crop names, diagnoses, addresses)
stays in English on purpose.

**App lock** — `AuthProvider` gates the app like a wallet does: first launch
asks for a passcode (stored as a salted SHA-256 verifier in
`expo-secure-store`, never the wallet key), every return asks for it again —
or for Face ID / fingerprint when the device supports it and **biometrics** is
switched on — and five wrong tries pause the form for 30 seconds. The
`auto-lock` preference decides when backgrounding re-locks. Signing still goes
through Mobile Wallet Adapter, so the passcode protects the _app_, not the
keys.

**CSV export** — `lib/csv.ts` emits one union header with a `record_type`
column (farm, field, scout_event, escrow, weather_policy), RFC 4180 quoting,
`farmRecordRowCount()` for the row count and a slugified `farmRecordFileName()`.

---

## Scripts

```bash
# Dev loop
npm run dev             # Metro (clear cache, dev client)
npm run android         # Build and run on a device or emulator
npm run api:dev         # AI proxy + SIWS routes on localhost:3000

# Quality gates (all four must be green before any handoff)
npm run test            # Vitest, verbose pass/fail output
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Run tests with V8 coverage report
npm run lint:check      # expo lint (npm run lint to autofix)
npm run format:check    # prettier --check . (npm run format to write)
npm run ci              # tsc + lint + format + test + Android prebuild

# On-chain
npm run idl:sync        # Copy the freshly built IDL into lib/idl/
npm run sas:bootstrap   # Solana Attestation Service bootstrap

# Misc
npm run doctor          # expo-doctor
npm run icons           # Regenerate the app icons
```

---

## Running Anchor tests

The integration tests (43 cases: config authority rotation, the K-of-N
verifier set — quorum approve/reject, double-vote refusal, governed
reconfiguration with its bounds, the `k`-member exit floor, reprice-then-join
stake accounting, the admin release valve, the governed slash, and
freeze-on-contact when `k` is lowered mid-tally — the oracle-set median —
admin-only odd quorum, seat assignment/refusal, partial-tally settle refusal,
own replacement and the final freeze — the Switchboard receipt relay —
binding registration gates, missing proof, impostor signers, foreign job
hash, stale slothash, fractional value, the permissionless happy path, the
median freeze and key rotation — program-treasury revoke/withdraw,
scouting, rewards, treasury-pool insurance, escrow cancel/retry) need a local
validator and the Anchor CLI. Plain `anchor test`
tries to drive Surfpool in Anchor 0.32; in environments where Surfpool does
not start, run against `solana-test-validator` directly. Note that
Agave ≥ 2.2 rejects _new_ loader-v3 programs on a local validator, so the
program is deployed with `program-v4`:

```bash
cd programs/indorse_program
anchor build                                   # compile + regenerate IDL/types
solana-test-validator --reset &                # localnet
solana program-v4 deploy target/deploy/indorse_program.so \
  --program-keypair target/deploy/indorse_program-keypair.json
anchor test --skip-local-validator \
  --provider.cluster http://127.0.0.1:8899 --skip-build --skip-deploy
```

---

## Smoke test (live RPC)

`test/smoke.test.ts` exercises the app's own client end-to-end —
`buildInstruction` → kit signing → send → confirm → `fetchAccount`
round-trip — by registering a farm and submitting one scout report, then
asserting the decoded accounts match. It is skipped unless `SMOKE_RPC` is
set, so the offline gate never touches a network:

```bash
SMOKE_RPC=http://127.0.0.1:8899 npx vitest run test/smoke.test.ts
SMOKE_RPC=https://api.devnet.solana.com npx vitest run test/smoke.test.ts
```

It signs with `~/.config/solana/id.json` (override with `SMOKE_KEY`); the
wallet needs SOL on devnet, while a local validator's faucet tops it up
automatically. The suite is idempotent — an existing farm is reused and
each run appends one report at the farm's next free index.

---

## Changing the cluster

Edit `constants/app-config.ts`:

```ts
import { createSolanaDevnet, createSolanaMainnet } from '@wallet-ui/react-native-kit'

static cluster = createSolanaDevnet({ url: 'https://api.devnet.solana.com' })
// or:
static cluster = createSolanaMainnet({ url: 'https://api.mainnet-beta.solana.com' })
```
