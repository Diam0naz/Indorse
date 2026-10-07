# indorse — services & Seeker integrations

A single inventory of everything the project ships: the mobile app's screens
and feature services, the on-chain program's instruction surface, the local/
serverless API, the dev infrastructure, and where the Seeker device platform
fits — integrated today versus available next.

Snapshot: 2026-10-06 (repo under active development; re-verify with the
commands at the bottom).

---

## 1. Mobile app — Expo / React Native, Android-first

### Screens

| Route                   | Screen     | What it does                                                                                                                                                                 |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/(tabs)/index`         | Scouting   | Summary tiles, per-field risk status, **Discover card (other farms → scout target)**, scouting log with expandable rows, docked "Scout Field" / "Register farm" action stack |
| `/(tabs)/farms`         | Provenance | Farm PDA + account, provenance score (verified/total reports), active escrow and its escrowed batch                                                                          |
| `/(tabs)/reports`       | Weather    | Parametric weather policy: cover details, live oracle rainfall vs trigger threshold, season chart, policy strip                                                              |
| `/(tabs)/rewards`       | Profile    | Operator identity, SOL/USDC balances, farm details, recent on-chain activity, settings list (admin entry only for `config.admin`)                                            |
| `/onboarding`, `/setup` | —          | 3-slide intro + wallet connect; profile-driven setup wizard                                                                                                                  |
| `settings/*`            | Settings   | account · **admin** (on-chain console) · export (CSV) · language (en/es/fr) · network (cluster) · notifications · security · theme                                           |

`app/index.tsx` dispatches: new user → `/onboarding`, returning user → `/(tabs)`.

### Feature modules (`features/`)

| Module      | Service                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`     | Config.admin console: queries for roles/treasury/seats, 10 action hooks, typed-confirmation validation                                                                                |
| `ai`        | Photo-classify client — up to 5 images per call, verdict schema capped to on-chain `aiLabel` limits — plus the dual-model harvest **grade** client                                    |
| `assistant` | "Ask indorse" client + floating help chip — per-screen first question, app-context payload (route/farm/policy)                                                                        |
| `email`     | OTP request/verify hooks for account registration and recovery                                                                                                                        |
| `escrow`    | Escrow create/release/cancel hooks and queries                                                                                                                                        |
| `farm`      | Farm registry (local + chain sync), register flow, farm queries, **directory client** (publish-on-sync + the Discover card's pure derivation), **season derivation** from geolocation |
| `harvest`   | Harvest batch submission and queries                                                                                                                                                  |
| `insurance` | Policy create/revoke/settle hooks, roster of policies for the Weather screen                                                                                                          |
| `profile`   | Onboarding profile state                                                                                                                                                              |
| `reports`   | Scout report queries and reward flows                                                                                                                                                 |
| `scout`     | Camera capture flow, diagnosis results, scout log, evidence storage (content-addressed copies of captured shots in app storage)                                                       |
| `wallet`    | MWA setup, balance queries, `useWalletMutation` tx helper, SIWS device verification, funds-tier client                                                                                |

### App-level services

- **AI crop diagnosis** — camera capture (≤5 photos) → classify proxy →
  `{label, confidence, severity, notes, commonName, botanicalName,
pathogenName}` (plant identity + causal agent are app-layer display, the
  label alone goes on-chain in `submit_scout_report.aiLabel`).
- **Harvest grading** — `log-harvest-modal` → `POST /api/grade` (Gemini +
  Groq, agree/disagree/single rules) → `grade`/`gradeConfidence`/
  `gradeNotes`/`gradeFlags` written in the same `submit_harvest_batch`
  transaction; failure degrades to an honest ungraded batch (grade 0).
- **Ask indorse assistant** — one floating robot chip over all four tabs opens
  a grounded chat (`POST /api/assistant`, explain-only, rate-limited, no
  transactions) that answers from a hand-written knowledge doc plus the
  live app context; every bubble carries a copy icon, failed asks carry a
  retry icon that re-asks without duplicating the question, and the busy
  "Thinking…" line appends the robot head turning in three uneven beats.
- **Parametric weather insurance** — create/revoke/settle cover, live oracle
  rainfall vs trigger threshold, season chart (all real chain reads).
- **Scouting & provenance** — reports land on-chain; provenance score is
  verified/total per farm.
- **Cross-farm discovery** — a `Discover` card on the Scouting tab lists
  other farms from the directory (distance, verified/total, pending
  verification); its sheet arms a **scout target**, and new captures anchor
  to that farm — stamped into the outbox payload at capture time, so even
  wallet-down queues land where they were taken. The featured farm keeps
  owning everything else (log reads, fields, tiles). See
  `docs/discovery.md` for the full spec.
- **Evidence storage** — every captured shot is copied into app storage at
  submit (`evidence/<sha256-of-bytes>.jpg`, content-addressed so a file
  re-hashes to the digest the row recorded); files follow their rows (FIFO
  eviction and reset release them, Account & Local Data erases them), and a
  failed copy degrades to the cache URI instead of blocking a submission.
  No upload backend yet — a hosted `uri` for chain-alone verification is
  documented future work (README known gaps).
- **Escrow & harvest** — batches escrowed in USDC, released/cancelled against
  provenance; every debit prepends an idempotent USDC ATA create (commit
  `1a9ddc7`).
- **Funds-tier gate** — tiered ceiling checked by the backend _before_ any
  instruction is built (`lib/funds-tier.ts` → `POST /api/funds-tier`):
  tier1 `$100`, tier2 `$250` (reserved), tier3 `$500` (Seeker). Fail-closed
  when `EXPO_PUBLIC_FUND_TIER_URL` is set; over-limit requests are never
  built, simulated or sent.
- **App-lock auth** (`components/auth-provider.tsx`) — passcode + biometrics,
  salted SHA-256 verifiers in expo-secure-store (Android Keystore at rest),
  bounded attempts + 30 s cooldown after five failures, hashed recovery email
  with inbox-proof loop, `disableDeviceFallback` (keeps the OS "reset your
  device password" surface out of the app), **6-month inactivity warn → lock**.
- **Cross-cutting** — i18n (en/es/fr), themes incl. Seeker-exclusive
  ("Seeker Midnight"), CSV export, cluster switcher, in-app notifications
  bell/sheet, provider layer (auth, settings, profile, farm registry, scout
  log, theme, language).

---

## 2. On-chain program (`programs/indorse_program` — 28 instructions)

| Domain              | Instructions                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Config & treasury   | `initConfig` · `setRoles` · `withdrawTreasury`                                                                                  |
| Weather oracle      | `initOracleSet` · `addOracle` · `removeOracle` · `submitOracleReading` · `submitSwitchboardReading` · `registerSwitchboardFeed` |
| Verifiers & bonding | `initVerifierSet` · `reconfigureVerifierSet` · `releaseVerifier` · `postBond` · `slashVerifier`                                 |
| Farms & scouting    | `registerFarm` (one-farm-per-wallet preflight, `6280fb2`) · `deleteFarm` · `submitScoutReport` · `rewardReport`                 |
| Insurance           | `createPolicy` · `revokePolicy` · `settlePolicy` (permissionless, `5cd8ada`) · `closeSettledPolicy`                             |
| Escrow              | `createEscrow` · `releaseEscrow` · `cancelEscrow`                                                                               |
| Harvest & voting    | `submitHarvestBatch` · `castVote`                                                                                               |

Notes:

- Bond vault = ATA(verifierSetPda, usdcMint); `MAX_ORACLES = MAX_VERIFIERS = 7`.
- Events/derivations in the current tree: `policyClosed` event, `farmCounter`
  PDA (one-farm-per-wallet bookkeeping).
- Client is Codama-generated (`lib/generated/indorse`); regenerate with
  `npm run idl:sync && npm run client:generate`.
- Config PDA discriminator `[155, 12, 170, 224, 30, 250, 204, 130]`.
- `rewardReport` is **permissionless** (no signer gate; `status == Verified` is
  the whole gate) and pays the single `REPORT_REWARD` constant out of the one
  shared `reward_vault` to `report.reporter` — no per-farm bounty, no
  owner-set amount, and no verifier step in the payout itself. The verifier
  quorum's job ends at the _report_, never at the money. The assistant doc
  spells this out because the model once invented the opposite design.

---

## 3. API services (`npm run api:dev` → localhost:3000; Vercel-function compatible)

All routes are single-purpose modules under `api/`, mounted by
`scripts/serve-api.ts` (methods are not filtered at the router — handlers
answer 405 themselves). One origin serves everything, derived from
`EXPO_PUBLIC_AI_CLASSIFY_URL` via `lib/api-origin.ts`; the grading and
assistant routes have their own URLs (`EXPO_PUBLIC_AI_GRADE_URL`,
`EXPO_PUBLIC_AI_ASSISTANT_URL`).

| Route                       | Service                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/classify`        | AI verdicts — OpenAI Responses API (streamed, strict `json_schema`)                                                                                                                                                                                                                                                                                                                                                                                      |
| `POST /api/classify-gemini` | Same contract via Gemini `generateContent` + `responseSchema`. Validation edge shared: label ≤ 32 chars/32 UTF-8 bytes, severity ∈ `high\|medium\|low\|none`, notes ≤ 200 chars; identity fields (`commonName`/`botanicalName`/`pathogenName`) are lenient — omitted when unusable                                                                                                                                                                       |
| `POST /api/grade`           | Dual-model harvest grade — Gemini `flash-lite` first opinion + Groq `gpt-oss-120b` second on the batch record (no photo). Agree → averaged confidence; disagree → higher-confidence grade, **minimum** confidence, flag bit 0 (human verifier); one fail → `single` (flagged < 0.5); both fail → 502                                                                                                                                                     |
| `POST /api/assistant`       | "Ask indorse" grounded guide — Groq `gpt-oss-120b` at **temperature 0** over the hand-written `api/_lib/knowledge.ts` doc + app context (route/farm/policy, allowlisted & clipped). Explain-only system rules incl. "never fill a gap", 1000-char message cap, per-IP rate limit (30/min → 429), an upstream Groq 429 passed through as 429 rather than 502, reply markdown stripped. Regression-guarded by `scripts/assistant-eval.ts` (trap questions) |
| `POST /api/siws/nonce`      | Sign-In-With-Solana: server issues the whole payload, stored single-use under a nonce (5 min TTL)                                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/siws/verify`     | Consumes the nonce, ed25519-verifies with the key **derived from the address**, then `isEligible()` gate (`SGT_DEV_ALLOWLIST`, fails closed) → on a miss, the server-side **SGT mainnet check** when `SGT_RPC_URL` is set (`method: 'sgt'` + `mintAddress` on a pass, `reason: 'no-sgt'` on a miss; **503** when the RPC is unreachable)                                                                                                                 |
| `POST /api/email/start`     | Emails a 6-digit OTP via Resend (`RESEND_API_KEY`, optional `EMAIL_FROM`); salted SHA-256 keys in the OTP store; HTML body themed to the app's Warm Charcoal palette (hexes test-locked against `darkTokens`)                                                                                                                                                                                                                                            |
| `POST /api/email/verify`    | Checks the code — drives registration/recovery email binding                                                                                                                                                                                                                                                                                                                                                                                             |
| `POST /api/admin/status`    | SIWS proof **and** server-side `config.admin` re-check: roles, allowlist + source, email/SAS/AI flags                                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/admin/allowlist` | Runtime allowlist override layered over env (env stays the fail-closed default)                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/funds-tier`      | Tier ceiling for policy funds ($100/$250/$500). The `seeker` claim is verified **server-side** through the shared SGT check when `SGT_RPC_URL` is set — pass → `trust: 'sgt-verified'` (+`mintAddress`), fail → downgraded to tier1 `trust: 'seeker-rejected'`, RPC error → 503; unconfigured (dev/tests) keeps the honest `client-asserted-dev` label                                                                                                   |
| `GET/POST /api/directory`   | Farm directory for cross-farm discovery — `POST {farm}` publishes an address, which the server **re-reads on devnet before storing** (a publish can only list a real `Farm` account; 400/404/429 per-IP/502); `GET` returns snapshots and re-reads rows older than 60 s, keeping the stale row on RPC failure. In-memory: restarts self-heal as devices re-publish their roster                                                                          |

Shared libraries (`api/_lib/`): `siws-auth` (verify core shared by
`/siws/verify` and the admin routes) · `admin-auth` · `allowlist` ·
`sgt` (shared **Seeker Genesis Token** check — all four mint properties
must match, zero-balance accounts filtered first, verdict cached, RPC
failures throw → 503 at the handlers; feeds both `/siws/verify` and
`/funds-tier`) · `sas` +
`sas-issuer` (**Solana Attestation Service** seam — on-chain proof that a
wallet controls an email; only salted hashes ever reach a schema field) ·
`otp-store` · `email` · `gemini` / `openai` / `proxy` / `prompt` ·
`grade` (dual-model grading core) · `knowledge` (assistant knowledge doc +
system-prompt assembly).

**Environment**

- Server: `OPENAI_API_KEY` / `GEMINI_API_KEY` · `GROQ_API_KEY` (grading
  second opinion + the assistant; optional `GROQ_MODEL`) · `RESEND_API_KEY` (+`EMAIL_FROM`) ·
  `SGT_DEV_ALLOWLIST`, `SGT_RPC_URL` (enables the server-side SGT gate),
  `SIWS_DOMAIN`, `SIWS_URI` ·
  `SAS_ISSUER_SECRET`, `SAS_CREDENTIAL_PDA`, `SAS_SCHEMA_PDA` (+`SAS_RPC_URL`, `SAS_EMAIL_PEPPER`)
- App: `EXPO_PUBLIC_SOLANA_RPC_URL` · `EXPO_PUBLIC_AI_CLASSIFY_URL` (origin source) ·
  `EXPO_PUBLIC_FUND_TIER_URL` (tier gate on/off) · `EXPO_PUBLIC_FORCE_SEEKER` (dev-only preview)

---

## 4. Dev / infrastructure

- **Runners** — Metro (`npm start` / `dev` with cleared cache) · API dev
  server (`npm run api:dev`, tsx resolves `@/` paths) · device loop via
  `adb reverse tcp:3000 tcp:3000` (and 8081; reverses die on replug).
- **Codegen** — `npm run idl:sync` (Anchor IDL → `lib/idl`) ·
  `npm run client:generate` (Codama → `lib/generated`) ·
  `npm run sas:bootstrap` (attestation issuer wiring) · `npm run icons`.
- **Quality gates** — `npm run ci` = tsc + eslint + prettier + vitest +
  Android build. Test suite green as of this writing (one live-RPC smoke
  test skipped by design).
- **Assistant trap-question eval** — `npx -y tsx scripts/assistant-eval.ts`
  asks six questions against the live model (scouting bounties, staking,
  loans, who pays the reward, GPS visibility, privacy policy) and fails if
  any reply invents a feature, fails to deny or hedge, or drops a documented
  fact. Deliberately **not** in `npm test` — it spends model tokens and moves
  with the upstream model. Run it after every edit to
  `api/_lib/knowledge.ts`, which is the model's whole world and the file most
  likely to drift. `--ask "…"` runs one ad-hoc question.
- **Scripts** — `android` / `ios` / `web` / `build` / `doctor` / `test:watch`
  / `test:coverage`.

---

## 5. Seeker integrations

### Integrated today

1. **Mobile Wallet Adapter** — the core Solana Mobile stack
   (`@wallet-ui/react-native-kit`): wallet connect/sign/send; key material
   never leaves the wallet app.
2. **Seed Vault badge** (`components/seed-vault-badge.tsx`) — "Seed Vault
   secured" chip on capture screens when running on a Seeker.
3. **.skr domains — both directions** (`lib/skr.ts`) — _reverse_:
   address → first-sorting `.skr` name shown in the header identity beside the
   truncated address. _Forward_: `classifyAddressInput` / `resolveAddressInput`
   / `resolveAddressFields` read a typed field as either a pubkey or a
   `name.skr`, wired into the operator console's address inputs (set_roles,
   add_oracle reader, allowlist entry) so an operator types `ops.skr` instead
   of pasted base58. Always resolves against mainnet, Kit codecs only so it
   runs under Hermes. Reverse carries the documented caveat (a name can be
   transferred to any wallet unasked — display beside the address, never
   instead of it); forward never substitutes, it only returns an address the
   chain says owns the name.
4. **Seeker device detection** (`lib/seeker.ts`) — `Platform.constants.Model
=== "Seeker"`, explicitly presentation-only: drives the Seeker-exclusive
   theme and badge, never an entitlement. `EXPO_PUBLIC_FORCE_SEEKER=true`
   previews it in dev; never ship it enabled.
5. **Seeker Midnight theme** (`theme.seeker`) — locked to Seeker devices.
6. **SIWS device verification** — signed-message proof from the device
   wallet, verified server-side; verdict rendered as the device-verified
   mark in Settings → Wallet & Security.
7. **Server-side Seeker Genesis Token (SGT) verification**
   (`api/_lib/sgt.ts`) — the headline item, implemented behind
   `SGT_RPC_URL` (mainnet-only; unset keeps dev/test behaviour). One
   shared module decides for both consumers: the SIWS allowlist miss
   (`method: 'sgt'` / `reason: 'no-sgt'`) and the funds-tier `seeker`
   claim. All four mint properties must match, zero-balance accounts are
   filtered before the mint is read, frozen accounts are not rejected, and
   an RPC outage answers **503** — never "no SGT". Verdicts are cached
   briefly per wallet; the mint address (the device identity) is returned
   for anti-Sybil recording.
8. **Funds-tier tier3 = $500 for Seeker devices** — with the SGT gate on,
   the claim is verified server-side (`trust: 'sgt-verified'`, else
   downgraded to tier1 `seeker-rejected`); with it off, the claim stays
   client-asserted and is labelled `client-asserted-dev` (boundary is
   explicit).

### Relevant, available, not yet wired

1. **Policy surfaces on top of the SGT verdict** — the check exists
   server-side and returns the mint (device identity), but nothing yet
   consumes it beyond the two gates: one-claim-per-device anti-Sybil,
   gated rewards, early-access onboarding, and the still-reserved tier2
   "verified operators" all become possible from the same verdict.
2. **Seeker Connect for web** (`seeker-connect`) — only relevant if the web
   surface ships (`npm run web` exists): it registers the "Seeker Connect"
   Wallet Standard wallet inside the Seeker's browser
   (`seeker-connect-button`, Nostr relay association) — the web counterpart
   of MWA. The native app stays on MWA.

Note on what forward `.skr` did **not** unlock: every payout destination in
the program is pinned (`reward_report` pays `report.reporter`, escrow
releases to the policy farmer, `withdraw_treasury` to `config.admin`), so
there is no free-text recipient field to accept `farmer.skr`. The operator
console was the only place a human types a pubkey.

---

## Re-verify

```bash
npx tsc --noEmit && npx eslint . && npx prettier --check .
npx vitest run
ls lib/generated/indorse/instructions | grep -v index | wc -l   # instruction count
sed -n '12,30p' scripts/serve-api.ts                            # mounted route table
```
