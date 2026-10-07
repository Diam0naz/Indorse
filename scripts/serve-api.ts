/**
 * scripts/serve-api.ts — local host for the serverless handlers (POC)
 *
 * `npx vercel dev` needs a logged-in Vercel CLI; during the POC this tiny
 * server serves the same `(req, res)` handlers straight from `./api` so the
 * app can reach a real classification endpoint:
 *
 *   npm run api:dev                 # http://localhost:3000/api/*
 *   adb reverse tcp:3000 tcp:3000   # phone's localhost:3000 → this machine
 *
 * Routes (switch the app with EXPO_PUBLIC_AI_CLASSIFY_URL / EXPO_PUBLIC_AI_GRADE_URL
 * / EXPO_PUBLIC_AI_ASSISTANT_URL):
 *   POST /api/classify          → OpenAI backend
 *   POST /api/classify-gemini   → Google Gemini backend
 *   POST /api/grade             → dual-model harvest grade (Gemini + Groq)
 *   POST /api/assistant         → "Ask indorse" grounded guide (Groq, rate-limited)
 *   POST /api/siws/nonce        → issue a SIWS payload (device verification)
 *   POST /api/siws/verify       → verify it, gate on the dev allowlist
 *   POST /api/email/start       → email a verification code
 *   POST /api/email/verify      → check the code
 *   POST /api/admin/status      → SIWS + config.admin: roles, allowlist, flags
 *   POST /api/admin/allowlist   → SIWS + config.admin: dev allowlist ops
 *   POST /api/funds-tier        → tier ceiling for policy funds ($100/$250/$500)
 *
 * Methods are NOT filtered here on purpose — the handlers themselves answer
 * 405 to non-POST, and the app's reachability probe treats *any* HTTP
 * response as "the endpoint is up".
 *
 * `.env` is loaded manually (without overriding exported variables) so the
 * provider keys never have to be exported by hand.
 */

import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import classifyHandler from '../api/classify'
import classifyGeminiHandler from '../api/classify-gemini'
import gradeHandler from '../api/grade'
import assistantHandler from '../api/assistant'
import siwsNonceHandler from '../api/siws/nonce'
import siwsVerifyHandler from '../api/siws/verify'
import emailStartHandler from '../api/email/start'
import emailVerifyHandler from '../api/email/verify'
import adminStatusHandler from '../api/admin/status'
import adminAllowlistHandler from '../api/admin/allowlist'
import fundsTierHandler from '../api/funds-tier'
import directoryHandler from '../api/directory'

type HandlerReq = Parameters<typeof classifyHandler>[0]
type HandlerRes = Parameters<typeof classifyHandler>[1]

/** The app's single classify URL points at one of these. */
const routes: Record<string, (req: HandlerReq, res: HandlerRes) => Promise<void>> = {
  '/api/classify': classifyHandler,
  '/api/classify-gemini': classifyGeminiHandler,
  '/api/grade': gradeHandler,
  '/api/assistant': assistantHandler,
  '/api/siws/nonce': siwsNonceHandler,
  '/api/siws/verify': siwsVerifyHandler,
  '/api/email/start': emailStartHandler,
  '/api/email/verify': emailVerifyHandler,
  '/api/admin/status': adminStatusHandler,
  '/api/admin/allowlist': adminAllowlistHandler,
  '/api/funds-tier': fundsTierHandler,
  '/api/directory': directoryHandler,
}

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

loadDotEnv()

const PORT = Number(process.env.PORT ?? 3000)

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const started = Date.now()
  const from = req.socket.remoteAddress ?? '?'
  // One line per request so a phone-side failure is diagnosable after the
  // fact: arrival, status, size, duration — plus mid-upload deaths, which
  // are exactly what a flaky transport produces.
  const logLine = (outcome: string) =>
    console.log(`[req] ${req.method} ${path} from ${from} -> ${outcome} (${Date.now() - started}ms)`)
  req.on('close', () => {
    if (!res.writableEnded) logLine('ABORTED mid-upload')
  })
  req.on('error', (error) => logLine(`request error: ${error.message}`))
  const handler = routes[path]
  if (!handler) {
    logLine('404')
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    let body: unknown = raw
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      // Malformed JSON falls through — the handler decides what to answer.
    }

    let code = 200
    let payload: unknown = { error: 'handler produced no body' }
    const out: HandlerRes = {
      status(next: number) {
        code = next
        return out
      },
      json(next: unknown) {
        payload = next
      },
    }
    const request: HandlerReq = { method: req.method, body, ip: from }

    Promise.resolve(handler(request, out))
      .catch(() => {
        code = 500
        payload = { error: 'Internal error' }
      })
      .finally(() => {
        if (res.writableEnded) return
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[api] serving ./api on http://localhost:${PORT}{/api/classify,/api/classify-gemini,/api/grade,/api/assistant}`,
  )
})
