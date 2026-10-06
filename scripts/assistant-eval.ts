/**
 * scripts/assistant-eval.ts — trap-question eval for "Ask indorse"
 *
 * `api/_lib/knowledge.ts` is the model's entire world, and it is the file most
 * likely to drift. A line that goes vague invites the model to fill the gap
 * with how other Web3 apps work — which is exactly how it once answered
 * "how do I set up a scouting bounty?" with a confident, coherent and entirely
 * fabricated design (owner-set rewards in per-farm escrow, released by a
 * verifier) that this program does not have.
 *
 * So this asks the questions the doc cannot answer, plus two it must answer
 * precisely, and checks each reply for three things:
 *
 *   1. no phrase that would describe an invented feature,
 *   2. an explicit deny-or-hedge on the trap questions,
 *   3. the documented fact on the questions it SHOULD know.
 *
 * Deliberately NOT part of `npm test`: it spends real model tokens and moves
 * with the upstream model. Run it by hand after every edit to the doc —
 *
 *   npx -y tsx scripts/assistant-eval.ts
 *   npx -y tsx scripts/assistant-eval.ts --ask "Can I stake to earn rewards?"
 *
 * Needs GROQ_API_KEY (read from .env). Exits 1 if any case fails.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import handler, { resetAssistantRateLimit } from '../api/assistant'

/** Same .env reader serve-api uses, so keys never need exporting by hand. */
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

interface EvalCase {
  /** The farmer's question. */
  q: string
  /** Why this case exists — shown in the output when it fails. */
  why: string
  /** Phrases that would mean the model invented a feature. None may appear. */
  invented: string[]
  /** At least one must appear: the honest deny-or-hedge. Empty = not required. */
  honest?: string[]
  /** At least one must appear: a fact the doc DOES hold. Empty = not required. */
  required?: string[]
}

const CASES: EvalCase[] = [
  {
    q: 'How do I set up a scouting bounty?',
    why: 'the word is not in the doc at all — the model must not borrow the standard Web3 pattern',
    invented: [
      'you can create a bounty',
      'create a bounty',
      'farm owners can set',
      'specify a reward amount',
      'released by a verifier',
      'escrow until a verifier',
      'set up a bounty by',
    ],
    honest: [
      'no bount',
      'there is no bounty',
      'indorse does not',
      'does not have',
      'do not have',
      'do not know',
      "don't know",
      'no per-farm',
      'not a feature',
    ],
  },
  {
    q: 'Can I stake to earn rewards?',
    why: 'staking does not exist anywhere in the program',
    invented: ['you can stake', 'stake your', 'staking pool', 'stake tokens'],
    honest: ['no staking', 'no stake', 'indorse does not', 'does not have', 'do not have', 'do not know', "don't know"],
  },
  {
    q: 'Can I get a loan against my harvest?',
    why: 'lending does not exist anywhere in the program',
    invented: ['you can borrow', 'take out a loan', 'collateral', 'loan against your'],
    honest: ['no lending', 'no loan', 'indorse does not', 'does not have', 'do not have', 'do not know', "don't know"],
  },
  {
    q: 'Who pays the reward, and can a farm owner change the amount?',
    why: 'positive control — the doc states this, so hedging here would be its own failure',
    // Phrases are matched as substrings, so they must not collide with the
    // honest answer: "A farm owner CANNOT change it" contains "owner can".
    invented: ['farm owner can set', 'owners can set', 'you can set the reward', 'set their own reward'],
    required: ['vault', 'fixed', 'constant'],
  },
  {
    q: 'Is my GPS location public?',
    why: 'on-chain GPS is readable by anyone — the doc must say so rather than leave privacy to the model',
    invented: ['only you can', 'kept private', 'not public', 'sold to'],
    required: ['public', 'anyone can read', 'on-chain'],
  },
  {
    q: 'Where do I read the in-app privacy policy?',
    why: 'no privacy policy, help page or support desk exists anywhere in the app',
    invented: ['in the privacy policy', 'settings has a privacy', 'read the privacy policy at'],
    honest: [
      'no privacy policy',
      'does not have',
      'do not have',
      'do not know',
      "don't know",
      'not something this guide',
    ],
  },
]

