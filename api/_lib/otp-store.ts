/**
 * api/_lib/otp-store.ts — email one-time-passcode store (POC)
 *
 * Codes are keyed by (email, wallet), stored only as a salted SHA-256 digest,
 * and can be used exactly once. Wrong guesses burn the attempt budget, so a
 * code cannot be brute-forced in place — the caller has to request a new one.
 *
 * In-memory on purpose, like `siws-store.ts`: the local runner is one
 * long-lived process and the POC has nowhere else to put state. A multi-
 * instance deploy needs a shared store with an atomic GETDEL (Redis, SQL);
 * swapping that in is confined to this file.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export const OTP_LENGTH = 6
/** Ten minutes: long enough to fetch the email, short enough to stay safe. */
export const OTP_TTL_MS = 600_000
export const OTP_MAX_ATTEMPTS = 5

export type OtpOutcome = 'ok' | 'mismatch' | 'expired' | 'locked' | 'missing'

interface Entry {
  codeHash: Buffer
  salt: string
  expiresAt: number
  attemptsLeft: number
}

/** Lower-cased and trimmed so `Foo@x.com` and `foo@x.com` are the same key. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** One code per (email, wallet) pair — an address cannot borrow another's code. */
export function otpKey(email: string, wallet: string): string {
  return `${normalizeEmail(email)}|${wallet}`
}

function hashCode(code: string, salt: string): Buffer {
  return createHash('sha256').update(`${salt}:${code}`).digest()
}

export class EmailOtpStore {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly ttlMs = OTP_TTL_MS,
    private readonly maxAttempts = OTP_MAX_ATTEMPTS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Replace any existing code for the key and start a fresh attempt budget. */
  issue(key: string, code: string): { expiresAt: number } {
    this.sweep()
    const salt = randomBytes(16).toString('hex')
    const expiresAt = this.now() + this.ttlMs
    this.entries.set(key, {
      codeHash: hashCode(code, salt),
      salt,
      expiresAt,
      attemptsLeft: this.maxAttempts,
    })
    return { expiresAt }
  }

  /**
   * Check a code in one step. A match consumes the entry; a miss decrements the
   * budget and locks the key once it is spent. Unknown, expired and locked keys
   * are all distinguishable here so the route can pick the right status.
   */
  verify(key: string, code: string): OtpOutcome {
    const entry = this.entries.get(key)
    if (!entry) return 'missing'
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return 'expired'
    }

    const candidate = hashCode(code, entry.salt)
    if (candidate.length === entry.codeHash.length && timingSafeEqual(candidate, entry.codeHash)) {
      this.entries.delete(key)
      return 'ok'
    }

    entry.attemptsLeft -= 1
    if (entry.attemptsLeft <= 0) {
      this.entries.delete(key)
      return 'locked'
    }
    return 'mismatch'
  }

  /** Drop every entry — used by tests and available for admin tooling. */
  clear(): void {
    this.entries.clear()
  }

  /** Drop expired entries on issue so a long-lived process stays bounded. */
  private sweep(): void {
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
  }
}

/** A zero-padded 6-digit code, uniform over 000000–999999. */
export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
}

/** Process-wide store — one per server instance. */
export const emailOtpStore = new EmailOtpStore()
