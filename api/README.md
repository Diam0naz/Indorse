# AI classification proxy (POC)

Standalone proof-of-concept for the photo-classification feature. Two
backends, one app-facing contract:

```
photo (base64) ──▶ /api/classify          ──▶ OpenAI Responses API (streamed, strict json_schema)
                  /api/classify-gemini    ──▶ Gemini generateContent (buffered, responseSchema)
                                     ──▶ { label, confidence, severity, notes }
```

The same folder also serves the device-verification routes
(`/api/siws/*`, see below) — one runner, one origin.

The proxies are the only place the provider keys live — the app calls one URL
(`EXPO_PUBLIC_AI_CLASSIFY_URL`) and never sees a key. Switching providers is a
one-line env change, no app code change. Both routes share the verdict prompt
and schema (`_lib/prompt.ts`) and the same validation edge (`_lib/proxy.ts` +
`features/ai/types.ts`): `label` is capped at 32 characters _and_ 32 UTF-8
bytes to match the on-chain `aiLabel` field, `severity` must be one of
`high | medium | low | none`, and `notes` is capped at 200 characters.

- **OpenAI** (`api/classify.ts` + `_lib/openai.ts`): the model call streams
  (`stream: true`) and is constrained by a strict `json_schema`; the proxy
  reassembles the deltas and answers the app with one JSON body.
- **Gemini** (`api/classify-gemini.ts` + `_lib/gemini.ts`): a single buffered
  `generateContent` call with a `responseSchema` projection of the same verdict
  schema, authenticated with `x-goog-api-key` (Google AI Studio free tier).

## Run locally

```bash
cp .env.example .env        # then fill in OPENAI_API_KEY and/or GEMINI_API_KEY
npm run api:dev             # serves both routes on localhost:3000 (no Vercel CLI)
npx vercel dev              # alternative: serves ./api if you're logged in
```

## Call it

```bash
curl -X POST http://localhost:3000/api/classify-gemini \
  -H 'content-type: application/json' \
  -d '{"images":[{"imageBase64":"<base64 bytes>","mimeType":"image/jpeg"}]}'
# → {"label":"Gray Leaf Spot","confidence":0.87,"severity":"medium","notes":"…"}
```

Send every shot of the plant (up to 5) as `images[]` — one model call weighs
them together. The legacy single `{ "imageBase64", "mimeType" }` body still works.

## Use it from the app

```ts
import { classifyPhoto, getClassifyEndpoint } from '@/features/ai/classify'

const endpoint = getClassifyEndpoint() // EXPO_PUBLIC_AI_CLASSIFY_URL
const { label, confidence } = await classifyPhoto({ images: [{ imageBase64 }] }, { endpoint: endpoint! })
```

## Device verification (SIWS — roadmap #3/#5)

Server-side device gate, POC shape. Sign-in-with-Solana proves the caller
controls the wallet; eligibility is a server-side dev allowlist — the real
"wallet holds an SGT" mainnet check slots in behind the same `isEligible`
seam later. Nothing here moves funds (no on-chain payout).

```
app ──▶ POST /api/siws/nonce   ──▶ server issues the whole payload, stores it under a nonce (5 min TTL)
    ──▶ wallet.signIn(payload) ──▶ one signature, bound to the address
    ──▶ POST /api/siws/verify  ──▶ single-use nonce · ed25519 verify (key derived from the address)
                                        ──▶ allowlist check
                                        ──▶ { verified, address, method | reason }
```

- **`api/siws/nonce.ts`**: fills every payload field (domain, uri, statement,
  `chainId: solana:mainnet`, a fresh nonce) and stores it in
  `_lib/siws-store.ts` — single-use, deleted on consume.
- **`api/siws/verify.ts`**: shape checks → consume the nonce → `verifySignIn`
  against the **stored** payload with the public key **derived from the
  address** (a body-supplied key would let any keypair sign for any address)
  → `isEligible()` gate.
- **Env**: `SGT_DEV_ALLOWLIST` — comma-separated base58 addresses; `*` allows
  any SIWS-verified wallet (**dev/demo only**); empty fails closed.
  `SIWS_DOMAIN` / `SIWS_URI` pin what the signature binds to.

The app side is `features/wallet/useDeviceVerification.ts`; the verdict is
rendered as the device-verified mark in Settings → Wallet & Security.

## Not wired yet (deliberately)

Full wiring is gated on the native rebuild (`expo-camera`, `expo-location`) and
the devnet program deploy. When ready, the label flows into the `aiLabel` field
of `submit_scout_report` via `useSubmitReport` — no changes to this proxy.