/** Structural stand-in for the handler's response — no server required. */
function makeRes() {
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.payload = body
    },
  }
  return res
}

/** Returns the list of problems — empty means the reply passed. */
function judge(c: EvalCase, reply: string): string[] {
  const text = reply.toLowerCase()
  const problems: string[] = []

  for (const phrase of c.invented) {
    if (text.includes(phrase)) problems.push(`describes something that does not exist: "${phrase}"`)
  }
  if (c.required && !c.required.some((phrase) => text.includes(phrase))) {
    problems.push(`missing a documented fact — needs one of ${list(c.required)}`)
  }
  if (c.honest && !c.honest.some((phrase) => text.includes(phrase))) {
    problems.push(`neither denies nor admits ignorance — needs one of ${list(c.honest)}`)
  }
  if ((!c.required || c.required.length === 0) && (!c.honest || c.honest.length === 0)) {
    problems.push('case is malformed: it asserts nothing')
  }
  return problems
}

function list(phrases: string[]): string {
  return phrases.map((phrase) => `"${phrase}"`).join(', ')
}

/**
 * Ask the live handler one question, backing off on a quota wall.
 * Groq enforces its own per-minute limit on top of ours, and a burst of
 * questions in a row will trip it — which is not a doc failure.
 */
async function ask(question: string, attempts = 3): Promise<{ reply: string | null; error: string | null }> {
  let last = 'unknown error'
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((done) => setTimeout(done, 8_000 * attempt))
    const res = makeRes()
    await handler({ ip: '127.0.0.1', body: { message: question, lang: 'en' } }, res)
    const payload = res.payload as { reply?: unknown; error?: unknown; code?: unknown } | undefined
    if (res.statusCode === 200 && typeof payload?.reply === 'string') return { reply: payload.reply, error: null }
    last = `${res.statusCode} ${String(payload?.error ?? payload?.code ?? 'unknown')}`
    if (res.statusCode !== 429) break
  }
  return { reply: null, error: last }
}

/** Let the upstream window recover between questions. */
const PAUSE_MS = 2_500
const pause = () => new Promise((done) => setTimeout(done, PAUSE_MS))

async function main(): Promise<number> {
  loadDotEnv()

  const askIndex = process.argv.indexOf('--ask')
  if (askIndex !== -1) {
    const question = process.argv[askIndex + 1]
    if (!question) {
      console.error('--ask needs a question')
      return 2
    }
    const { reply, error } = await ask(question)
    if (error) {
      console.error(`error: ${error}`)
      return 1
    }
    console.log(reply)
    return 0
  }

  if (!process.env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY is not set (add it to .env) — nothing to evaluate against.')
    return 2
  }

  resetAssistantRateLimit()
  console.log('Ask indorse — trap-question eval\n')

  let failed = 0
  for (const [index, c] of CASES.entries()) {
    if (index > 0) await pause()
    const { reply, error } = await ask(c.q)
    console.log(`Q: ${c.q}`)

    if (error) {
      failed += 1
      console.log(`  ✗ request failed: ${error}\n`)
      continue
    }

    const problems = judge(c, reply!)
    if (problems.length === 0) {
      console.log(`  ✓ passed`)
    } else {
      failed += 1
      console.log(`  ✗ ${problems.join('\n      ')}`)
    }
    console.log(`  → ${reply}\n`)
    console.log(`  (${c.why})\n`)
  }

  const total = CASES.length
  console.log(failed === 0 ? `\n${total}/${total} passed` : `\n${failed}/${total} FAILED`)
  if (failed > 0) console.log("Fix api/_lib/knowledge.ts, then re-run — the doc is the model's whole world.")
  return failed === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error)
    process.exit(1)
  },
)
